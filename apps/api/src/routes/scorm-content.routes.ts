import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { rateLimitStore } from '../lib/rate-limit-store';
import { runWithTenant } from '@enterprise-lms/database';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { logger } from '../lib/logger';
import { storage } from '../lib/storage';
import { recordLessonsDone } from '../lib/completion';
import {
  isWithdrawn,
  safeEntryPath,
  scormContentOrigin,
  summarise,
  verifyLaunch,
  WITHDRAWN_MESSAGE,
  type LaunchClaims,
  type PackageFile,
} from '../lib/scorm';

// Mounted at /scorm-content and meant to be reached on SCORM_CONTENT_ORIGIN only (server.ts keeps other
// routes off that host). There is no session here: every URL carries a signed token for one learner and one
// package (lib/scorm signLaunch), so a package's scripts can read and save that learner's data for that
// package and nothing else. Layout under /scorm-content/<token>/:
//   __launch   the player page: provides the SCORM API (1.2 window.API, 2004 window.API_1484_11) and frames the package
//   __state    the learner's saved cmi data          __commit   saves it
//   <path>     the package's own files

const router = Router();

const appOrigin = () => new URL(config.APP_URL).origin;

/** Only the LMS may frame these pages; packages may run their own scripts but only talk to this origin. */
function contentHeaders(res: Response) {
  res.removeHeader('X-Frame-Options');
  res.setHeader('Referrer-Policy', 'no-referrer'); // the token is in the URL
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self' data: blob:",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
      "style-src 'self' 'unsafe-inline' data:",
      "img-src 'self' data: blob: https:",
      "media-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-src 'self'",
      "form-action 'self'",
      `frame-ancestors 'self' ${appOrigin()}`,
    ].join('; ')
  );
}

interface Ctx {
  claims: LaunchClaims;
  pkg: { id: string; courseId: string; version: string; launchPath: string; filesJson: unknown; title: string };
}

/**
 * Packages only ever run on the content origin's host. Hostnames, not ports, are compared: browsers send
 * cookies to a host whatever the port, so in development localhost:4000 (where the session cookie of
 * localhost:3000 goes) must never serve a package, while 127.0.0.1 may.
 */
const onContentHost = (req: Request) => {
  const origin = scormContentOrigin();
  if (!origin) return false;
  const host = (req.publicHost ?? '').replace(/:\d+$/, '');
  return host === new URL(origin).hostname.toLowerCase();
};

/** Verifies the host, the token and that the learner still exists, then runs the rest inside the token's tenant. */
const withToken =
  (handler: (req: Request, res: Response, ctx: Ctx) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
    if (!onContentHost(req)) return res.status(404).type('text/plain').send('Not found');
    const claims = verifyLaunch(String(req.params.token));
    if (!claims) return res.status(403).type('text/plain').send('This link has expired. Reopen the lesson.');
    return runWithTenant(claims.t, async () => {
      try {
        // A token outlives a deactivated or erased account; it must not keep reading or writing its data.
        const learner = await prisma.user.findFirst({
          where: { id: claims.u, tenantId: claims.t, status: 'ACTIVE', erasedAt: null },
          select: { id: true },
        });
        if (!learner) return res.status(403).type('text/plain').send('This link is no longer valid.');
        const pkg = await prisma.scormPackage.findFirst({
          where: { id: claims.p, tenantId: claims.t },
          select: {
            id: true,
            courseId: true,
            version: true,
            launchPath: true,
            filesJson: true,
            title: true,
            sourceFile: { select: { scanStatus: true } },
          },
        });
        if (!pkg) return res.status(404).type('text/plain').send('Not found');
        // Checked on every request, so an open lesson stops as soon as a scan withdraws the package.
        if (isWithdrawn(pkg)) return res.status(410).type('text/plain').send(WITHDRAWN_MESSAGE);
        contentHeaders(res);
        await handler(req, res, { claims, pkg });
      } catch (err) {
        next(err);
      }
    });
  };

/** The values a package may read but never write. */
async function readOnlyValues(version: string, userId: string, hasSaved: boolean): Promise<Record<string, string>> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } });
  const entry = hasSaved ? 'resume' : 'ab-initio';
  return version === '2004'
    ? {
        'cmi.learner_id': userId,
        'cmi.learner_name': `${u?.firstName ?? ''} ${u?.lastName ?? ''}`.trim(),
        'cmi.mode': 'normal',
        'cmi.credit': 'credit',
        'cmi.entry': entry,
      }
    : {
        'cmi.core.student_id': userId,
        'cmi.core.student_name': `${u?.lastName ?? ''}, ${u?.firstName ?? ''}`,
        'cmi.core.lesson_mode': 'normal',
        'cmi.core.credit': 'credit',
        'cmi.core.entry': entry,
      };
}

