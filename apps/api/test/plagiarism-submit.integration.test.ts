import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { AddressInfo } from 'net';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// Outbound similarity checks against a real PostgreSQL and a local stand-in for the provider.

const SECRET = 'plagiarism-secret-'.padEnd(40, 'x');
const TEXT = 'This is a sufficiently long essay body, written to be checked for similarity.';
let db: TestDatabase;
let admin: PrismaClient;
let provider: http.Server;
let received: { headers: http.IncomingHttpHeaders; body: any }[] = [];
let respondWith = 200;
let lib: typeof import('../src/lib/plagiarism-submit.js');
let signCallback: typeof import('../src/routes/integrations.routes.js').signCallback;

beforeAll(async () => {
  provider = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      received.push({ headers: req.headers, body: { raw, ...JSON.parse(raw) } });
      res.statusCode = respondWith;
      res.end();
    });
  });
  await new Promise<void>((r) => provider.listen(0, '127.0.0.1', r));
  process.env.PLAGIARISM_WEBHOOK_SECRET = SECRET;
  process.env.PLAGIARISM_SUBMIT_URL = `http://127.0.0.1:${(provider.address() as AddressInfo).port}/checks`;
  process.env.API_PUBLIC_URL = 'https://api.example.com/';

  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  await admin.tenant.create({ data: { id: 't-h', slug: 'harvard', name: 'harvard' } });
  await admin.user.create({ data: { id: 's1', tenantId: 't-h', email: 's1@x.edu', firstName: 'S', lastName: 'L', role: 'STUDENT', passwordHash: 'x', emailVerified: true } });
  await admin.course.create({ data: { id: 'c1', tenantId: 't-h', code: 'C1', title: 'C1', status: 'PUBLISHED' } });
  await admin.assignment.create({ data: { id: 'a1', tenantId: 't-h', courseId: 'c1', title: 'Essay', instructions: 'Write', maxPoints: 100 } });
  process.env.DATABASE_URL = db.appUrl;
  lib = await import('../src/lib/plagiarism-submit.js');
  ({ signCallback } = await import('../src/routes/integrations.routes.js'));
}, 240_000);

afterAll(async () => {
  provider?.close();
  await admin?.$disconnect();
  await db?.stop();
}, 60_000);

const queue = (data: Record<string, unknown> = {}) =>
  admin.assignmentSubmission.upsert({
    where: { assignmentId_userId: { assignmentId: 'a1', userId: 's1' } },
    create: { assignmentId: 'a1', userId: 's1', submissionText: TEXT, plagiarismStatus: 'PENDING', plagiarismAttempts: 0, plagiarismNextAttemptAt: new Date(), ...data },
    update: { submissionText: TEXT, plagiarismStatus: 'PENDING', plagiarismAttempts: 0, plagiarismNextAttemptAt: new Date(), ...data },
  });
const row = () => admin.assignmentSubmission.findFirstOrThrow({ where: { assignmentId: 'a1', userId: 's1' } });

describe('outbound plagiarism submission', () => {
  it('only checks substantial text', () => {
    expect(lib.shouldCheckPlagiarism(TEXT)).toBe(true);
    expect(lib.shouldCheckPlagiarism('too short')).toBe(false);
    expect(lib.shouldCheckPlagiarism(null)).toBe(false);
  });

  it('sends a signed request with a callback address and marks the row SUBMITTED', async () => {
    await queue();
    received = [];
    const r = await lib.submitDuePlagiarismChecks();
    expect(r).toEqual({ submitted: 1, retried: 0, failed: 0 });
    expect(received).toHaveLength(1);
    const { headers, body } = received[0];
    expect(headers['x-lms-signature']).toBe(`sha256=${signCallback(SECRET, String(headers['x-lms-timestamp']), body.raw)}`);
    expect(body).toMatchObject({ text: TEXT, authorId: 's1', callbackUrl: 'https://api.example.com/api/v1/integrations/plagiarism/harvard' });
    expect(await row()).toMatchObject({ plagiarismStatus: 'SUBMITTED', plagiarismAttempts: 1, plagiarismNextAttemptAt: null });
    expect((await lib.submitDuePlagiarismChecks()).submitted).toBe(0); // nothing left to send
  });

  it('retries a 5xx later and does not send before it is due', async () => {
    await queue();
    respondWith = 503;
    expect(await lib.submitDuePlagiarismChecks()).toEqual({ submitted: 0, retried: 1, failed: 0 });
    const r = await row();
    expect(r).toMatchObject({ plagiarismStatus: 'PENDING', plagiarismAttempts: 1 });
    expect(r.plagiarismNextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 30_000);
    received = [];
    expect((await lib.submitDuePlagiarismChecks()).retried).toBe(0);
    expect(received).toHaveLength(0);
    respondWith = 200;
    expect((await lib.submitDuePlagiarismChecks({ now: new Date(Date.now() + 120_000) })).submitted).toBe(1);
  });

  it('gives up on a 4xx, and after the last attempt', async () => {
    await queue();
    respondWith = 400;
    expect(await lib.submitDuePlagiarismChecks()).toEqual({ submitted: 0, retried: 0, failed: 1 });
    expect((await row()).plagiarismStatus).toBe('FAILED');

    await queue({ plagiarismAttempts: lib.SUBMIT_MAX_ATTEMPTS - 1 });
    respondWith = 500;
    expect((await lib.submitDuePlagiarismChecks()).failed).toBe(1);
    respondWith = 200;
  });
});
