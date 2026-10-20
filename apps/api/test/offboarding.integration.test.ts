import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import yauzl from 'yauzl';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// Organisation offboarding: full exports (contents, secrets left out, who may download them) and scheduled
// deletion (who may schedule and cancel it, the operator's organisation protected, and the job that deletes).

const PASSWORD = 'CorrectHorse1!';
const WEBHOOK_SECRET = 'whsec-do-not-export-4242';
let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;
let jobs: typeof import('../src/lib/offboarding.js');
let tenantExport: typeof import('../src/lib/tenant-export.js');
let storageDir: string;
const outbox: { to: string; subject: string; text: string }[] = [];

/** Stores bytes the way an upload would, and records the StoredFile row. */
async function storeFile(tenantId: string, id: string, courseId: string, filename: string, body: string) {
  const { storage } = await import('../src/lib/storage.js');
  const key = `${tenantId}/${id}`;
  const temp = path.join(os.tmpdir(), `offboarding-test-${id}`);
  fs.writeFileSync(temp, body);
  await storage().putFile(key, temp, 'text/plain');
  await admin.storedFile.create({ data: { id, tenantId, courseId, purpose: 'LESSON_MEDIA', storageKey: key, filename, contentType: 'text/plain', sizeBytes: body.length, sha256: 'x' } });
  return key;
}

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  await admin.tenant.create({ data: { id: 't-op', slug: 'ops', name: 'Operator', tier: 'ENTERPRISE' } });
  await admin.tenant.create({ data: { id: 't-h', slug: 'harvard', name: 'Harvard', tier: 'ENTERPRISE' } });
  await admin.tenant.create({ data: { id: 't-y', slug: 'yale', name: 'Yale', tier: 'ENTERPRISE' } });
  const user = (id: string, tenantId: string, role: any) =>
    admin.user.create({ data: { id, tenantId, email: `${id}@x.edu`, firstName: id, lastName: 'L', role, passwordHash: bcrypt.hashSync(PASSWORD, 4), emailVerified: true } });
  await user('operator', 't-op', 'SUPER_ADMIN');
  await user('h-admin', 't-h', 'TENANT_ADMIN');
  await user('h-student', 't-h', 'STUDENT');
  await user('y-admin', 't-y', 'TENANT_ADMIN');
  await user('y-student', 't-y', 'STUDENT');
  for (const t of ['t-h', 't-y']) {
    // A term: Course -> Term is ON DELETE RESTRICT, which the deletion must cope with.
    await admin.term.create({ data: { id: `${t}-term`, tenantId: t, name: 'Fall', startsOn: new Date('2026-09-01'), endsOn: new Date('2026-12-20') } });
    await admin.course.create({ data: { id: `${t}-c1`, tenantId: t, termId: `${t}-term`, code: 'C1', title: `Course of ${t}`, status: 'PUBLISHED' } });
    await admin.module.create({ data: { id: `${t}-m1`, courseId: `${t}-c1`, title: 'Week 1', orderIndex: 0 } });
    await admin.enrollment.create({ data: { tenantId: t, courseId: `${t}-c1`, userId: t === 't-h' ? 'h-student' : 'y-student' } });
    await admin.auditLog.create({ data: { tenantId: t, action: 'SOMETHING', resourceType: 'TEST' } });
  }
  // Support access: tenant tables without a foreign key to Tenant.
  for (const t of ['t-h', 't-y']) {
    const pass = await admin.supportPass.create({ data: { tenantId: t, reason: 'Help', grantedByEmail: 'x@x.edu', expiresAt: new Date(Date.now() + 86_400_000) } });
    await admin.supportHandoff.create({ data: { tenantId: t, passId: pass.id, tokenHash: `handoff-hash-${t}`, operatorEmail: 'operator@x.edu', expiresAt: new Date(Date.now() + 60_000) } });
  }
  await admin.webhookEndpoint.create({ data: { tenantId: 't-h', url: 'https://hooks.example.com/x', secret: WEBHOOK_SECRET, events: ['course.published'] } });

  process.env.PLATFORM_OPERATOR_TENANT = 'ops';
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
  storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lms-offboarding-'));
  const storage = await import('../src/lib/storage.js');
  storage.setStorageDriver(storage.localDriver(storageDir));
  (await import('../src/lib/mailer.js')).setMailer({ async send(m) { outbox.push(m); } });
  jobs = await import('../src/lib/offboarding.js');
  tenantExport = await import('../src/lib/tenant-export.js');
  await storeFile('t-h', '11111111-1111-4111-8111-111111111111', 't-h-c1', 'syllabus.txt', 'Harvard syllabus bytes');
  await storeFile('t-y', '22222222-2222-4222-8222-222222222222', 't-y-c1', 'notes.txt', 'Yale notes bytes');
}, 240_000);

