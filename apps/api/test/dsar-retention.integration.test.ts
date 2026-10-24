import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import { randomUUID } from 'crypto';
import os from 'os';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// Data-subject requests (lib/data-requests.ts): filing, the administrators' queue, assigning, fulfilling (export,
// erasure, directory opt-out), rejecting, cancelling, the reminder job; and data retention (lib/retention.ts):
// the policy, dry runs, the real run with its row cap, what is never touched. Real PostgreSQL and RLS.

const PASSWORD = 'CorrectHorse1!';
const DAY = 24 * 60 * 60 * 1000;
let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;
let mailer: typeof import('../src/lib/mailer.js');
let dsar: typeof import('../src/lib/data-requests.js');
let retention: typeof import('../src/lib/retention.js');
let docs: typeof import('../src/openapi/responses/privacy-requests.js');
let storageDir: string;
const keys: Record<string, string> = {};
const outbox: { to: string; subject: string; text: string }[] = [];

beforeAll(async () => {
  process.env.LOGIN_RATE_LIMIT_MAX = '1000';
  process.env.DSAR_DUE_DAYS = '30';
  process.env.RETENTION_ROW_CAP = '5000';
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  await admin.tenant.create({ data: { id: 't-a', slug: 'acme', name: 'Acme College', tier: 'ENTERPRISE' } });
  await admin.tenant.create({ data: { id: 't-b', slug: 'beta', name: 'Beta College', tier: 'ENTERPRISE' } });
  for (const id of ['a-admin', 'a-admin2']) await user(id, 't-a', 'TENANT_ADMIN');
  for (const id of ['s1', 's2', 's3', 's4', 's5', 's6']) await user(id, 't-a', 'STUDENT');
  await user('b-admin', 't-b', 'TENANT_ADMIN');
  await user('b-student', 't-b', 'STUDENT');
  process.env.DATABASE_URL = db.appUrl;
  storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsar-retention-'));
  app = (await import('../src/server.js')).app;
  mailer = await import('../src/lib/mailer.js');
  dsar = await import('../src/lib/data-requests.js');
  retention = await import('../src/lib/retention.js');
  docs = await import('../src/openapi/responses/privacy-requests.js');
  const storage = await import('../src/lib/storage.js');
  storage.setStorageDriver(storage.localDriver(storageDir));
}, 240_000);

afterAll(async () => {
  await admin?.$disconnect();
  await db?.stop();
  fs.rmSync(storageDir, { recursive: true, force: true });
}, 60_000);

beforeEach(() => {
  outbox.length = 0;
  mailer.setMailer({
    async send(m) {
      outbox.push(m);
    },
  });
});

function user(id: string, tenantId: string, role: any) {
  return admin.user.create({
    data: {
      id,
      tenantId,
      email: `${id}@x.edu`,
      firstName: id,
      lastName: 'L',
      role,
      passwordHash: bcrypt.hashSync(PASSWORD, 4),
      emailVerified: true,
    },
  });
}

async function as(who: string, tenant: string) {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/v1/auth/login')
    .set('x-tenant-id', tenant)
    .send({ email: `${who}@x.edu`, password: PASSWORD });
  expect(res.status, `login as ${who}`).toBe(200);
  return agent;
}

/** Checks a response body against the schema the API description promises for that operation. */
const matchesDocs = (key: string, body: unknown) => {
  const doc = docs.DSAR_DOCS[key];
  expect(doc, key).toBeDefined();
  const parsed = doc!.response!.schema!.safeParse(body);
  expect(parsed.success, `${key}: ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`).toBe(true);
};

const audits = (action: string, tenantId = 't-a') => admin.auditLog.count({ where: { tenantId, action } });

