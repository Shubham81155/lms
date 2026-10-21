import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { runWithTenant } from '@enterprise-lms/database';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// DPDP Act readiness: consent purposes and the append-only consent history (lib/consent.ts), the breach register and
// its 72-hour clock (lib/breaches.ts), the grievance officer, a minor's guardian consent (lib/guardian.ts), and what
// the personal-data export and erasure do with consents. Real PostgreSQL with row-level security.

const PASSWORD = 'CorrectHorse1!';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
let db: TestDatabase;
let admin: PrismaClient;
let appClient: PrismaClient;
let app: import('express').Express;
let mailer: typeof import('../src/lib/mailer.js');
let breaches: typeof import('../src/lib/breaches.js');
let guardian: typeof import('../src/lib/guardian.js');
let privacy: typeof import('../src/lib/privacy.js');
let docs: typeof import('../src/openapi/responses/dpdp.js');
const outbox: { to: string; subject: string; text: string }[] = [];

beforeAll(async () => {
  process.env.LOGIN_RATE_LIMIT_MAX = '1000';
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  appClient = new PrismaClient({ datasourceUrl: db.appUrl });
  await admin.tenant.create({ data: { id: 't-a', slug: 'acme', name: 'Acme College', tier: 'ENTERPRISE' } });
  await admin.tenant.create({ data: { id: 't-b', slug: 'beta', name: 'Beta College', tier: 'ENTERPRISE' } });
  for (const id of ['a-admin', 'a-admin2']) await user(id, 't-a', 'TENANT_ADMIN');
  for (const id of ['s1', 's2', 's3', 'kid']) await user(id, 't-a', 'STUDENT');
  await user('b-admin', 't-b', 'TENANT_ADMIN');
  await user('b-student', 't-b', 'STUDENT');
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
  mailer = await import('../src/lib/mailer.js');
  breaches = await import('../src/lib/breaches.js');
  guardian = await import('../src/lib/guardian.js');
  privacy = await import('../src/lib/privacy.js');
  docs = await import('../src/openapi/responses/dpdp.js');
}, 240_000);