afterAll(async () => {
  await admin?.$disconnect();
  await db?.stop();
  if (storageDir) fs.rmSync(storageDir, { recursive: true, force: true });
}, 60_000);

async function as(who: string, tenant: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').set('x-tenant-id', tenant).send({ email: `${who}@x.edu`, password: PASSWORD });
  expect(res.status, `login as ${who}`).toBe(200);
  return agent;
}

const binary = (res: any, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

function unzip(buf: Buffer): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err);
      const out: Record<string, string> = {};
      zip.on('entry', (entry: yauzl.Entry) => {
        zip.openReadStream(entry, (e, s) => {
          if (e || !s) return reject(e);
          const chunks: Buffer[] = [];
          s.on('data', (c) => chunks.push(c));
          s.on('end', () => {
            out[entry.fileName] = Buffer.concat(chunks).toString('utf8');
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => resolve(out));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

let harvardExportId: string;

describe('full export', () => {
  it('is queued by an administrator, built by the job, and holds the data without secrets', async () => {
    const h = await as('h-admin', 'harvard');
    const queued = await h.post('/api/v1/admin/offboarding/export');
    expect(queued.status).toBe(202);
    expect(queued.body.data).toMatchObject({ status: 'QUEUED', isFinal: false, tenantId: 't-h' });
    harvardExportId = queued.body.data.id;
    expect((await h.post('/api/v1/admin/offboarding/export')).status).toBe(409);

    // Not ready yet.
    expect((await h.get(`/api/v1/admin/offboarding/export/${harvardExportId}/download`)).status).toBe(409);

    const round = await jobs.runOffboardingJobs();
    expect(round.built).toBe(1);
    const state = await h.get('/api/v1/admin/offboarding');
    expect(state.status).toBe(200);
    const ready = state.body.data.exports.find((e: any) => e.id === harvardExportId);
    expect(ready).toMatchObject({ status: 'READY' });
    expect(ready.sizeBytes).toBeGreaterThan(0);
    expect(new Date(ready.expiresAt).getTime() - Date.now()).toBeGreaterThan(6.9 * 86_400_000);

    const dl = await h.get(`/api/v1/admin/offboarding/export/${harvardExportId}/download`).buffer(true).parse(binary);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toBe('application/zip');
    const files = await unzip(dl.body);
    expect(files['data/Tenant.json']).toContain('"slug": "harvard"');
    expect(files['data/User.jsonl']).toContain('h-student@x.edu');
    expect(files['data/Course.jsonl']).toContain('Course of t-h');
    // Tables without tenantId are reached through their parent.
    expect(files['data/Module.jsonl']).toContain('Week 1');
    expect(files['data/AuditLog.jsonl']).toContain('SOMETHING');
    expect(files['files/11111111-1111-4111-8111-111111111111/syllabus.txt']).toBe('Harvard syllabus bytes');
    expect(JSON.parse(files['manifest.json']).rowCounts.User).toBe(2);

    const all = Object.values(files).join('\n');
    expect(all).not.toContain(WEBHOOK_SECRET);
    expect(all).not.toContain('passwordHash');
    expect(all).not.toContain('$2'); // no bcrypt hash
    expect(files['data/WebhookEndpoint.jsonl']).toContain('hooks.example.com');
    expect(files['data/SupportHandoff.jsonl']).toContain('operator@x.edu');
    expect(all).not.toContain('handoff-hash-');
    expect(Object.keys(files).some((f) => /PasswordResetToken|EmailVerificationToken/.test(f))).toBe(false);
    // Nothing of another organisation.
    expect(all).not.toContain('y-student@x.edu');
    expect(all).not.toContain('Yale notes bytes');

    const audited = await admin.auditLog.findMany({ where: { tenantId: 't-h', action: { in: ['TENANT_EXPORT_REQUESTED', 'TENANT_EXPORT_DOWNLOADED'] } } });
    expect(audited.map((a) => a.action).sort()).toEqual(['TENANT_EXPORT_DOWNLOADED', 'TENANT_EXPORT_REQUESTED']);
  });

  it('never exports a field that looks like a credential', () => {
    expect(tenantExport.exportedFields('User')).not.toContain('passwordHash');
    expect(tenantExport.exportedFields('User')).not.toContain('mfaSecret');
    expect(tenantExport.exportedFields('SsoConnection')).not.toContain('clientSecretEnc');
    const leaks = tenantExport.tablePlans().flatMap((p) => p.fields.filter((f) => tenantExport.SECRET_LIKE.test(f) && `${p.model}.${f}` !== 'LtiDeployment.authTokensUrl').map((f) => `${p.model}.${f}`));
    expect(leaks).toEqual([]);
    expect(tenantExport.tablePlans().map((p) => p.model)).not.toContain('PasswordResetToken');
  });

  it("is downloaded only by the organisation's administrators and the operator", async () => {
    const url = `/api/v1/admin/offboarding/export/${harvardExportId}/download`;
    expect((await (await as('h-student', 'harvard')).get(url)).status).toBe(403);
    expect((await (await as('y-admin', 'yale')).get(url)).status).toBe(404);
    expect((await request(app).get(url).set('x-tenant-id', 'harvard')).status).toBe(401);
    const op = await as('operator', 'ops');
    expect((await op.get(`/api/v1/operator/exports/${harvardExportId}/download`).buffer(true).parse(binary)).status).toBe(200);
    expect((await (await as('h-admin', 'harvard')).get(`/api/v1/operator/exports/${harvardExportId}/download`)).status).toBe(403);
  });

  it('expires: the file is removed and the download answers 410', async () => {
    const e = await admin.tenantExport.findUniqueOrThrow({ where: { id: harvardExportId } });
    await admin.tenantExport.update({ where: { id: e.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await jobs.runOffboardingJobs()).expired).toBe(1);
    expect(fs.existsSync(path.join(storageDir, ...e.storageKey!.split('/')))).toBe(false);
    expect((await admin.tenantExport.findUniqueOrThrow({ where: { id: e.id } })).status).toBe('EXPIRED');
    expect((await (await as('h-admin', 'harvard')).get(`/api/v1/admin/offboarding/export/${e.id}/download`)).status).toBe(410);
  });
});

describe('scheduled deletion', () => {
  it('needs the slug typed, e-mails the administrators, and can be cancelled by them', async () => {
    const h = await as('h-admin', 'harvard');
    expect((await h.post('/api/v1/admin/offboarding/deletion').send({ confirmSlug: 'yale' })).status).toBe(400);
    expect((await (await as('h-student', 'harvard')).post('/api/v1/admin/offboarding/deletion').send({ confirmSlug: 'harvard' })).status).toBe(403);

    outbox.length = 0;
    const scheduled = await h.post('/api/v1/admin/offboarding/deletion').send({ confirmSlug: 'harvard' });
    expect(scheduled.status).toBe(200);
    const d = scheduled.body.data.deletion;
    expect(d).toMatchObject({ byOperator: false, canCancel: true, requestedBy: 'h-admin@x.edu (administrator)' });
    expect(Math.round((new Date(d.scheduledAt).getTime() - Date.now()) / 86_400_000)).toBe(30);
    expect(outbox.some((m) => m.to === 'h-admin@x.edu' && /will be deleted/.test(m.subject))).toBe(true);
    expect((await h.post('/api/v1/admin/offboarding/deletion').send({ confirmSlug: 'harvard' })).status).toBe(409);
    // Still usable meanwhile.
    expect((await (await as('h-student', 'harvard')).get('/api/v1/auth/me')).status).toBe(200);

    const cancelled = await h.delete('/api/v1/admin/offboarding/deletion');
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.deletion).toBeNull();
    const actions = (await admin.auditLog.findMany({ where: { tenantId: 't-h', action: { startsWith: 'TENANT_DELETION' } } })).map((a) => a.action).sort();
    expect(actions).toEqual(['TENANT_DELETION_CANCELLED', 'TENANT_DELETION_SCHEDULED']);
  });

  it("scheduled by the operator, only the operator can cancel it", async () => {
    const op = await as('operator', 'ops');
    expect((await op.post('/api/v1/operator/tenants/t-h/deletion').send({ confirmSlug: 'harvard' })).status).toBe(200);
    const h = await as('h-admin', 'harvard');
    const state = await h.get('/api/v1/admin/offboarding');
    expect(state.body.data.deletion).toMatchObject({ byOperator: true, canCancel: false });
    expect((await h.delete('/api/v1/admin/offboarding/deletion')).status).toBe(403);
    expect((await op.get('/api/v1/operator/offboarding')).body.data.scheduled.map((s: any) => s.slug)).toEqual(['harvard']);
    expect((await op.delete('/api/v1/operator/tenants/t-h/deletion')).status).toBe(200);
    expect(await admin.auditLog.count({ where: { tenantId: 't-op', action: { startsWith: 'TENANT_DELETION' } } })).toBe(2);
  });

  it("never applies to the platform operator's organisation", async () => {
    const op = await as('operator', 'ops');
    expect((await op.post('/api/v1/operator/tenants/t-op/deletion').send({ confirmSlug: 'ops' })).status).toBe(409);
    expect((await op.post('/api/v1/admin/offboarding/deletion').send({ confirmSlug: 'ops' })).status).toBe(409);
    expect((await op.get('/api/v1/admin/offboarding')).body.data.deletable).toBe(false);
    expect((await admin.tenant.findUniqueOrThrow({ where: { id: 't-op' } })).deletionScheduledAt).toBeNull();
  });

  it('when due, takes a final export, deletes everything and keeps the address reserved', async () => {
    const y = await as('y-admin', 'yale');
    expect((await y.post('/api/v1/admin/offboarding/deletion').send({ confirmSlug: 'yale' })).status).toBe(200);
    // Not due yet: nothing happens.
    expect((await jobs.runOffboardingJobs()).deleted).toBe(0);
    await admin.tenant.update({ where: { id: 't-y' }, data: { deletionScheduledAt: new Date(Date.now() - 1000) } });
    outbox.length = 0;

    expect((await jobs.runOffboardingJobs()).deleted).toBe(1);
    expect(await admin.tenant.findUnique({ where: { id: 't-y' } })).toBeNull();
    expect(await admin.user.count({ where: { tenantId: 't-y' } })).toBe(0);
    expect(await admin.course.count({ where: { tenantId: 't-y' } })).toBe(0);
    expect(await admin.term.count({ where: { tenantId: 't-y' } })).toBe(0);
    expect(await admin.module.count({ where: { courseId: 't-y-c1' } })).toBe(0);
    expect(await admin.auditLog.count({ where: { tenantId: 't-y' } })).toBe(0);
    expect(await admin.supportPass.count({ where: { tenantId: 't-y' } })).toBe(0);
    expect(await admin.supportHandoff.count({ where: { tenantId: 't-y' } })).toBe(0);
    expect(await admin.supportHandoff.count({ where: { tenantId: 't-h' } })).toBe(1);
    expect(fs.existsSync(path.join(storageDir, 't-y', '22222222-2222-4222-8222-222222222222'))).toBe(false);
    // Harvard is untouched.
    expect(await admin.user.count({ where: { tenantId: 't-h' } })).toBe(2);
    expect(fs.existsSync(path.join(storageDir, 't-h', '11111111-1111-4111-8111-111111111111'))).toBe(true);

    const tomb = await admin.tenantDeletion.findUniqueOrThrow({ where: { tenantId: 't-y' } });
    expect(tomb.slug).toBe('yale');
    expect(Math.round((tomb.slugHeldUntil.getTime() - Date.now()) / 86_400_000)).toBe(90);
    expect((tomb.summaryJson as any).rows.User).toBe(2);
    expect((tomb.summaryJson as any).files).toBe(1);
    const final = await admin.tenantExport.findUniqueOrThrow({ where: { id: tomb.finalExportId! } });
    expect(final).toMatchObject({ isFinal: true, status: 'READY' });
    expect(Math.round((final.expiresAt!.getTime() - Date.now()) / 86_400_000)).toBe(90);
    expect(await admin.auditLog.count({ where: { tenantId: 't-op', action: 'TENANT_DELETED', resourceId: 't-y' } })).toBe(1);
    expect(outbox.some((m) => m.to === 'y-admin@x.edu' && /has been deleted/.test(m.subject))).toBe(true);

    // The operator can still download the final export; it holds the deleted data.
    const op = await as('operator', 'ops');
    const dl = await op.get(`/api/v1/operator/exports/${final.id}/download`).buffer(true).parse(binary);
    expect(dl.status).toBe(200);
    const files = await unzip(dl.body);
    expect(files['data/User.jsonl']).toContain('y-student@x.edu');
    expect(files['files/22222222-2222-4222-8222-222222222222/notes.txt']).toBe('Yale notes bytes');
    const overview = (await op.get('/api/v1/operator/offboarding')).body.data;
    expect(overview.deleted[0]).toMatchObject({ slug: 'yale', finalExport: { id: final.id, status: 'READY' } });

    // The address cannot be taken again yet.
    const avail = await request(app).get('/api/v1/organizations/availability').query({ slug: 'yale' });
    expect(avail.body.data).toMatchObject({ available: false, reason: 'taken' });
    const create = await op.post('/api/v1/operator/tenants').send({ name: 'Yale again', slug: 'yale', adminFirstName: 'A', adminLastName: 'B', adminEmail: 'a@yale.edu' });
    expect(create.status).toBe(409);
  });
});