describe('data-subject requests', () => {
  it('a person files a request; it is due in 30 days, audited and e-mailed; duplicates and floods are refused', async () => {
    const s1 = await as('s1', 'acme');
    const before = Date.now();
    const res = await s1.post('/api/v1/privacy/requests').send({ kind: 'ACCESS', details: 'Please send me everything.' });
    expect(res.status).toBe(201);
    matchesDocs('POST /api/v1/privacy/requests', res.body);
    expect(res.body.data).toMatchObject({
      kind: 'ACCESS',
      status: 'OPEN',
      details: 'Please send me everything.',
      overdue: false,
      exportAttached: false,
    });
    const due = new Date(res.body.data.dueAt).getTime();
    expect(due).toBeGreaterThanOrEqual(before + 30 * DAY);
    expect(due).toBeLessThanOrEqual(Date.now() + 30 * DAY);
    expect(res.body.data.daysLeft).toBe(30);
    expect(res.body.data.notes).toBeUndefined(); // internal fields are for administrators
    expect(await audits('DATA_REQUEST_FILED')).toBe(1);
    expect(outbox.map((m) => m.to).sort()).toEqual(['a-admin2@x.edu', 'a-admin@x.edu', 's1@x.edu']);
    expect(outbox.find((m) => m.to === 's1@x.edu')!.subject).toMatch(/received/i);

    expect((await s1.post('/api/v1/privacy/requests').send({ kind: 'ACCESS' })).status).toBe(409); // same kind still open
    expect((await s1.post('/api/v1/privacy/requests').send({ kind: 'NONSENSE' })).status).toBe(400);
    for (const kind of ['CORRECTION', 'RESTRICTION', 'OBJECTION', 'OTHER'])
      expect((await s1.post('/api/v1/privacy/requests').send({ kind, details: 'x' })).status).toBe(201);
    expect((await s1.post('/api/v1/privacy/requests').send({ kind: 'ERASURE' })).status).toBe(409); // five open at most

    const mine = await s1.get('/api/v1/privacy/requests/mine');
    expect(mine.status).toBe(200);
    matchesDocs('GET /api/v1/privacy/requests/mine', mine.body);
    expect(mine.body.data).toHaveLength(5);
  });

  it('the queue is for administrators of the organisation only', async () => {
    const s1 = await as('s1', 'acme');
    expect((await s1.get('/api/v1/privacy/requests')).status).toBe(403);
    expect((await s1.get('/api/v1/privacy/retention')).status).toBe(403);

    const a = await as('a-admin', 'acme');
    const queue = await a.get('/api/v1/privacy/requests');
    expect(queue.status).toBe(200);
    matchesDocs('GET /api/v1/privacy/requests', queue.body);
    expect(queue.body.data).toHaveLength(5);
    expect(queue.body.summary).toEqual({ open: 5, overdue: 0 });
    const access = queue.body.data.find((r: any) => r.kind === 'ACCESS');
    expect(access.requester).toEqual({ name: 's1 L', email: 's1@x.edu' });
    // Most urgent first: filed in this order, so the deadlines ascend.
    const dues = queue.body.data.map((r: any) => r.dueAt);
    expect([...dues].sort()).toEqual(dues);

    expect((await a.get('/api/v1/privacy/requests?kind=ACCESS')).body.data).toHaveLength(1);
    expect((await a.get('/api/v1/privacy/requests?status=FULFILLED')).body.data).toHaveLength(0);
    expect((await a.get('/api/v1/privacy/requests?overdue=true')).body.data).toHaveLength(0);
    expect((await a.get('/api/v1/privacy/requests?status=bogus')).status).toBe(400);

    // Another organisation sees none of it, and cannot reach it by id.
    const b = await as('b-admin', 'beta');
    expect((await b.get('/api/v1/privacy/requests')).body.data).toEqual([]);
    expect((await b.post(`/api/v1/privacy/requests/${access.id}/reject`).send({ reason: 'not yours' })).status).toBe(404);
    expect((await b.patch(`/api/v1/privacy/requests/${access.id}`).send({ notes: 'x' })).status).toBe(404);
  });

  it('assigning starts the work and tells the person; notes stay internal; people cannot decide their own request', async () => {
    const a = await as('a-admin', 'acme');
    const a2 = await as('a-admin2', 'acme');
    const s1 = await as('s1', 'acme');
    const access = (await a.get('/api/v1/privacy/requests?kind=ACCESS')).body.data[0];

    expect((await a.patch(`/api/v1/privacy/requests/${access.id}`).send({})).status).toBe(400);
    expect((await a.patch(`/api/v1/privacy/requests/${access.id}`).send({ assignedToId: 's2' })).status).toBe(400); // not an administrator
    expect((await a.patch(`/api/v1/privacy/requests/${access.id}`).send({ assignedToId: 'nobody' })).status).toBe(400);

    const taken = await a2
      .patch(`/api/v1/privacy/requests/${access.id}`)
      .send({ assignedToId: 'a-admin2', notes: 'Checked identity by phone.' });
    expect(taken.status).toBe(200);
    matchesDocs('PATCH /api/v1/privacy/requests/:id', taken.body);
    expect(taken.body.data).toMatchObject({ status: 'IN_PROGRESS', assignedToId: 'a-admin2', notes: 'Checked identity by phone.' });
    expect(outbox.filter((m) => m.to === 's1@x.edu').map((m) => m.subject)).toEqual(['Your data request is being handled']);
    expect(await audits('DATA_REQUEST_ASSIGNED')).toBe(1);
    expect(await audits('DATA_REQUEST_NOTE_CHANGED')).toBe(1);

    // The person sees the status but never the internal notes or assignee.
    const mine = (await s1.get('/api/v1/privacy/requests/mine')).body.data.find((r: any) => r.id === access.id);
    expect(mine.status).toBe('IN_PROGRESS');
    expect(mine.notes).toBeUndefined();
    expect(mine.assignedToId).toBeUndefined();

    // Back into the queue.
    const back = await a2.patch(`/api/v1/privacy/requests/${access.id}`).send({ assignedToId: null });
    expect(back.body.data.status).toBe('OPEN');
    await a2.patch(`/api/v1/privacy/requests/${access.id}`).send({ assignedToId: 'a-admin' });

    // An administrator's own request must be decided by someone else.
    const own = await a.post('/api/v1/privacy/requests').send({ kind: 'OTHER', details: 'About me.' });
    expect(own.status).toBe(201);
    expect((await a.post(`/api/v1/privacy/requests/${own.body.data.id}/fulfil`).send({ resolution: 'ok' })).status).toBe(403);
    expect((await a.post(`/api/v1/privacy/requests/${own.body.data.id}/reject`).send({ reason: 'no way' })).status).toBe(403);
    expect((await a2.post(`/api/v1/privacy/requests/${own.body.data.id}/fulfil`).send({ resolution: 'Done.' })).status).toBe(200);
  });

  it('fulfilling an access request attaches the data; only the requester can download it', async () => {
    const a2 = await as('a-admin2', 'acme');
    const s1 = await as('s1', 'acme');
    const s2 = await as('s2', 'acme');
    const access = (await a2.get('/api/v1/privacy/requests?kind=ACCESS')).body.data[0];

    expect((await s1.get(`/api/v1/privacy/requests/${access.id}/export`)).status).toBe(409); // nothing attached yet
    outbox.length = 0;
    const done = await a2.post(`/api/v1/privacy/requests/${access.id}/fulfil`).send({});
    expect(done.status).toBe(200);
    matchesDocs('POST /api/v1/privacy/requests/:id/fulfil', done.body);
    expect(done.body.data).toMatchObject({ status: 'FULFILLED', exportAttached: true, closedById: 'a-admin2', daysLeft: null });
    expect(done.body.data.resolution).toMatch(/attached/);
    expect(outbox.map((m) => m.to)).toEqual(['s1@x.edu']);
    expect(await audits('DATA_REQUEST_FULFILLED')).toBeGreaterThanOrEqual(1);

    const file = await s1.get(`/api/v1/privacy/requests/${access.id}/export`);
    expect(file.status).toBe(200);
    expect(file.headers['content-disposition']).toMatch(/personal-data-s1/);
    expect(file.body.profile).toMatchObject({ id: 's1', email: 's1@x.edu' });
    expect((await s2.get(`/api/v1/privacy/requests/${access.id}/export`)).status).toBe(404); // someone else's request

    expect((await a2.post(`/api/v1/privacy/requests/${access.id}/fulfil`).send({})).status).toBe(409); // already closed
    expect((await s1.post(`/api/v1/privacy/requests/${access.id}/cancel`).send({})).status).toBe(409);
  });

  it('an erasure request erases the account when fulfilled and the person still hears about it', async () => {
    const s3 = await as('s3', 'acme');
    const a = await as('a-admin', 'acme');
    const filed = await s3.post('/api/v1/privacy/requests').send({ kind: 'ERASURE', details: 'Delete me.' });
    expect(filed.status).toBe(201);
    outbox.length = 0;
    const done = await a.post(`/api/v1/privacy/requests/${filed.body.data.id}/fulfil`).send({});
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe('FULFILLED');
    const erased = await admin.user.findUniqueOrThrow({ where: { id: 's3' } });
    expect(erased).toMatchObject({ email: 'erased-s3@erased.invalid', firstName: 'Erased', status: 'SUSPENDED' });
    expect(erased.erasedAt).not.toBeNull();
    expect(outbox.map((m) => m.to)).toEqual(['s3@x.edu']);
    expect(await audits('USER_ERASED')).toBe(1);
    // Their session is gone and the queue shows the erased person without an address.
    expect((await s3.get('/api/v1/privacy/requests/mine')).status).toBe(401);
    const row = (await a.get('/api/v1/privacy/requests?status=FULFILLED&kind=ERASURE')).body.data[0];
    expect(row.requester).toEqual({ name: 'Erased', email: null });
  });

  it('an opt-out request hides the person from classmates; a free-form request needs an answer', async () => {
    const s4 = await as('s4', 'acme');
    const a = await as('a-admin', 'acme');
    const opt = (await s4.post('/api/v1/privacy/requests').send({ kind: 'FERPA_OPT_OUT' })).body.data;
    expect((await a.post(`/api/v1/privacy/requests/${opt.id}/fulfil`).send({})).status).toBe(200);
    expect((await admin.user.findUniqueOrThrow({ where: { id: 's4' } })).directoryOptOut).toBe(true);

    const other = (await s4.post('/api/v1/privacy/requests').send({ kind: 'OTHER', details: 'Question.' })).body.data;
    expect((await a.post(`/api/v1/privacy/requests/${other.id}/fulfil`).send({})).status).toBe(400);
    const answered = await a.post(`/api/v1/privacy/requests/${other.id}/fulfil`).send({ resolution: 'We keep records for six years.' });
    expect(answered.body.data.resolution).toBe('We keep records for six years.');
  });

  it('rejecting needs a reason, tells the person why, and closes the request', async () => {
    const s5 = await as('s5', 'acme');
    const a = await as('a-admin', 'acme');
    const filed = (await s5.post('/api/v1/privacy/requests').send({ kind: 'OBJECTION', details: 'I object.' })).body.data;
    expect((await a.post(`/api/v1/privacy/requests/${filed.id}/reject`).send({})).status).toBe(400);
    expect((await a.post(`/api/v1/privacy/requests/${filed.id}/reject`).send({ reason: 'x' })).status).toBe(400);
    outbox.length = 0;
    const res = await a.post(`/api/v1/privacy/requests/${filed.id}/reject`).send({ reason: 'We have a legal duty to keep exam records.' });
    expect(res.status).toBe(200);
    matchesDocs('POST /api/v1/privacy/requests/:id/reject', res.body);
    expect(res.body.data).toMatchObject({ status: 'REJECTED', resolution: 'We have a legal duty to keep exam records.' });
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toBe('s5@x.edu');
    expect(outbox[0].text).toContain('We have a legal duty to keep exam records.');
    expect(await audits('DATA_REQUEST_REJECTED')).toBe(1);
    expect((await a.post(`/api/v1/privacy/requests/${filed.id}/reject`).send({ reason: 'again' })).status).toBe(409);
    expect((await a.post(`/api/v1/privacy/requests/${filed.id}/fulfil`).send({ resolution: 'x' })).status).toBe(409);
    expect((await a.patch(`/api/v1/privacy/requests/${filed.id}`).send({ notes: 'late' })).status).toBe(409);
  });

  it('a person cancels their own open request, and nobody else can', async () => {
    const s6 = await as('s6', 'acme');
    const s5 = await as('s5', 'acme');
    const filed = (await s6.post('/api/v1/privacy/requests').send({ kind: 'RESTRICTION' })).body.data;
    expect((await s5.post(`/api/v1/privacy/requests/${filed.id}/cancel`).send({})).status).toBe(404);
    const res = await s6.post(`/api/v1/privacy/requests/${filed.id}/cancel`).send({});
    expect(res.status).toBe(200);
    matchesDocs('POST /api/v1/privacy/requests/:id/cancel', res.body);
    expect(res.body.data.status).toBe('CANCELLED');
    expect(await audits('DATA_REQUEST_CANCELLED')).toBe(1);
    // Cancelled requests no longer count against the limit and the kind can be filed again.
    expect((await s6.post('/api/v1/privacy/requests').send({ kind: 'RESTRICTION' })).status).toBe(201);
  });

  it('warns the administrators once when a request is due within five days and once when it is overdue', async () => {
    const a = await as('a-admin', 'acme');
    const open = (await a.get('/api/v1/privacy/requests?status=open')).body.data;
    expect(open.length).toBeGreaterThanOrEqual(3);
    const [first, second, third] = open;
    const now = new Date();
    const setDue = (id: string, d: Date) => admin.dataRequest.update({ where: { id }, data: { dueAt: d, reminderStage: 0 } });
    await admin.dataRequest.updateMany({ where: { tenantId: 't-a', status: { in: ['OPEN', 'IN_PROGRESS'] } }, data: { reminderStage: 2 } }); // quiet the rest
    await setDue(first.id, new Date(now.getTime() + 3 * DAY));
    await setDue(second.id, new Date(now.getTime() + 20 * DAY)); // not yet due soon
    await setDue(third.id, new Date(now.getTime() - 2 * DAY));

    outbox.length = 0;
    expect(await dsar.runDsarJob(now)).toEqual({ dueSoon: 1, overdue: 1 });
    const subjects = outbox.map((m) => m.subject);
    expect(subjects.filter((s) => /due within 5 days/.test(s))).toHaveLength(2); // one per administrator
    expect(subjects.filter((s) => /overdue/.test(s))).toHaveLength(2);
    expect(new Set(outbox.map((m) => m.to))).toEqual(new Set(['a-admin@x.edu', 'a-admin2@x.edu']));
    expect(await audits('DATA_REQUEST_REMINDER_SENT')).toBe(2);

    // Once per stage: a second round (even much later) is silent for what was already warned.
    outbox.length = 0;
    expect(await dsar.runDsarJob(new Date(now.getTime() + 1 * DAY))).toEqual({ dueSoon: 0, overdue: 0 });
    expect(outbox).toHaveLength(0);

    // The first request was already warned as due soon, so passing its deadline brings the overdue warning only.
    expect(await dsar.runDsarJob(new Date(now.getTime() + 4 * DAY))).toEqual({ dueSoon: 0, overdue: 1 });
    // The second request comes within five days later on, then passes its deadline: one warning for each.
    expect(await dsar.runDsarJob(new Date(now.getTime() + 17 * DAY))).toEqual({ dueSoon: 1, overdue: 0 });
    expect(await dsar.runDsarJob(new Date(now.getTime() + 21 * DAY))).toEqual({ dueSoon: 0, overdue: 1 });

    const queue = await a.get('/api/v1/privacy/requests?overdue=true');
    expect(queue.body.data.length).toBeGreaterThanOrEqual(1);
    expect(queue.body.data[0].overdue).toBe(true);
    expect(queue.body.summary.overdue).toBeGreaterThanOrEqual(1);
  });
});

