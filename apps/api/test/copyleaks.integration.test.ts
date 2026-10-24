import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import request from 'supertest';
import { AddressInfo } from 'net';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// Copyleaks as the similarity provider: the sweeper against a local stand-in for the Copyleaks API, and
// its status webhooks against the real app, PostgreSQL and RLS.

const SECRET = 'plagiarism-secret-'.padEnd(40, 'x');
const TEXT = 'This is a sufficiently long essay body, written to be checked for similarity.';
let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;
let fake: http.Server;
let lib: typeof import('../src/lib/plagiarism-submit.js');
let copyleaks: typeof import('../src/lib/copyleaks.js');

type Received = { method: string; url: string; headers: http.IncomingHttpHeaders; body: any };
let received: Received[] = [];
let logins = 0;
let submitStatus = 201;
/** Runs while a scan request is in flight, before it is answered. */
let duringScan: (() => Promise<unknown>) | null = null;

beforeAll(async () => {
  fake = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      received.push({ method: req.method!, url: req.url!, headers: req.headers, body: raw ? JSON.parse(raw) : null });
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v3/account/login/api') {
        logins++;
        const ok = JSON.parse(raw).key === 'test-api-key-0123';
        res.statusCode = ok ? 200 : 400;
        return res.end(
          ok
            ? JSON.stringify({
                access_token: `tok-${logins}`,
                '.issued': new Date().toISOString(),
                '.expires': new Date(Date.now() + 48 * 3600_000).toISOString(),
              })
            : '{}'
        );
      }
      const answer = () => {
        res.statusCode = req.headers.authorization?.startsWith('Bearer tok-') ? submitStatus : 401;
        res.end('{}');
      };
      if (duringScan) duringScan().then(answer);
      else answer();
    });
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  Object.assign(process.env, {
    PLAGIARISM_WEBHOOK_SECRET: SECRET,
    API_PUBLIC_URL: 'https://api.example.com/',
    COPYLEAKS_EMAIL: 'lms@example.com',
    COPYLEAKS_API_KEY: 'test-api-key-0123',
    COPYLEAKS_SANDBOX: 'true',
    COPYLEAKS_ID_URL: base,
    COPYLEAKS_API_URL: base,
  });
  delete process.env.PLAGIARISM_SUBMIT_URL;

  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  for (const [id, slug] of [
    ['t-h', 'harvard'],
    ['t-m', 'mit'],
  ])
    await admin.tenant.create({ data: { id, slug, name: slug } });
  await admin.user.create({
    data: {
      id: 's1',
      tenantId: 't-h',
      email: 's1@x.edu',
      firstName: 'S',
      lastName: 'L',
      role: 'STUDENT',
      passwordHash: 'x',
      emailVerified: true,
    },
  });
  await admin.user.create({
    data: {
      id: 'teacher',
      tenantId: 't-h',
      email: 't@x.edu',
      firstName: 'T',
      lastName: 'L',
      role: 'INSTRUCTOR',
      passwordHash: 'x',
      emailVerified: true,
    },
  });
  await admin.course.create({ data: { id: 'c1', tenantId: 't-h', code: 'C1', title: 'C1', status: 'PUBLISHED' } });
  await admin.courseInstructor.create({ data: { courseId: 'c1', userId: 'teacher', isPrimary: true } });
  await admin.assignment.create({
    data: { id: 'a1', tenantId: 't-h', courseId: 'c1', title: 'Essay', instructions: 'Write', maxPoints: 100 },
  });
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
  lib = await import('../src/lib/plagiarism-submit.js');
  copyleaks = await import('../src/lib/copyleaks.js');
}, 240_000);

afterAll(async () => {
  fake?.close();
  await admin?.$disconnect();
  await db?.stop();
}, 60_000);

const queue = (data: Record<string, unknown> = {}) =>
  admin.assignmentSubmission.upsert({
    where: { assignmentId_userId: { assignmentId: 'a1', userId: 's1' } },
    create: {
      id: 'sub1',
      assignmentId: 'a1',
      userId: 's1',
      submissionText: TEXT,
      plagiarismStatus: 'PENDING',
      plagiarismAttempts: 0,
      plagiarismNextAttemptAt: new Date(),
      plagiarismScanId: null,
      ...data,
    },
    update: {
      submissionText: TEXT,
      plagiarismStatus: 'PENDING',
      plagiarismAttempts: 0,
      plagiarismNextAttemptAt: new Date(),
      plagiarismScanId: null,
      plagiarismScore: null,
      ...data,
    },
  });