const defaults = (version: string): Record<string, string> =>
  version === '2004'
    ? { 'cmi.completion_status': 'unknown', 'cmi.success_status': 'unknown' }
    : { 'cmi.core.lesson_status': 'not attempted' };

/** GET /scorm-content/:token/__state */
router.get(
  '/:token/__state',
  withToken(async (_req, res, { claims, pkg }) => {
    const attempt = await prisma.scormAttempt.findUnique({
      where: { packageId_userId: { packageId: pkg.id, userId: claims.u } },
      select: { cmiJson: true },
    });
    const saved = (attempt?.cmiJson ?? {}) as Record<string, string>;
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ cmi: { ...defaults(pkg.version), ...saved, ...(await readOnlyValues(pkg.version, claims.u, !!attempt)) } });
  })
);

const commitSchema = z.object({
  cmi: z
    .record(z.string().max(255), z.string().max(65_536))
    .refine((c) => Object.keys(c).length <= 2000, 'Too many values')
    .refine((c) => Object.entries(c).reduce((n, [k, v]) => n + k.length + v.length, 0) <= 1024 * 1024, 'Too much data'),
});

/** Saves are database writes on a session-less origin: limited per address. */
const commitLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: rateLimitStore('scorm-commit'),
  passOnStoreError: true,
  message: { error: 'Too many saves. Try again shortly.' },
});

/** POST /scorm-content/:token/__commit {cmi}: saves the learner's data; a completed package finishes its lessons. */
router.post(
  '/:token/__commit',
  commitLimiter,
  withToken(async (req, res, { claims, pkg }) => {
    const parsed = commitSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid SCORM data' });
    const readOnly = await readOnlyValues(pkg.version, claims.u, true);
    const cmi = Object.fromEntries(Object.entries(parsed.data.cmi).filter(([k]) => !(k in readOnly) && k.startsWith('cmi.')));
    const summary = summarise(pkg.version, cmi);

    const where = { packageId_userId: { packageId: pkg.id, userId: claims.u } };
    await prisma.scormAttempt.upsert({
      where,
      create: {
        tenantId: claims.t,
        packageId: pkg.id,
        userId: claims.u,
        cmiJson: cmi,
        status: summary.status,
        scorePercent: summary.scorePercent,
      },
      update: { cmiJson: cmi, status: summary.status, scorePercent: summary.scorePercent },
    });
    // Claimed atomically, so two saves arriving together finish the lessons (and notify) once.
    const firstCompletion =
      summary.completed &&
      (
        await prisma.scormAttempt.updateMany({
          where: { packageId: pkg.id, userId: claims.u, completedAt: null },
          data: { completedAt: new Date() },
        })
      ).count === 1;
    const attempt = await prisma.scormAttempt.findUnique({ where, select: { completedAt: true } });
    const completedAt = attempt?.completedAt ?? null;

    // The first time the package reports completion, its lessons count as finished for an enrolled learner.
    if (firstCompletion) {
      const enrolled = await prisma.enrollment.findUnique({
        where: { courseId_userId: { courseId: pkg.courseId, userId: claims.u } },
        select: { status: true },
      });
      if (enrolled && enrolled.status !== 'DROPPED') {
        const lessons = await prisma.lesson.findMany({
          where: { scormPackageId: pkg.id, module: { courseId: pkg.courseId } },
          select: { id: true },
        });
        if (lessons.length) {
          await recordLessonsDone(
            claims.t,
            pkg.courseId,
            claims.u,
            lessons.map((l) => l.id)
          ).catch((err) => logger.warn({ err, packageId: pkg.id }, 'Could not record SCORM completion'));
        }
      }
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ status: summary.status, scorePercent: summary.scorePercent, completed: !!completedAt });
  })
);

/** GET /scorm-content/:token/__launch: the player page. */
router.get(
  '/:token/__launch',
  withToken(async (_req, res, { pkg }) => {
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(launcherHtml(pkg.title, pkg.version, pkg.launchPath, appOrigin()));
  })
);

/** GET /scorm-content/:token/<path>: the package's own files. */
router.get(
  '/:token/*',
  withToken(async (req, res, { pkg }) => {
    // Express has already decoded the path.
    const rel = safeEntryPath(String((req.params as Record<string, string>)[0] ?? ''));
    const file = rel ? (pkg.filesJson as Record<string, PackageFile>)[rel] : undefined;
    if (!file) return res.status(404).type('text/plain').send('Not found');
    res.setHeader('Content-Type', file.type);
    res.setHeader('Content-Length', String(file.size));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const stream = await storage().open(file.key);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  })
);

