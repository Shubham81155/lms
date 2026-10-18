import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { createWriteStream } from 'fs';
import { rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';
import yauzl from 'yauzl';
import { DOMParser } from '@xmldom/xmldom';
import { config } from '../config';
import { HttpError } from './http';
import { newStorageKey, storage } from './storage';
import { logger } from './logger';

// SCORM 1.2 and 2004 packages. A package is unpacked into storage file by file; its pages are then served
// from SCORM_CONTENT_ORIGIN (routes/scorm-content.routes.ts), an origin of its own, under a signed
// per-learner token, so a package's scripts never run where the learner's session cookie lives.

/** Limits on what a package may unpack to (a zip can expand far beyond its upload size). */
export const SCORM_LIMITS = { maxFiles: 5000, maxFileBytes: 200 * 1024 * 1024, maxTotalBytes: 1024 * 1024 * 1024 };

export interface PackageFile {
  key: string;
  size: number;
  type: string;
}

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', xhtml: 'application/xhtml+xml', js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', xml: 'application/xml', xsd: 'application/xml',
  txt: 'text/plain; charset=utf-8', vtt: 'text/vtt', csv: 'text/csv', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon', bmp: 'image/bmp', mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject', pdf: 'application/pdf', swf: 'application/x-shockwave-flash', wasm: 'application/wasm',
};
export const typeOf = (p: string) => TYPES[p.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream';

/** A safe path inside the package, or null (absolute paths, "..", drive letters, control characters). */
export function safeEntryPath(name: string): string | null {
  if (!name || name.includes('\\') || name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return null;
  if ([...name].some((ch) => ch.charCodeAt(0) < 0x20)) return null;
  const parts = name.split('/');
  if (parts.some((p) => p === '..' || p === '.')) return null;
  return parts.filter(Boolean).join('/');
}

export interface ParsedManifest {
  version: '1.2' | '2004';
  title: string | null;
  /** Relative to the manifest's folder. */
  href: string;
}

const text = (el: Element | null | undefined) => el?.textContent?.trim() || null;
const children = (el: Element, local: string) => Array.from(el.childNodes).filter((n): n is Element => n.nodeType === 1 && (n as Element).localName === local);
const first = (el: Element, local: string) => children(el, local)[0] ?? null;

/** Reads imsmanifest.xml: the SCORM version, the title and the page the first launchable item opens. */
export function parseManifest(xml: string): ParsedManifest {
  let doc: Document;
  try {
    // xmldom never fetches external entities or DTDs; warnings and recoverable errors are ignored.
    doc = new DOMParser({ errorHandler: { warning: () => undefined, error: () => undefined } }).parseFromString(xml, 'text/xml') as unknown as Document;
  } catch {
    throw new HttpError(400, 'imsmanifest.xml could not be read');
  }
  const root = doc.documentElement;
  if (!root || root.localName !== 'manifest') throw new HttpError(400, 'imsmanifest.xml has no <manifest>');

  const metadata = first(root, 'metadata');
  const schemaVersion = (metadata ? text(first(metadata, 'schemaversion')) : null) ?? '';
  const ns = Array.from(root.attributes).map((a) => a.value).join(' ');
  const version: '1.2' | '2004' = /2004|CAM 1\.3/i.test(schemaVersion) || /adlcp_v1p3|imsss/i.test(ns) ? '2004' : '1.2';

  const orgs = first(root, 'organizations');
  const resources = first(root, 'resources');
  if (!resources) throw new HttpError(400, 'imsmanifest.xml lists no resources');
  const all = children(resources, 'resource');
  const base = resources.getAttribute('xml:base') ?? '';

  const defaultId = orgs?.getAttribute('default');
  const orgList = orgs ? children(orgs, 'organization') : [];
  const org = orgList.find((o) => o.getAttribute('identifier') === defaultId) ?? orgList[0] ?? null;

  // Depth-first: the first item that points at a resource is where the package starts.
  const findItem = (el: Element): Element | null => {
    for (const item of children(el, 'item')) {
      if (item.getAttribute('identifierref')) return item;
      const inner = findItem(item);
      if (inner) return inner;
    }
    return null;
  };
  const item = org ? findItem(org) : null;
  const resource = item ? all.find((r) => r.getAttribute('identifier') === item.getAttribute('identifierref')) : all.find((r) => r.getAttribute('href'));
  const href = resource?.getAttribute('href');
  if (!resource || !href) throw new HttpError(400, 'imsmanifest.xml does not say which page to start');
  const joined = `${base}${resource.getAttribute('xml:base') ?? ''}${href}`;
  // The item's parameters are a query string (or #fragment) added to the start page.
  const params = (item?.getAttribute('parameters') ?? '').trim();
  const query = !params ? '' : params.startsWith('#') ? params : `${joined.includes('?') ? '&' : '?'}${params.replace(/^[?&]/, '')}`;
  return { version, title: org ? text(first(org, 'title')) : null, href: joined + query };
}

const openZip = (file: string) =>
  new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(file, { lazyEntries: true, autoClose: true, validateEntrySizes: true, decodeStrings: true }, (err, zip) => (err || !zip ? reject(err) : resolve(zip)))
  );

/**
 * Unpacks a SCORM zip (a file on disk) into storage. Returns the file map, the launch path and the manifest
 * details; on any problem the files already stored are removed and a 400 explains why.
 */
export async function unpackPackage(zipPath: string, tenantId: string) {
  const files: Record<string, PackageFile> = {};
  let total = 0;
  let manifestXml: string | null = null;
  let manifestDir = '';
  const stored: string[] = [];

  try {
    let zip: yauzl.ZipFile;
    try {
      zip = await openZip(zipPath);
    } catch {
      throw new HttpError(400, 'That file is not a zip archive');
    }
    await new Promise<void>((resolve, reject) => {
      const fail = (e: unknown) => {
        zip.close();
        reject(e);
      };
      zip.on('error', (e: Error) =>
        fail(
          e instanceof HttpError
            ? e
            : // yauzl itself refuses "../", absolute and backslash names
              /invalid (relative path|characters in fileName)|absolute path/i.test(e.message)
              ? new HttpError(400, `The package contains an unsafe path (${e.message.slice(0, 120)})`)
              : new HttpError(400, 'The zip archive is damaged')
        )
      );
      zip.on('end', () => resolve());
      zip.on('entry', (entry: yauzl.Entry) => {
        (async () => {
          if (entry.fileName.endsWith('/')) return; // a folder
          const p = safeEntryPath(entry.fileName);
          if (!p) throw new HttpError(400, `The package contains an unsafe path: ${entry.fileName.slice(0, 120)}`);
          if (p.startsWith('__MACOSX/') || p.split('/').pop() === '.DS_Store') return;
          if (Object.keys(files).length >= SCORM_LIMITS.maxFiles) throw new HttpError(400, `Packages can contain at most ${SCORM_LIMITS.maxFiles} files`);
          if (entry.uncompressedSize > SCORM_LIMITS.maxFileBytes) throw new HttpError(400, `${p} is too large`);
          total += entry.uncompressedSize;
          if (total > SCORM_LIMITS.maxTotalBytes) throw new HttpError(400, 'The package unpacks to more than 1 GB');

          const stream = await new Promise<NodeJS.ReadableStream>((res, rej) => zip.openReadStream(entry, (e, s) => (e || !s ? rej(e) : res(s))));
          const temp = path.join(os.tmpdir(), `lms-scorm-${randomUUID()}`);
          let size = 0;
          const isManifest = p.split('/').pop()!.toLowerCase() === 'imsmanifest.xml';
          const chunks: Buffer[] = [];
          try {
            await pipeline(
              stream,
              new Transform({
                transform(chunk: Buffer, _e, done) {
                  size += chunk.length;
                  if (isManifest && size < 5 * 1024 * 1024) chunks.push(chunk);
                  done(null, chunk);
                },
              }),
              createWriteStream(temp)
            );
            const key = newStorageKey(tenantId);
            await storage().putFile(key, temp, typeOf(p));
            stored.push(key);
            files[p] = { key, size, type: typeOf(p) };
          } finally {
            await rm(temp, { force: true });
          }
          // The shallowest manifest wins: some packages are zipped with an outer folder.
          if (isManifest && (manifestXml === null || p.split('/').length - 1 < manifestDir.split('/').filter(Boolean).length)) {
            manifestXml = Buffer.concat(chunks).toString('utf8');
            manifestDir = p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '';
          }
        })().then(() => zip.readEntry(), fail);
      });
      zip.readEntry();
    });

    if (manifestXml === null) throw new HttpError(400, 'This is not a SCORM package: it has no imsmanifest.xml');
    const manifest = parseManifest(manifestXml);
    const [hrefPath] = manifest.href.split(/[?#]/);
    const launchFile = safeEntryPath(path.posix.normalize(manifestDir + decodeURIComponent(hrefPath)));
    if (!launchFile || !files[launchFile]) throw new HttpError(400, `The start page ${manifest.href} is not in the package`);
    const launchPath = manifestDir + manifest.href;
    return { files, launchPath, version: manifest.version, title: manifest.title, fileCount: Object.keys(files).length, sizeBytes: total };
  } catch (e) {
    await removeStored(stored);
    throw e;
  }
}

export async function removeStored(keys: string[]) {
  for (const key of keys) {
    await storage()
      .delete(key)
      .catch((err) => logger.warn({ err, key }, 'Could not remove a SCORM file from storage'));
  }
}

// ---------------------------------------------------------------------------
// Where packages are served, and who may see them
// ---------------------------------------------------------------------------

/** The origin packages are served from, or null when SCORM is off (production without SCORM_CONTENT_ORIGIN). */
export function scormContentOrigin(): string | null {
  if (config.SCORM_CONTENT_ORIGIN) return config.SCORM_CONTENT_ORIGIN.replace(/\/+$/, '');
  return config.NODE_ENV === 'production' ? null : `http://127.0.0.1:${config.PORT}`;
}

const signingKey = () => createHmac('sha256', config.JWT_SECRET).update('scorm-content-v1').digest();
const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export interface LaunchClaims {
  t: string; // tenant
  p: string; // package
  u: string; // user
  e: number; // expires (seconds)
}

/** A token for one learner and one package, carried in the content URL (the content origin has no session). */
export function signLaunch(claims: Omit<LaunchClaims, 'e'>, ttlSeconds = 4 * 3600): string {
  const body = b64(JSON.stringify({ ...claims, e: Math.floor(Date.now() / 1000) + ttlSeconds }));
  return `${body}.${b64(createHmac('sha256', signingKey()).update(body).digest())}`;
}

export function verifyLaunch(token: string): LaunchClaims | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const want = createHmac('sha256', signingKey()).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as LaunchClaims;
    return c.e * 1000 > Date.now() && c.t && c.p && c.u ? c : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Run-time data
// ---------------------------------------------------------------------------

/** What the package reported, in one vocabulary for both SCORM versions. */
export function summarise(version: string, cmi: Record<string, string>): { status: string; scorePercent: number | null; completed: boolean } {
  const num = (v: string | undefined) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
  if (version === '2004') {
    const success = cmi['cmi.success_status'];
    const completion = cmi['cmi.completion_status'];
    const scaled = num(cmi['cmi.score.scaled']);
    const raw = num(cmi['cmi.score.raw']);
    const max = num(cmi['cmi.score.max']);
    const status = success === 'passed' || success === 'failed' ? success : completion && completion !== 'unknown' ? completion : 'not attempted';
    const scorePercent = scaled !== null ? scaled * 100 : raw !== null ? (max ? (raw / max) * 100 : raw) : null;
    return { status, scorePercent: scorePercent === null ? null : Math.round(scorePercent * 10) / 10, completed: completion === 'completed' || success === 'passed' };
  }
  const lesson = cmi['cmi.core.lesson_status'] || 'not attempted';
  const raw = num(cmi['cmi.core.score.raw']);
  const max = num(cmi['cmi.core.score.max']);
  const scorePercent = raw === null ? null : max ? (raw / max) * 100 : raw;
  return { status: lesson, scorePercent: scorePercent === null ? null : Math.round(scorePercent * 10) / 10, completed: lesson === 'completed' || lesson === 'passed' };
}

/** A package whose zip a virus scan found malware in is withdrawn: it is neither launched nor served. */
export const isWithdrawn = (p: { sourceFile?: { scanStatus: string } | null }) => p.sourceFile?.scanStatus === 'INFECTED';
export const WITHDRAWN_MESSAGE = 'This activity was withdrawn because a virus scan found malware in it.';