const row = () => admin.assignmentSubmission.findUniqueOrThrow({ where: { id: 'sub1' } });
const scans = () => received.filter((r) => r.method === 'PUT');

/** Plays Copyleaks: posts a status webhook with the header the scan asked for. */
const webhook = (status: string, body: unknown, opts: { token?: string; path?: string } = {}) => {
  const scan = scans().at(-1)!;
  const url = new URL(scan.body.properties.webhooks.status.replace('{STATUS}', status));
  const [, token] = scan.body.properties.webhooks.statusHeaders[0];
  return request(app)
    .post(opts.path ?? url.pathname)
    .set('content-type', 'application/json')
    .set('x-lms-token', opts.token ?? token)
    .send(body as object);
};
const completed = (scanId: string, aggregatedScore: number) => ({
  status: 0,
  scannedDocument: { scanId, totalWords: 14, credits: 0 },
  results: {
    score: { identicalWords: 5, minorChangedWords: 0, relatedMeaningWords: 0, aggregatedScore },
    internet: [],
    database: [],
    batch: [],
    repositories: [],
  },
});

describe('Copyleaks submission', () => {
  it('logs in once, sends the text as a sandbox scan and marks the row SUBMITTED', async () => {
    await queue();
    received = [];
    expect(await lib.submitDuePlagiarismChecks()).toEqual({ submitted: 1, retried: 0, failed: 0 });
    const r = await row();
    expect(r).toMatchObject({ plagiarismStatus: 'SUBMITTED', plagiarismAttempts: 1 });
    expect(r.plagiarismScanId).toMatch(/^sub1-[0-9a-z]+$/);
    expect(r.plagiarismScanId!.length).toBeLessThanOrEqual(36);

    const [login, scan] = received;
    expect(login.body).toEqual({ email: 'lms@example.com', key: 'test-api-key-0123' });
    expect(scan.url).toBe(`/v3/scans/submit/file/${r.plagiarismScanId}`);
    expect(Buffer.from(scan.body.base64, 'base64').toString('utf8')).toBe(TEXT);
    expect(scan.body.properties).toMatchObject({
      sandbox: true,
      webhooks: { status: 'https://api.example.com/api/v1/integrations/copyleaks/harvard/sub1/{STATUS}' },
    });
    expect(scan.body.properties.webhooks.statusHeaders[0]).toEqual([
      'x-lms-token',
      copyleaks.copyleaksWebhookToken('harvard', 'sub1', r.plagiarismScanId!),
    ]);

    // The access token is reused.
    await queue();
    received = [];
    await lib.submitDuePlagiarismChecks();
    expect(received.map((x) => x.url)).toEqual([expect.stringMatching(/^\/v3\/scans\/submit\/file\//)]);
  });

  it('keeps the scan id across retries and treats a 409 (already received) as sent', async () => {
    await queue();
    submitStatus = 503;
    expect((await lib.submitDuePlagiarismChecks()).retried).toBe(1);
    const first = (await row()).plagiarismScanId;
    submitStatus = 409;
    expect((await lib.submitDuePlagiarismChecks({ now: new Date(Date.now() + 120_000) })).submitted).toBe(1);
    expect((await row()).plagiarismScanId).toBe(first);
    expect(
      scans()
        .slice(-2)
        .map((s) => s.url)
    ).toEqual([`/v3/scans/submit/file/${first}`, `/v3/scans/submit/file/${first}`]);
    submitStatus = 201;
  });

  it('logs in again after a 401 and fails on a 4xx refusal', async () => {
    await queue();
    copyleaks.resetCopyleaksToken();
    const before = logins;
    submitStatus = 401;
    expect((await lib.submitDuePlagiarismChecks()).retried).toBe(1);
    submitStatus = 201;
    expect((await lib.submitDuePlagiarismChecks({ now: new Date(Date.now() + 120_000) })).submitted).toBe(1);
    expect(logins).toBe(before + 2);

    await queue();
    submitStatus = 400;
    expect((await lib.submitDuePlagiarismChecks()).failed).toBe(1);
    expect((await row()).plagiarismStatus).toBe('FAILED');
    submitStatus = 201;
  });
});

describe('a learner handing in again while the earlier text is being sent', () => {
  it('leaves the new text queued, and sends it on the next sweep', async () => {
    await queue();
    duringScan = () => queue({ submissionText: `${TEXT} Revised.` });
    expect((await lib.submitDuePlagiarismChecks()).submitted).toBe(1); // the request itself went out
    duringScan = null;
    expect(await row()).toMatchObject({ plagiarismStatus: 'PENDING', plagiarismScanId: null, plagiarismAttempts: 0 });
    received = [];
    expect((await lib.submitDuePlagiarismChecks()).submitted).toBe(1);
    expect(Buffer.from(scans()[0].body.base64, 'base64').toString('utf8')).toBe(`${TEXT} Revised.`);
    expect((await row()).plagiarismStatus).toBe('SUBMITTED');
  });
});

describe('Copyleaks webhooks', () => {
  const sendScan = async () => {
    await queue();
    await lib.submitDuePlagiarismChecks();
    return (await row()).plagiarismScanId!;
  };

  it('records the aggregated score and alerts the staff when it is high', async () => {
    const scanId = await sendScan();
    const res = await webhook('completed', completed(scanId, 47.5));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'recorded', alerted: 1 });
    expect(await row()).toMatchObject({ plagiarismStatus: 'COMPLETE', plagiarismScore: 47.5, plagiarismReportUrl: null });
    expect(await admin.notification.count({ where: { userId: 'teacher', title: { contains: 'High similarity' } } })).toBe(1);

    // Only the first outcome counts: a repeat with another score, or a late error, changes nothing.
    expect((await webhook('completed', completed(scanId, 0))).body).toEqual({ status: 'ignored', reason: 'already settled' });
    expect((await webhook('error', { scannedDocument: { scanId }, error: { code: 1 } })).body).toEqual({
      status: 'ignored',
      reason: 'already settled',
    });
    expect(await row()).toMatchObject({ plagiarismStatus: 'COMPLETE', plagiarismScore: 47.5 });
  });

  it('acknowledges other statuses and marks an error as FAILED', async () => {
    const scanId = await sendScan();
    expect((await webhook('creditsChecked', { scannedDocument: { scanId }, credits: 1 })).body).toEqual({
      status: 'ignored',
      reason: 'creditsChecked',
    });
    expect((await row()).plagiarismStatus).toBe('SUBMITTED');
    const res = await webhook('error', { scannedDocument: { scanId }, error: { code: 13, message: 'Not enough credits' } });
    expect(res.body).toEqual({ status: 'failed' });
    expect((await row()).plagiarismStatus).toBe('FAILED');
  });

  it('drops a result for a scan the learner has since replaced', async () => {
    const old = await sendScan();
    const oldScan = scans().at(-1)!;
    await sendScan();
    const [, oldToken] = oldScan.body.properties.webhooks.statusHeaders[0];
    const res = await webhook('completed', completed(old, 90), { token: oldToken });
    expect(res.body).toEqual({ status: 'ignored', reason: 'superseded' });
    expect((await row()).plagiarismScore).toBeNull();
  });

  it('refuses a missing or wrong token, and a token for another submission or tenant', async () => {
    const scanId = await sendScan();
    const body = completed(scanId, 99);
    expect((await webhook('completed', body, { token: '' })).status).toBe(401);
    expect((await webhook('completed', body, { token: 'ab'.repeat(32) })).status).toBe(401);
    expect((await webhook('completed', completed('other-scan', 99))).status).toBe(401);
    expect((await webhook('completed', body, { path: '/api/v1/integrations/copyleaks/harvard/sub2/completed' })).status).toBe(401);
    expect((await webhook('completed', body, { path: '/api/v1/integrations/copyleaks/mit/sub1/completed' })).status).toBe(401);
    // A valid token for a tenant that does not hold the submission still finds nothing.
    const mitToken = copyleaks.copyleaksWebhookToken('mit', 'sub1', scanId);
    expect((await webhook('completed', body, { token: mitToken, path: '/api/v1/integrations/copyleaks/mit/sub1/completed' })).status).toBe(
      404
    );
    expect((await row()).plagiarismScore).toBeNull();
  });
});