/** JSON for embedding in a <script>: "<" is escaped so the data can never close the tag. */
const js = (v: unknown) =>
  JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
const html = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The player page: implements the SCORM run-time API in memory (loaded from __state before the package
 * starts, so reads are synchronous as SCORM requires), saves through __commit, and tells the LMS page that
 * framed it when the package reports progress.
 */
export function launcherHtml(title: string, version: string, launchPath: string, parentOrigin: string): string {
  const script = `
(function () {
  var VERSION = ${js(version)}, LAUNCH = ${js(launchPath)}, PARENT = ${js(parentOrigin)};
  var base = location.pathname.replace(/__launch$/, '');
  var cmi = {}, started = false, ended = false, dirty = false, lastError = '0';
  var ERR = { '0': 'No error', '101': 'General exception', '201': 'Invalid argument', '301': 'Not initialized', '401': 'Not implemented', '403': 'Element is read only' };
  var READ_ONLY = VERSION === '2004'
    ? ['cmi.learner_id', 'cmi.learner_name', 'cmi.mode', 'cmi.credit', 'cmi.entry']
    : ['cmi.core.student_id', 'cmi.core.student_name', 'cmi.core.lesson_mode', 'cmi.core.credit', 'cmi.core.entry'];
  function tell(r) { try { parent.postMessage({ type: 'lms-scorm', status: r.status, scorePercent: r.scorePercent, completed: r.completed }, PARENT); } catch (e) {} }
  function save(keepalive) {
    if (!dirty && !keepalive) return true;
    dirty = false;
    var out = {};
    for (var k in cmi) if (READ_ONLY.indexOf(k) < 0) out[k] = cmi[k];
    fetch(base + '__commit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cmi: out }), keepalive: !!keepalive, credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null; }).then(function (r) { if (r) tell(r); }).catch(function () { dirty = true; });
    return true;
  }
  function get(k) {
    lastError = '0';
    if (k in cmi) return cmi[k];
    if (/\\._count$/.test(k)) return '0';
    if (/\\._children$/.test(k)) return '';
    return '';
  }
  function set(k, v) {
    if (READ_ONLY.indexOf(k) >= 0) { lastError = '403'; return 'false'; }
    if (typeof k !== 'string' || k.indexOf('cmi.') !== 0) { lastError = '201'; return 'false'; }
    cmi[k] = String(v); dirty = true; lastError = '0';
    var m = /^(cmi\\.(?:core\\.)?(?:interactions|objectives))\\.(\\d+)\\./.exec(k);
    if (m) { var n = Number(m[2]) + 1, c = m[1] + '._count'; if (!(Number(cmi[c]) >= n)) cmi[c] = String(n); }
    return 'true';
  }
  function init() { started = true; ended = false; lastError = '0'; return 'true'; }
  function finish() { save(true); ended = true; return 'true'; }
  var common = {
    GetLastError: function () { return lastError; },
    GetErrorString: function (c) { return ERR[c] || ''; },
    GetDiagnostic: function (c) { return ERR[c] || ''; }
  };
  window.API = {
    LMSInitialize: init, LMSFinish: finish, LMSGetValue: get, LMSSetValue: set,
    LMSCommit: function () { return save(false) ? 'true' : 'false'; },
    LMSGetLastError: common.GetLastError, LMSGetErrorString: common.GetErrorString, LMSGetDiagnostic: common.GetDiagnostic
  };
  window.API_1484_11 = {
    Initialize: init, Terminate: finish, GetValue: get, SetValue: set,
    Commit: function () { return save(false) ? 'true' : 'false'; },
    GetLastError: common.GetLastError, GetErrorString: common.GetErrorString, GetDiagnostic: common.GetDiagnostic
  };
  setInterval(function () { if (started && !ended) save(false); }, 30000);
  addEventListener('pagehide', function () { if (started && !ended) save(true); });
  fetch(base + '__state', { credentials: 'omit' }).then(function (r) { return r.json(); }).then(function (s) {
    cmi = s.cmi || {};
    var f = document.getElementById('sco');
    f.src = base + encodeURI(LAUNCH);
  }).catch(function () { document.getElementById('msg').textContent = 'This lesson could not be loaded. Reopen it.'; });
})();`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${html(title)}</title>
<style>html,body{margin:0;height:100%;background:#fff;font:14px system-ui,sans-serif}iframe{border:0;width:100%;height:100%;display:block}#msg{position:absolute;top:1rem;left:1rem;color:#555}</style>
</head>
<body>
<p id="msg"></p>
<iframe id="sco" title="${html(title)}" allow="fullscreen; autoplay"></iframe>
<script>${script}</script>
</body>
</html>`;
}

export default router;