describe('data retention', () => {
  const old = (days: number) => new Date(Date.now() - days * DAY);
  const seed = async () => {
    await admin.course.create({ data: { id: 'c1', tenantId: 't-a', code: 'C1', title: 'C1', status: 'PUBLISHED' } });
    await admin.quiz.create({ data: { id: 'q1', tenantId: 't-a', courseId: 'c1', title: 'Exam' } });
    await admin.quizSubmission.create({
      data: { id: 'sub1', quizId: 'q1', userId: 's1', maxScore: 10, score: 7, answersJson: {}, submittedAt: old(200) },
    });
    // Notifications: two old, one recent.
    for (const [id, days] of [
      ['n-old1', 100],
      ['n-old2', 61],
      ['n-new', 5],
    ] as const)
      await admin.notification.create({ data: { id, tenantId: 't-a', userId: 's1', category: 'SYSTEM', title: id, createdAt: old(days) } });
    // Tokens: used long ago, expired long ago, still valid, expired a day ago.
    const tok = (id: string, over: object) => ({ id, tenantId: 't-a', userId: 's1', tokenHash: `h-${id}`, expiresAt: old(-10), ...over });
    await admin.passwordResetToken.create({ data: tok('p-used', { expiresAt: old(-1), usedAt: old(40) }) });
    await admin.passwordResetToken.create({ data: tok('p-expired', { expiresAt: old(40) }) });
    await admin.passwordResetToken.create({ data: tok('p-valid', {}) });
    await admin.emailVerificationToken.create({ data: tok('e-expired', { expiresAt: old(40) }) });
    await admin.emailVerificationToken.create({ data: tok('e-recent', { expiresAt: old(1) }) });
    // Proctoring evidence, old and recent.
    await admin.proctoringLog.create({
      data: {
        id: 'pl-old',
        submissionId: 'sub1',
        eventType: 'FACE_NOT_DETECTED',
        severity: 'HIGH',
        timestamp: old(100),
        snapshotUrl: 'https://cdn.example/s1.png',
        metadataJson: { score: 0.1 },
      },
    });
    await admin.proctoringLog.create({
      data: {
        id: 'pl-new',
        submissionId: 'sub1',
        eventType: 'TAB_SWITCH',
        severity: 'LOW',
        timestamp: old(2),
        snapshotUrl: 'https://cdn.example/s2.png',
        metadataJson: { n: 1 },
      },
    });
    // Support passes: ended long ago, ended lately, still running.
    const pass = (id: string, over: object) => ({
      id,
      tenantId: 't-a',
      reason: 'Help',
      grantedByEmail: 'a@x.edu',
      expiresAt: old(-1),
      ...over,
    });
    await admin.supportPass.create({ data: pass('sp-old', { expiresAt: old(200) }) });
    await admin.supportPass.create({ data: pass('sp-revoked', { expiresAt: old(-1), revokedAt: old(150) }) });
    await admin.supportPass.create({ data: pass('sp-new', { expiresAt: old(20) }) });
    await admin.supportPass.create({ data: pass('sp-live', {}) });
    await admin.supportHandoff.create({
      data: { id: 'sh-old', tenantId: 't-a', passId: 'sp-old', tokenHash: 'hh-old', operatorEmail: 'op@x.edu', expiresAt: old(200) },
    });
    // Infected and clean uploads, with bytes in storage.
    const { storage } = await import('../src/lib/storage.js');
    for (const [id, scanStatus, scannedAt] of [
      ['f-bad-old', 'INFECTED', old(40)],
      ['f-bad-new', 'INFECTED', old(1)],
      ['f-clean', 'CLEAN', old(300)],
    ] as const) {
      const temp = path.join(os.tmpdir(), `retention-${id}`);
      fs.writeFileSync(temp, id);
      keys[id] = `t-a/${randomUUID()}`;
      await storage().putFile(keys[id], temp, 'text/plain');
      await admin.storedFile.create({
        data: {
          id,
          tenantId: 't-a',
          courseId: 'c1',
          purpose: 'LESSON_MEDIA',
          storageKey: keys[id],
          filename: id,
          contentType: 'text/plain',
          sizeBytes: id.length,
          sha256: 'x',
          scanStatus,
          scannedAt,
        },
      });
    }
    // What is never touched: a grade, a certificate-bearing enrolment, an old audit entry.
    await admin.auditLog.create({ data: { tenantId: 't-a', action: 'OLD_EVENT', resourceType: 'X', createdAt: old(3000) } });
    // Another organisation's old data stays out of reach of acme's policy.
    await admin.notification.create({
      data: { id: 'n-b-old', tenantId: 't-b', userId: 'b-student', category: 'SYSTEM', title: 'b', createdAt: old(500) },
    });
  };

  const policy = {
    enabled: true,
    dryRun: true,
    notificationsDays: 60,
    tokensDays: 30,
    proctoringDays: 90,
    supportAccessDays: 120,
    infectedFilesDays: 30,
  };
  const has = async (
    model: 'notification' | 'passwordResetToken' | 'emailVerificationToken' | 'supportPass' | 'supportHandoff' | 'storedFile',
    id: string
  ) => !!(await (admin as any)[model].findUnique({ where: { id } }));

  it('is off by default and validates what it is given', async () => {
    const a = await as('a-admin', 'acme');
    const def = await a.get('/api/v1/privacy/retention');
    expect(def.status).toBe(200);
    matchesDocs('GET /api/v1/privacy/retention', def.body);
    expect(def.body.data).toMatchObject({ enabled: false, dryRun: true, notificationsDays: null, lastRun: null, rowCap: 5000 });
    expect(def.body.data.classes.map((c: any) => c.key)).toEqual([
      'notifications',
      'tokens',
      'proctoring',
      'supportAccess',
      'infectedFiles',
    ]);

    expect((await a.post('/api/v1/privacy/retention/run').send({})).status).toBe(409); // no policy yet
    expect((await a.put('/api/v1/privacy/retention').send({ ...policy, notificationsDays: 5 })).status).toBe(400); // under the minimum
    expect((await a.put('/api/v1/privacy/retention').send({ ...policy, supportAccessDays: 30 })).status).toBe(400);
    expect((await a.put('/api/v1/privacy/retention').send({ enabled: true })).status).toBe(400);
    expect((await a.put('/api/v1/privacy/retention').send({ ...policy, tokensDays: 4000 })).status).toBe(400);

    const saved = await a.put('/api/v1/privacy/retention').send(policy);
    expect(saved.status).toBe(200);
    matchesDocs('PUT /api/v1/privacy/retention', saved.body);
    expect(saved.body.data).toMatchObject(policy);
    expect(await audits('RETENTION_POLICY_CHANGED')).toBe(1);
    await a.put('/api/v1/privacy/retention').send({ ...policy, enabled: false });
  });

  it('a dry run counts what a run would remove and removes nothing', async () => {
    await seed();
    const a = await as('a-admin', 'acme');
    await a.put('/api/v1/privacy/retention').send(policy);
    const run = await a.post('/api/v1/privacy/retention/run').send({ dryRun: true });
    expect(run.status).toBe(200);
    matchesDocs('POST /api/v1/privacy/retention/run', run.body);
    expect(run.body.data.dryRun).toBe(true);
    expect(run.body.data.counts).toEqual({ notifications: 2, tokens: 3, proctoring: 1, supportAccess: 2, infectedFiles: 1 });
    expect(await has('notification', 'n-old1')).toBe(true);
    expect(await has('passwordResetToken', 'p-used')).toBe(true);
    expect(await has('supportPass', 'sp-old')).toBe(true);
    expect(await has('storedFile', 'f-bad-old')).toBe(true);
    expect((await admin.proctoringLog.findUniqueOrThrow({ where: { id: 'pl-old' } })).snapshotUrl).not.toBeNull();
    expect(await audits('RETENTION_DRY_RUN')).toBe(1);

    const shown = await a.get('/api/v1/privacy/retention');
    expect(shown.body.data.lastRun).toMatchObject({ dryRun: true, counts: { notifications: 2, tokens: 3 } });
  });

  it('a policy that is not enabled is only ever run dry, even when asked for a real run', async () => {
    const a = await as('a-admin', 'acme');
    await a.put('/api/v1/privacy/retention').send({ ...policy, enabled: false, dryRun: false });
    const run = await a.post('/api/v1/privacy/retention/run').send({ dryRun: false });
    expect(run.body.data.dryRun).toBe(true);
    expect(await has('notification', 'n-old1')).toBe(true);
  });

  it('a real run removes the old data of its own organisation and leaves the rest', async () => {
    const a = await as('a-admin', 'acme');
    await a.put('/api/v1/privacy/retention').send({ ...policy, dryRun: false });
    const run = await a.post('/api/v1/privacy/retention/run').send({});
    expect(run.status).toBe(200);
    expect(run.body.data.dryRun).toBe(false);
    expect(run.body.data.counts).toEqual({ notifications: 2, tokens: 3, proctoring: 1, supportAccess: 2, infectedFiles: 1 });
    expect(run.body.data.remaining).toEqual({ notifications: 0, tokens: 0, proctoring: 0, supportAccess: 0, infectedFiles: 0 });

    expect(await has('notification', 'n-old1')).toBe(false);
    expect(await has('notification', 'n-old2')).toBe(false);
    expect(await has('notification', 'n-new')).toBe(true);
    expect(await has('passwordResetToken', 'p-used')).toBe(false);
    expect(await has('passwordResetToken', 'p-expired')).toBe(false);
    expect(await has('emailVerificationToken', 'e-expired')).toBe(false);
    expect(await has('passwordResetToken', 'p-valid')).toBe(true);
    expect(await has('emailVerificationToken', 'e-recent')).toBe(true);
    expect(await has('supportPass', 'sp-old')).toBe(false);
    expect(await has('supportPass', 'sp-revoked')).toBe(false);
    expect(await has('supportHandoff', 'sh-old')).toBe(false);
    expect(await has('supportPass', 'sp-new')).toBe(true);
    expect(await has('supportPass', 'sp-live')).toBe(true);
    expect(await has('storedFile', 'f-bad-old')).toBe(false);
    expect(fs.existsSync(path.join(storageDir, keys['f-bad-old']))).toBe(false); // the bytes went too
    expect(await has('storedFile', 'f-bad-new')).toBe(true);
    expect(await has('storedFile', 'f-clean')).toBe(true);

    // Evidence cleared, the event itself kept; recent evidence kept.
    const oldLog = await admin.proctoringLog.findUniqueOrThrow({ where: { id: 'pl-old' } });
    expect(oldLog).toMatchObject({ eventType: 'FACE_NOT_DETECTED', severity: 'HIGH', snapshotUrl: null, metadataJson: null });
    expect((await admin.proctoringLog.findUniqueOrThrow({ where: { id: 'pl-new' } })).snapshotUrl).toBe('https://cdn.example/s2.png');

    // Never touched: grades and submissions, the audit trail, another organisation's data.
    expect(await admin.quizSubmission.count({ where: { id: 'sub1' } })).toBe(1);
    expect(await admin.auditLog.count({ where: { action: 'OLD_EVENT' } })).toBe(1);
    expect(await has('notification', 'n-b-old')).toBe(true);

    // The run is audited with its counts.
    const entry = await admin.auditLog.findFirstOrThrow({ where: { tenantId: 't-a', action: 'RETENTION_RUN' } });
    expect(entry.userId).toBe('a-admin');
    expect(entry.diffJson).toMatchObject({ by: 'ADMINISTRATOR', counts: { notifications: 2, expiredLinks: 3 } });
    expect((await a.get('/api/v1/privacy/retention')).body.data.lastRun).toMatchObject({ dryRun: false, counts: { notifications: 2 } });
  });

  it('a run is capped per class and the next run carries on', async () => {
    for (let i = 0; i < 5; i++)
      await admin.notification.create({
        data: { id: `cap-${i}`, tenantId: 't-a', userId: 's2', category: 'SYSTEM', title: 'c', createdAt: old(100 + i) },
      });
    const a = await as('a-admin', 'acme');
    await a.put('/api/v1/privacy/retention').send({
      enabled: true,
      dryRun: false,
      notificationsDays: 60,
      tokensDays: null,
      proctoringDays: null,
      supportAccessDays: null,
      infectedFilesDays: null,
    });
    const { runWithTenant } = await import('@enterprise-lms/database');
    const capped = await runWithTenant('t-a', () =>
      retention.applyRetention(
        't-a',
        { notificationsDays: 60, tokensDays: null, proctoringDays: null, supportAccessDays: null, infectedFilesDays: null },
        { dryRun: false, cap: 2 }
      )
    );
    expect(capped.counts.notifications).toBe(2);
    expect(capped.remaining.notifications).toBe(3);
    expect(await admin.notification.count({ where: { tenantId: 't-a', id: { startsWith: 'cap-' } } })).toBe(3);
    const rest = await runWithTenant('t-a', () =>
      retention.applyRetention(
        't-a',
        { notificationsDays: 60, tokensDays: null, proctoringDays: null, supportAccessDays: null, infectedFilesDays: null },
        { dryRun: false, cap: 10 }
      )
    );
    expect(rest.counts.notifications).toBe(3);
    expect(rest.remaining.notifications).toBe(0);
  });

  it('the daily job runs enabled policies once a day and skips the rest', async () => {
    await admin.retentionPolicy.deleteMany({});
    await admin.notification.create({
      data: { id: 'job-old', tenantId: 't-a', userId: 's2', category: 'SYSTEM', title: 'j', createdAt: old(100) },
    });
    await admin.notification.create({
      data: { id: 'job-old-b', tenantId: 't-b', userId: 'b-student', category: 'SYSTEM', title: 'j', createdAt: old(100) },
    });
    const p = { notificationsDays: 60, dryRun: false };
    await admin.retentionPolicy.create({ data: { tenantId: 't-a', enabled: true, ...p } });
    await admin.retentionPolicy.create({ data: { tenantId: 't-b', enabled: false, ...p } }); // not enabled: left alone

    const now = new Date();
    expect(await retention.runRetentionJob(now)).toEqual({ organisations: 1, removed: 1 });
    expect(await has('notification', 'job-old')).toBe(false);
    expect(await has('notification', 'job-old-b')).toBe(true);
    expect(await audits('RETENTION_RUN')).toBeGreaterThanOrEqual(2);
    const entry = await admin.auditLog.findFirstOrThrow({
      where: { tenantId: 't-a', action: 'RETENTION_RUN' },
      orderBy: { createdAt: 'desc' },
    });
    expect(entry.userId).toBeNull();
    expect(entry.diffJson).toMatchObject({ by: 'SCHEDULE' });

    // Within a day it does not run again; a day later it does.
    await admin.notification.create({
      data: { id: 'job-old2', tenantId: 't-a', userId: 's2', category: 'SYSTEM', title: 'j', createdAt: old(100) },
    });
    expect(await retention.runRetentionJob(new Date(now.getTime() + 2 * 60 * 60 * 1000))).toEqual({ organisations: 0, removed: 0 });
    expect(await has('notification', 'job-old2')).toBe(true);
    expect(await retention.runRetentionJob(new Date(now.getTime() + 25 * 60 * 60 * 1000))).toEqual({ organisations: 1, removed: 1 });
    expect(await has('notification', 'job-old2')).toBe(false);
  });
});