afterAll(async () => {
  await admin?.$disconnect();
  await appClient?.$disconnect();
  await db?.stop();
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
  return admin.user.create({ data: { id, tenantId, email: `${id}@x.edu`, firstName: id, lastName: 'L', role, passwordHash: bcrypt.hashSync(PASSWORD, 4), emailVerified: true } });
}

async function as(who: string, tenant: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').set('x-tenant-id', tenant).send({ email: `${who}@x.edu`, password: PASSWORD });
  expect(res.status, `login as ${who}`).toBe(200);
  return agent;
}

/** Checks a response body against the schema the API description promises for that operation. */
const matchesDocs = (key: string, body: unknown) => {
  const doc = docs.DPDP_DOCS[key];
  expect(doc, key).toBeDefined();
  const parsed = doc!.response!.schema!.safeParse(body);
  expect(parsed.success, `${key}: ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`).toBe(true);
};

const audits = (action: string, tenantId = 't-a') => admin.auditLog.count({ where: { tenantId, action } });

const PURPOSES = [
  { key: 'service', title: 'Run my account', description: 'We use your details to run your courses and grades.', required: true, lawfulBasis: 'needed to provide the course' },
  { key: 'marketing', title: 'News and offers', description: 'We e-mail you news about other programmes we offer.', required: false },
];

describe('consent', () => {
  it('administrators define purposes; others cannot; a wording change raises the version', async () => {
    const a = await as('a-admin', 'acme');
    const s1 = await as('s1', 'acme');
    expect((await s1.put('/api/v1/privacy/consent-purposes').send({ purposes: PURPOSES })).status).toBe(403);
    expect((await a.put('/api/v1/privacy/consent-purposes').send({ purposes: [{ ...PURPOSES[0], key: 'Bad Key' }] })).status).toBe(400);
    expect((await a.put('/api/v1/privacy/consent-purposes').send({ purposes: [PURPOSES[0], PURPOSES[0]] })).status).toBe(400);

    const saved = await a.put('/api/v1/privacy/consent-purposes').send({ purposes: PURPOSES });
    expect(saved.status).toBe(200);
    matchesDocs('PUT /api/v1/privacy/consent-purposes', saved.body);
    expect(saved.body.data.map((p: any) => [p.key, p.version])).toEqual([['service', 1], ['marketing', 1]]);

    // Same input again changes nothing; a new wording raises the version.
    const again = await a.put('/api/v1/privacy/consent-purposes').send({ purposes: PURPOSES });
    expect(again.body.data.every((p: any) => p.version === 1)).toBe(true);
    const reworded = await a.put('/api/v1/privacy/consent-purposes').send({ purposes: [{ ...PURPOSES[1], description: 'We e-mail you news and offers about our programmes.' }] });
    expect(reworded.body.data.find((p: any) => p.key === 'marketing').version).toBe(2);
    expect(await audits('CONSENT_PURPOSE_CREATED')).toBe(2);
    expect(await audits('CONSENT_PURPOSE_UPDATED')).toBe(1);

    const listed = await a.get('/api/v1/privacy/consent-purposes');
    matchesDocs('GET /api/v1/privacy/consent-purposes', listed.body);
    // Another organisation sees none of it.
    const b = await as('b-admin', 'beta');
    expect((await b.get('/api/v1/privacy/consent-purposes')).body.data).toEqual([]);
  });

  it('a person grants and withdraws; the history only grows and keeps the wording; required withdrawal explains', async () => {
    const s1 = await as('s1', 'acme');
    const mine = await s1.get('/api/v1/privacy/consents');
    matchesDocs('GET /api/v1/privacy/consents', mine.body);
    expect(mine.body.data.map((p: any) => [p.key, p.status])).toEqual([['service', 'NONE'], ['marketing', 'NONE']]);
    expect(mine.body.data[0]).not.toHaveProperty('lawfulBasis');

    const granted = await s1.post('/api/v1/privacy/consents/marketing/grant').set('User-Agent', 'dpdp-test').send({});
    expect(granted.status).toBe(200);
    matchesDocs('POST /api/v1/privacy/consents/:key/grant', granted.body);
    expect(granted.body.data.purpose).toMatchObject({ status: 'GRANTED', version: 2, outdated: false });
    expect(granted.body.data.consequence).toBeNull();
    // Answering the same way again records nothing new.
    await s1.post('/api/v1/privacy/consents/marketing/grant').send({});
    expect(await admin.consentRecord.count({ where: { tenantId: 't-a', userId: 's1', purposeKey: 'marketing' } })).toBe(1);

    const withdrawn = await s1.post('/api/v1/privacy/consents/marketing/withdraw').send({});
    expect(withdrawn.body.data.purpose.status).toBe('WITHDRAWN');
    const req = await s1.post('/api/v1/privacy/consents/service/withdraw').send({});
    matchesDocs('POST /api/v1/privacy/consents/:key/withdraw', req.body);
    expect(req.body.data.consequence).toMatch(/needed to run your account/);

    const history = await admin.consentRecord.findMany({ where: { tenantId: 't-a', userId: 's1' }, orderBy: { createdAt: 'asc' } });
    expect(history.map((h) => [h.purposeKey, h.granted])).toEqual([['marketing', true], ['marketing', false], ['service', false]]);
    expect(history[0].textSnapshot).toContain('news and offers about our programmes');
    // The trail has who, from where, with what browser.
    const entry = await admin.auditLog.findFirst({ where: { tenantId: 't-a', action: 'CONSENT_GRANTED', userId: 's1' } });
    expect(entry).toMatchObject({ userAgent: 'dpdp-test' });
    expect(entry?.ipAddress).toBeTruthy();
    expect((await s1.post('/api/v1/privacy/consents/nope/grant').send({})).status).toBe(404);
  });

  it('an older answer is outdated after a wording change; the report counts the latest answers per version', async () => {
    const a = await as('a-admin', 'acme');
    const s2 = await as('s2', 'acme');
    await s2.post('/api/v1/privacy/consents/marketing/grant').send({}); // version 2
    await a.put('/api/v1/privacy/consent-purposes').send({ purposes: [{ ...PURPOSES[1], title: 'News, offers and surveys' }] }); // version 3
    const mine = await s2.get('/api/v1/privacy/consents');
    expect(mine.body.data.find((p: any) => p.key === 'marketing')).toMatchObject({ status: 'GRANTED', outdated: true });

    const report = await a.get('/api/v1/privacy/consents/report');
    expect(report.status).toBe(200);
    matchesDocs('GET /api/v1/privacy/consents/report', report.body);
    const marketing = report.body.data.find((r: any) => r.key === 'marketing');
    // s1 last withdrew (v2); s2 last granted (v2).
    expect(marketing).toMatchObject({ granted: 1, withdrawn: 1, currentVersion: 3 });
    expect(marketing.byVersion).toEqual([{ version: 2, granted: 1, withdrawn: 1 }]);
    const service = report.body.data.find((r: any) => r.key === 'service');
    expect(service).toMatchObject({ granted: 0, withdrawn: 1 });
    expect(service.noAnswer).toBeGreaterThan(0);
    expect((await (await as('s1', 'acme')).get('/api/v1/privacy/consents/report')).status).toBe(403);
  });

  it('the runtime role cannot change or delete the history', async () => {
    await expect(appClient.$executeRawUnsafe(`UPDATE "ConsentRecord" SET "granted" = true`)).rejects.toThrow(/permission denied/i);
    await expect(appClient.$executeRawUnsafe(`DELETE FROM "ConsentRecord"`)).rejects.toThrow(/permission denied/i);
  });

  it('the personal-data export holds the consents; erasure keeps the evidence and removes contact details', async () => {
    const s1 = await as('s1', 'acme');
    const exp = await s1.get('/api/v1/privacy/me/export');
    expect(exp.status).toBe(200);
    expect(exp.body.consents.map((c: any) => [c.purposeKey, c.granted])).toEqual([['marketing', true], ['marketing', false], ['service', false]]);
    expect(exp.body.profile).toMatchObject({ isMinor: false, guardianEmail: null });

    await admin.user.update({ where: { id: 's3' }, data: { isMinor: true, guardianEmail: 'parent@home.test' } });
    await admin.consentRecord.create({ data: { tenantId: 't-a', userId: 's3', purposeId: (await admin.consentPurpose.findFirstOrThrow({ where: { tenantId: 't-a', key: 'service' } })).id, purposeKey: 'service', version: 1, granted: true, textSnapshot: 'x' } });
    await admin.guardianConsentRequest.create({ data: { tenantId: 't-a', userId: 's3', guardianEmail: 'parent@home.test', tokenHash: 'h-s3', expiresAt: new Date(Date.now() + DAY) } });
    await runWithTenant('t-a', () => privacy.eraseUser('s3', 't-a'));
    const erased = await admin.user.findUniqueOrThrow({ where: { id: 's3' } });
    expect(erased.guardianEmail).toBeNull();
    expect(erased.erasedAt).not.toBeNull();
    expect(await admin.guardianConsentRequest.count({ where: { userId: 's3' } })).toBe(0);
    const kept = await admin.consentRecord.findMany({ where: { userId: 's3' } });
    expect(kept).toHaveLength(1);
    expect(JSON.stringify(kept)).not.toContain('parent@home.test');
  });
});

describe('breach register', () => {
  it('registers a breach with a 72-hour clock, tracks it to closure, and keeps organisations apart', async () => {
    const a = await as('a-admin', 'acme');
    const s1 = await as('s1', 'acme');
    expect((await s1.get('/api/v1/privacy/breaches')).status).toBe(403);
    expect((await a.post('/api/v1/privacy/breaches').send({ title: 'x', description: 'y', severity: 'HIGH', detectedAt: new Date(Date.now() + 5 * DAY).toISOString() })).status).toBe(400);

    const detectedAt = new Date(Date.now() - 2 * HOUR).toISOString();
    const created = await a.post('/api/v1/privacy/breaches').send({ title: 'Mailbox exposed', description: 'A staff mailbox was readable from outside.', severity: 'HIGH', categories: ['contact details'], affectedEstimate: 120, detectedAt });
    expect(created.status).toBe(201);
    matchesDocs('POST /api/v1/privacy/breaches', created.body);
    const id = created.body.data.id;
    expect(created.body.data).toMatchObject({ status: 'DETECTED', overdue: false });
    expect(new Date(created.body.data.dueAt).getTime() - new Date(detectedAt).getTime()).toBe(72 * HOUR);
    expect(created.body.data.hoursLeft).toBe(69);

    const contained = await a.patch(`/api/v1/privacy/breaches/${id}`).send({ containment: 'Access closed and passwords reset.', ownerId: 'a-admin2' });
    expect(contained.status).toBe(200);
    matchesDocs('PATCH /api/v1/privacy/breaches/:id', contained.body);
    expect(contained.body.data).toMatchObject({ status: 'CONTAINED', ownerId: 'a-admin2' });
    expect((await a.patch(`/api/v1/privacy/breaches/${id}`).send({ ownerId: 's1' })).status).toBe(400);
    expect((await a.patch(`/api/v1/privacy/breaches/${id}`).send({})).status).toBe(400);
    expect((await a.patch(`/api/v1/privacy/breaches/${id}`).send({ status: 'NOTIFIED' })).status).toBe(400);
    expect((await a.patch(`/api/v1/privacy/breaches/${id}`).send({ status: 'CLOSED' })).status).toBe(400);

    const notified = await a.patch(`/api/v1/privacy/breaches/${id}`).send({ boardNotifiedAt: new Date().toISOString() });
    expect(notified.body.data).toMatchObject({ status: 'NOTIFIED', overdue: false, hoursLeft: null });
    const closed = await a.patch(`/api/v1/privacy/breaches/${id}`).send({ status: 'CLOSED' });
    expect(closed.body.data.status).toBe('CLOSED');
    expect(closed.body.data.closedAt).not.toBeNull();
    expect((await a.patch(`/api/v1/privacy/breaches/${id}`).send({ title: 'new' })).status).toBe(409);

    expect(await audits('BREACH_REGISTERED')).toBe(1);
    expect(await audits('BREACH_UPDATED')).toBe(2);
    expect(await audits('BREACH_CLOSED')).toBe(1);

    const list = await a.get('/api/v1/privacy/breaches');
    matchesDocs('GET /api/v1/privacy/breaches', list.body);
    expect(list.body.summary).toEqual({ open: 0, overdue: 0 });
    matchesDocs('GET /api/v1/privacy/breaches/:id', await a.get(`/api/v1/privacy/breaches/${id}`).then((r) => r.body));
    const b = await as('b-admin', 'beta');
    expect((await b.get(`/api/v1/privacy/breaches/${id}`)).status).toBe(404);
    expect((await b.get('/api/v1/privacy/breaches')).body.data).toEqual([]);
  });

  it('closing without notifying needs a reason', async () => {
    const a = await as('a-admin', 'acme');
    const c = await a.post('/api/v1/privacy/breaches').send({ title: 'Lost laptop', description: 'Encrypted laptop lost; no personal data on it.', severity: 'LOW' });
    const id = c.body.data.id;
    expect((await a.patch(`/api/v1/privacy/breaches/${id}`).send({ status: 'CLOSED' })).status).toBe(400);
    const done = await a.patch(`/api/v1/privacy/breaches/${id}`).send({ status: 'CLOSED', noNotificationReason: 'Disk encrypted; no personal data was accessible.' });
    expect(done.body.data.status).toBe('CLOSED');
  });

  it('the clock job warns once before the deadline and once after it, never twice, never for notified breaches', async () => {
    const now = new Date();
    const mk = (id: string, detectedHoursAgo: number, extra: object = {}) =>
      admin.dataBreach.create({
        data: { id, tenantId: 't-a', title: id, description: 'd', severity: 'MEDIUM', detectedAt: new Date(now.getTime() - detectedHoursAgo * HOUR), dueAt: new Date(now.getTime() + (72 - detectedHoursAgo) * HOUR), createdById: 'a-admin', ...extra },
      });
    await mk('br-soon', 60); // 12 hours left
    await mk('br-late', 80); // overdue
    await mk('br-far', 10);
    await mk('br-told', 80, { boardNotifiedAt: now, status: 'NOTIFIED' });

    const first = await breaches.runBreachJob(now);
    expect(first).toEqual({ dueSoon: 1, overdue: 1 });
    expect(outbox.map((m) => m.subject).sort()).toEqual(expect.arrayContaining([expect.stringMatching(/due within 24 hours/), expect.stringMatching(/deadline passed/)]));
    expect(outbox.filter((m) => /Breach/.test(m.subject))).toHaveLength(4); // two e-mails to each of the two administrators
    outbox.length = 0;
    expect(await breaches.runBreachJob(now)).toEqual({ dueSoon: 0, overdue: 0 });
    expect(outbox).toHaveLength(0);
    // Later the far one comes within a day, then passes.
    expect(await breaches.runBreachJob(new Date(now.getTime() + 50 * HOUR))).toEqual({ dueSoon: 1, overdue: 1 }); // br-far: due in 12h left... then overdue for br-soon already warned
    expect(await audits('BREACH_REMINDER_SENT')).toBe(4);
    expect(await breaches.runBreachJobLocked(now)).not.toBeNull();
  });
});

describe('grievance officer', () => {
  it('is public to read, set by administrators, and cleared together', async () => {
    const pub = await request(app).get('/api/v1/privacy/grievance-officer').set('x-tenant-id', 'acme');
    expect(pub.status).toBe(200);
    matchesDocs('GET /api/v1/privacy/grievance-officer', pub.body);
    expect(pub.body.data).toEqual({ organisation: 'Acme College', officer: null, responseDays: null });
    expect((await request(app).get('/api/v1/privacy/grievance-officer').set('x-tenant-id', 'nowhere')).status).toBe(404);

    const a = await as('a-admin', 'acme');
    expect((await (await as('s1', 'acme')).put('/api/v1/privacy/grievance-officer').send({ name: 'A', email: 'a@x.edu' })).status).toBe(403);
    expect((await a.put('/api/v1/privacy/grievance-officer').send({ name: 'Asha Rao', email: null })).status).toBe(400);
    const set = await a.put('/api/v1/privacy/grievance-officer').send({ name: 'Asha Rao', email: 'grievance@acme.edu', phone: '+91 98765 43210', address: '1 College Road, Pune', responseDays: 15 });
    expect(set.status).toBe(200);
    matchesDocs('PUT /api/v1/privacy/grievance-officer', set.body);
    const pub2 = await request(app).get('/api/v1/privacy/grievance-officer').set('x-tenant-id', 'acme');
    expect(pub2.body.data).toEqual({ organisation: 'Acme College', officer: { name: 'Asha Rao', email: 'grievance@acme.edu', phone: '+91 98765 43210', address: '1 College Road, Pune' }, responseDays: 15 });
    // Another organisation's notice is unaffected.
    expect((await request(app).get('/api/v1/privacy/grievance-officer').set('x-tenant-id', 'beta')).body.data.officer).toBeNull();
    expect(await audits('GRIEVANCE_OFFICER_SET')).toBe(1);
    const cleared = await a.put('/api/v1/privacy/grievance-officer').send({ name: null, email: null });
    expect(cleared.body.data.officer).toBeNull();
  });
});

describe("a minor's guardian consent", () => {
  const tokenFrom = (text: string) => decodeURIComponent(/guardian-consent\?token=([^\s]+)/.exec(text)![1]);

  it('a minor cannot agree to anything until a guardian confirms; the link works once and only for its person', async () => {
    const kid = await as('kid', 'acme');
    const a = await as('a-admin', 'acme');
    expect((await kid.get('/api/v1/privacy/me/minor')).body.data).toMatchObject({ isMinor: false });
    // Not marked yet: cannot request.
    expect((await kid.post('/api/v1/privacy/me/guardian-consent').send({ guardianEmail: 'mum@home.test' })).status).toBe(409);

    const declared = await kid.put('/api/v1/privacy/me/minor').send({ isMinor: true });
    expect(declared.status).toBe(200);
    matchesDocs('PUT /api/v1/privacy/me/minor', declared.body);
    expect((await kid.put('/api/v1/privacy/me/minor').send({ isMinor: false })).status).toBe(403);
    expect((await kid.post('/api/v1/privacy/consents/marketing/grant').send({})).status).toBe(403);
    expect((await kid.post('/api/v1/privacy/me/guardian-consent').send({ guardianEmail: 'kid@x.edu' })).status).toBe(400);

    const asked = await kid.post('/api/v1/privacy/me/guardian-consent').send({ guardianEmail: 'mum@home.test' });
    expect(asked.status).toBe(200);
    matchesDocs('POST /api/v1/privacy/me/guardian-consent', asked.body);
    expect(asked.body.data).toMatchObject({ isMinor: true, guardianEmail: 'm***@home.test', guardianConsentAt: null });
    expect(asked.body.data.pendingRequestExpiresAt).not.toBeNull();
    const mail = outbox.find((m) => m.to === 'mum@home.test')!;
    expect(mail.text).toContain('/guardian-consent?token=');
    const token = tokenFrom(mail.text);
    // Only the hash is stored.
    expect(await admin.guardianConsentRequest.count({ where: { tokenHash: token } })).toBe(0);

    // A new request replaces the old link.
    await kid.post('/api/v1/privacy/me/guardian-consent').send({ guardianEmail: 'mum@home.test' });
    const newer = tokenFrom(outbox.filter((m) => m.to === 'mum@home.test').at(-1)!.text);
    expect((await request(app).get('/api/v1/privacy/guardian-consent').query({ token })).status).toBe(400);

    const info = await request(app).get('/api/v1/privacy/guardian-consent').query({ token: newer });
    expect(info.status).toBe(200);
    matchesDocs('GET /api/v1/privacy/guardian-consent', info.body);
    expect(info.body.data).toMatchObject({ organisation: 'Acme College', firstName: 'kid' });
    expect((await admin.user.findUniqueOrThrow({ where: { id: 'kid' } })).guardianConsentAt).toBeNull(); // looking changes nothing
    expect((await request(app).get('/api/v1/privacy/guardian-consent').query({ token: 'zzzzzzzzzzzzzzzzzzzzzzzzz' })).status).toBe(400);
    expect((await request(app).post('/api/v1/privacy/guardian-consent').send({ token: `t-b.${newer.split('.').slice(1).join('.')}` })).status).toBe(400);

    const confirmed = await request(app).post('/api/v1/privacy/guardian-consent').send({ token: newer });
    expect(confirmed.status).toBe(200);
    matchesDocs('POST /api/v1/privacy/guardian-consent', confirmed.body);
    expect((await request(app).post('/api/v1/privacy/guardian-consent').send({ token: newer })).status).toBe(400);
    expect((await kid.get('/api/v1/privacy/me/minor')).body.data.guardianConsentAt).not.toBeNull();
    expect(await audits('GUARDIAN_CONSENT_GIVEN')).toBe(1);
    expect((await kid.post('/api/v1/privacy/consents/marketing/grant').send({})).status).toBe(200);
    expect((await kid.post('/api/v1/privacy/me/guardian-consent').send({ guardianEmail: 'mum@home.test' })).status).toBe(409);

    // The confirmation e-mail carries a withdrawal link: it changes nothing until used, rejects tampering, works once.
    const thanks = outbox.filter((m) => m.to === 'mum@home.test').pop()!;
    expect(thanks.text).toContain('/guardian-consent/withdraw?token=');
    const wToken = decodeURIComponent(/withdraw\?token=([^\s]+)/.exec(thanks.text)![1]);
    const wInfo = await request(app).get('/api/v1/privacy/guardian-consent/withdraw').query({ token: wToken });
    expect(wInfo.status).toBe(200);
    matchesDocs('GET /api/v1/privacy/guardian-consent/withdraw', wInfo.body);
    expect((await kid.get('/api/v1/privacy/me/minor')).body.data.guardianConsentAt).not.toBeNull();
    expect((await request(app).post('/api/v1/privacy/guardian-consent/withdraw').send({ token: `${wToken}x` })).status).toBe(400);
    expect((await request(app).post('/api/v1/privacy/guardian-consent/withdraw').send({ token: wToken.replace(/^[^.]+/, 't-b') })).status).toBe(400);
    const withdrawn = await request(app).post('/api/v1/privacy/guardian-consent/withdraw').send({ token: wToken });
    expect(withdrawn.status).toBe(200);
    matchesDocs('POST /api/v1/privacy/guardian-consent/withdraw', withdrawn.body);
    expect(withdrawn.body.data.purposesWithdrawn).toBeGreaterThan(0);
    expect((await request(app).post('/api/v1/privacy/guardian-consent/withdraw').send({ token: wToken })).status).toBe(400);
    expect((await kid.get('/api/v1/privacy/me/minor')).body.data).toMatchObject({ isMinor: true, guardianConsentAt: null });
    expect((await kid.post('/api/v1/privacy/consents/marketing/grant').send({})).status).toBe(403);
    expect(await audits('GUARDIAN_CONSENT_WITHDRAWN')).toBe(1);
    // Asking the guardian again is possible afterwards.
    expect((await kid.post('/api/v1/privacy/me/guardian-consent').send({ guardianEmail: 'mum@home.test' })).status).toBe(200);

    const seen = await a.get('/api/v1/privacy/users/kid/minor');
    matchesDocs('GET /api/v1/privacy/users/:id/minor', seen.body);
    expect(seen.body.data.isMinor).toBe(true);
    expect((await kid.get('/api/v1/privacy/users/kid/minor')).status).toBe(403);

    // Only an administrator can clear the mark; clearing forgets the guardian.
    const cleared = await a.put('/api/v1/privacy/users/kid/minor').send({ isMinor: false });
    matchesDocs('PUT /api/v1/privacy/users/:id/minor', cleared.body);
    expect(cleared.body.data).toMatchObject({ isMinor: false, guardianEmail: null, guardianConsentAt: null });
  });

  it('expired links fail; an administrator can mark a minor and ask the guardian; asking is limited per day', async () => {
    const a = await as('a-admin', 'acme');
    expect((await a.put('/api/v1/privacy/users/s1/minor').send({ isMinor: true, guardianEmail: 'dad@home.test' })).status).toBe(200);
    const asked = await a.post('/api/v1/privacy/users/s1/guardian-consent').send({ guardianEmail: 'dad@home.test' });
    expect(asked.status).toBe(200);
    matchesDocs('POST /api/v1/privacy/users/:id/guardian-consent', asked.body);
    const token = tokenFrom(outbox.find((m) => m.to === 'dad@home.test')!.text);
    await admin.guardianConsentRequest.updateMany({ where: { userId: 's1' }, data: { expiresAt: new Date(Date.now() - HOUR) } });
    expect((await request(app).post('/api/v1/privacy/guardian-consent').send({ token })).status).toBe(400);
    expect((await admin.user.findUniqueOrThrow({ where: { id: 's1' } })).guardianConsentAt).toBeNull();

    expect((await a.post('/api/v1/privacy/users/s1/guardian-consent').send({ guardianEmail: 'dad@home.test' })).status).toBe(200);
    expect((await a.post('/api/v1/privacy/users/s1/guardian-consent').send({ guardianEmail: 'dad@home.test' })).status).toBe(200);
    expect((await a.post('/api/v1/privacy/users/s1/guardian-consent').send({ guardianEmail: 'dad@home.test' })).status).toBe(429);
    expect((await a.put('/api/v1/privacy/users/b-student/minor').send({ isMinor: true })).status).toBe(404); // another organisation's person
  });

  it('camera and microphone monitoring of a minor is blocked until a guardian consented', async () => {
    await admin.user.update({ where: { id: 's2' }, data: { isMinor: true, guardianConsentAt: null } });
    const blocked = (id: string) => runWithTenant('t-a', () => guardian.minorMonitoringBlocked('t-a', id));
    expect(await blocked('s2')).toBe(true);
    await admin.user.update({ where: { id: 's2' }, data: { guardianConsentAt: new Date() } });
    expect(await blocked('s2')).toBe(false);
    expect(await blocked('a-admin')).toBe(false);
  });
});

describe('behavioural monitoring of minors', () => {
  it('proctoring events, xAPI statements and at-risk analytics leave out a minor until a guardian consents', async () => {
    await admin.course.create({ data: { id: 'mc1', tenantId: 't-a', code: 'MC1', title: 'Minor course', status: 'PUBLISHED' } });
    await admin.enrollment.create({ data: { id: 'me1', tenantId: 't-a', courseId: 'mc1', userId: 's2', status: 'IN_PROGRESS', progressPercent: 0 } });
    await admin.quiz.create({ data: { id: 'mq1', tenantId: 't-a', courseId: 'mc1', title: 'Quiz', requireProctoring: true } });
    await admin.quizSubmission.create({ data: { id: 'ms1', quizId: 'mq1', userId: 's2', maxScore: 10, answersJson: {} } });
    await admin.quizSubmission.create({ data: { id: 'ms2', attemptNumber: 2, quizId: 'mq1', userId: 's2', maxScore: 10, score: 0, passed: false, submittedAt: new Date(), answersJson: {} } });
    const s2 = await as('s2', 'acme');
    const event = () => s2.post('/api/v1/proctoring/events').send({ submissionId: 'ms1', eventType: 'TAB_SWITCH', severity: 'LOW' });
    const statements = () => admin.xapiStatement.count({ where: { actorUserId: 's2' } });
    const record = () =>
      import('../src/lib/xapi.js').then(async (x) => {
        const { runWithTenant } = await import('@enterprise-lms/database');
        return runWithTenant('t-a', () => x.recordStatement({ tenantId: 't-a', user: { id: 's2', email: 's2@x.edu' }, verb: x.VERBS.completed, object: { id: 'urn:test' } }));
      });

    await admin.user.update({ where: { id: 's2' }, data: { isMinor: true, guardianConsentAt: null } });
    expect((await event()).status).toBe(403);
    expect(await record()).toBeNull();
    expect(await statements()).toBe(0);
    const risk = await import('../src/lib/risk.js');
    const { runWithTenant } = await import('@enterprise-lms/database');
    expect((await runWithTenant('t-a', () => risk.computeAtRisk('t-a', ['mc1']))).map((l) => l.id)).not.toContain('s2');

    await admin.user.update({ where: { id: 's2' }, data: { guardianConsentAt: new Date(), lastLoginAt: new Date() } });
    expect((await event()).status).toBe(201);
    expect(await record()).not.toBeNull();
    expect((await runWithTenant('t-a', () => risk.computeAtRisk('t-a', ['mc1']))).map((l) => l.id)).toContain('s2');
  });
});
