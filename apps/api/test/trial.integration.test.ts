import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// Free trials (lib/trial.ts): new organisations with or without one, the operator's start/extend/end/convert,
// the background job's reminders, expiry (read-only: changes answer 402 TRIAL_ENDED) and suspension after the
// grace period. Real PostgreSQL and RLS.

const PASSWORD = 'CorrectHorse1!';
const DAY = 24 * 60 * 60 * 1000;
let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;
let mailer: typeof import('../src/lib/mailer.js');
let trial: typeof import('../src/lib/trial.js');
const outbox: { to: string; subject: string; text: string }[] = [];

beforeAll(async () => {
  process.env.PLATFORM_OPERATOR_TENANT = 'ops';
  process.env.ORG_TRIAL_GRACE_DAYS = '14';
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  await admin.tenant.create({ data: { id: 't-op', slug: 'ops', name: 'Operator', tier: 'ENTERPRISE' } });
  await admin.tenant.create({ data: { id: 't-h', slug: 'harvard', name: 'Harvard', tier: 'ENTERPRISE' } });
  await admin.tenant.create({ data: { id: 't-y', slug: 'yale', name: 'Yale', tier: 'ENTERPRISE' } });
  await user('operator', 't-op', 'SUPER_ADMIN');
  await user('h-admin', 't-h', 'TENANT_ADMIN');
  await user('y-admin', 't-y', 'TENANT_ADMIN');
  await user('y-student', 't-y', 'STUDENT');
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
  mailer = await import('../src/lib/mailer.js');
  trial = await import('../src/lib/trial.js');
}, 240_000);

afterAll(async () => {
  await admin?.$disconnect();
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

const tenantRow = (id: string) => admin.tenant.findUniqueOrThrow({ where: { id }, select: { status: true, trialEndsAt: true, trialExpiredAt: true, trialRemindersSent: true } });
const newOrg = (slug: string, over: object = {}) => ({ name: `College ${slug}`, slug, adminFirstName: 'Ann', adminLastName: 'Lee', adminEmail: `ann@${slug}.edu`, ...over });

describe('new organisations', () => {
  it('start active without trialDays (ORG_TRIAL_DAYS is 0) or with 0, and on a trial with N days', async () => {
    const op = await as('operator', 'ops');
    expect((await op.get('/api/v1/operator/trial-settings')).body.data).toEqual({ defaultDays: 0, graceDays: 14 });

    const plain = await op.post('/api/v1/operator/tenants').send(newOrg('plain'));
    expect(plain.status).toBe(201);
    expect(plain.body.data.organization).toMatchObject({ status: 'ACTIVE', trialEndsAt: null, trialExpiredAt: null, readOnlyUntil: null });

    const zero = await op.post('/api/v1/operator/tenants').send(newOrg('zero', { trialDays: 0 }));
    expect(zero.body.data.organization.status).toBe('ACTIVE');

    const before = Date.now();
    const trialed = await op.post('/api/v1/operator/tenants').send(newOrg('trialled', { trialDays: 10 }));
    expect(trialed.status).toBe(201);
    expect(trialed.body.data.organization.status).toBe('TRIAL');
    const ends = new Date(trialed.body.data.organization.trialEndsAt).getTime();
    expect(ends).toBeGreaterThanOrEqual(before + 10 * DAY);
    expect(ends).toBeLessThanOrEqual(Date.now() + 10 * DAY);

    expect((await op.post('/api/v1/operator/tenants').send(newOrg('toolong', { trialDays: 366 }))).status).toBe(400);
  });

  it('start as the approval says: trialDays N gives a trial, 0 an active organisation', async () => {
    const op = await as('operator', 'ops');
    const pending = (slug: string) =>
      admin.organizationRequest.create({
        data: {
          organizationName: `Request ${slug}`, slug, institutionType: 'COLLEGE', contactFirstName: 'Bo', contactLastName: 'Ng', contactEmail: `bo@${slug}.edu`,
          status: 'PENDING', verifiedAt: new Date(), holdsSlug: true, holdExpiresAt: new Date(Date.now() + 30 * DAY),
        },
      });
    const a = await pending('req-trial');
    const approved = await op.post(`/api/v1/operator/requests/${a.id}/approve`).send({ tier: 'STARTER', seatQuota: 50, trialDays: 5 });
    expect(approved.status).toBe(200);
    expect(approved.body.data.organization.status).toBe('TRIAL');
    expect(new Date(approved.body.data.organization.trialEndsAt).getTime()).toBeGreaterThan(Date.now() + 4.9 * DAY);

    const b = await pending('req-paid');
    const paid = await op.post(`/api/v1/operator/requests/${b.id}/approve`).send({ trialDays: 0 });
    expect(paid.status).toBe(200);
    expect(paid.body.data.organization).toMatchObject({ status: 'ACTIVE', trialEndsAt: null });
  });
});

describe('operator trial actions', () => {
  it('are for the platform operator only, and never on its own organisation', async () => {
    const hAdmin = await as('h-admin', 'harvard');
    expect((await hAdmin.post('/api/v1/operator/tenants/t-h/trial').send({ days: 7 })).status).toBe(403);
    expect((await hAdmin.get('/api/v1/operator/trial-settings')).status).toBe(403);

    const op = await as('operator', 'ops');
    for (const [method, path] of [['post', 'trial'], ['patch', 'trial'], ['post', 'trial/end'], ['post', 'trial/convert']] as const) {
      const res = await op[method](`/api/v1/operator/tenants/t-op/${path}`).send(path === 'trial' ? { days: 7 } : {});
      expect(res.status, `${method} ${path}`).toBe(409);
    }
    expect((await tenantRow('t-op')).status).toBe('ACTIVE');
    expect((await op.post('/api/v1/operator/tenants/nope/trial').send({ days: 7 })).status).toBe(404);
    expect((await op.post('/api/v1/operator/tenants/t-h/trial').send({ days: 0 })).status).toBe(400);
  });

  it('start, extend, end and convert a trial, each audited in both trails', async () => {
    const op = await as('operator', 'ops');
    const base = '/api/v1/operator/tenants/t-h/trial';
    // Nothing to extend, end or convert yet.
    expect((await op.patch(base).send({ days: 3 })).status).toBe(409);
    expect((await op.post(`${base}/end`)).status).toBe(409);
    expect((await op.post(`${base}/convert`)).status).toBe(409);

    const started = await op.post(base).send({ days: 7 });
    expect(started.status).toBe(200);
    expect(started.body.data.status).toBe('TRIAL');
    expect((await op.post(base).send({ days: 7 })).status).toBe(409);

    const first = new Date(started.body.data.trialEndsAt).getTime();
    const extended = await op.patch(base).send({ days: 3 });
    expect(extended.status).toBe(200);
    expect(new Date(extended.body.data.trialEndsAt).getTime()).toBe(first + 3 * DAY);

    const ended = await op.post(`${base}/end`);
    expect(ended.status).toBe(200);
    expect(ended.body.data.trialExpiredAt).not.toBeNull();
    expect(new Date(ended.body.data.readOnlyUntil).getTime()).toBeCloseTo(new Date(ended.body.data.trialExpiredAt).getTime() + 14 * DAY, -3);
    expect((await op.post(`${base}/end`)).status).toBe(409);

    const converted = await op.post(`${base}/convert`);
    expect(converted.status).toBe(200);
    expect(converted.body.data).toMatchObject({ status: 'ACTIVE', trialEndsAt: null, trialExpiredAt: null, readOnlyUntil: null });

    const actions = async (tenantId: string) => (await admin.auditLog.findMany({ where: { tenantId, resourceId: 't-h', action: { startsWith: 'TRIAL_' } } })).map((l) => l.action).sort();
    const expected = ['TRIAL_CONVERTED', 'TRIAL_ENDED', 'TRIAL_EXTENDED', 'TRIAL_STARTED'];
    expect(await actions('t-h')).toEqual(expected);
    expect(await actions('t-op')).toEqual(expected);
  });
});

describe('the trial job', () => {
  it('reminds 7 days and 1 day before the end once each, then makes the organisation read-only, then suspends it', async () => {
    const t0 = new Date();
    await admin.tenant.update({ where: { id: 't-y' }, data: { status: 'TRIAL', trialEndsAt: new Date(t0.getTime() + 5 * DAY), trialExpiredAt: null, trialRemindersSent: 0 } });
    const toYale = () => outbox.filter((m) => m.to === 'y-admin@x.edu');

    // Five days left: the week's reminder, once.
    await trial.runTrialJob(t0);
    expect(toYale()).toHaveLength(1);
    expect(toYale()[0].subject).toContain('ends in 5 days');
    await trial.runTrialJob(new Date(t0.getTime() + DAY));
    expect(toYale()).toHaveLength(1);
    expect((await tenantRow('t-y')).trialRemindersSent).toBe(trial.REMINDER_7_DAYS);

    // Half a day left: the last day's reminder, once.
    const lastDay = new Date(t0.getTime() + 4.5 * DAY);
    await trial.runTrialJob(lastDay);
    await trial.runTrialJob(lastDay);
    expect(toYale()).toHaveLength(2);
    expect(toYale()[1].subject).toContain('ends in 1 day');
    // The student is not e-mailed.
    expect(outbox.some((m) => m.to === 'y-student@x.edu')).toBe(false);

    const student = await as('y-student', 'yale');
    const yAdmin = await as('y-admin', 'yale');
    expect((await yAdmin.get('/api/v1/trial')).body.data).toMatchObject({ state: 'TRIAL', daysLeft: 5 });

    // The end: read-only.
    const end = new Date(t0.getTime() + 5 * DAY + 60_000);
    expect((await trial.runTrialJob(end)).expired).toBeGreaterThanOrEqual(1);
    expect((await trial.runTrialJob(end)).expired).toBe(0);
    expect(toYale()).toHaveLength(3);
    expect(toYale()[2].subject).toContain('has ended');
    expect((await tenantRow('t-y')).trialExpiredAt?.getTime()).toBe(end.getTime());

    // Looking still works; changes answer 402 TRIAL_ENDED; signing out, exports and privacy requests still work.
    expect((await student.get('/api/v1/auth/me')).status).toBe(200);
    const status = (await yAdmin.get('/api/v1/trial')).body.data;
    expect(status.state).toBe('READ_ONLY');
    expect(new Date(status.readOnlyUntil).getTime()).toBe(end.getTime() + 14 * DAY);
    const refused = await yAdmin.patch('/api/v1/admin/tenant').send({ primaryColor: '#112233' });
    expect(refused.status).toBe(402);
    expect(refused.body).toEqual({ error: expect.stringContaining('trial has ended'), code: 'TRIAL_ENDED' });
    expect((await yAdmin.post('/api/v1/courses').send({ title: 'New course' })).status).toBe(402);
    expect((await student.get('/api/v1/privacy/me/export')).status).toBe(200);
    expect((await student.put('/api/v1/privacy/me/directory').send({ optOut: true })).status).toBe(200);
    expect((await student.post('/api/v1/auth/logout')).status).toBeLessThan(300);

    // Not yet past the grace period.
    await trial.runTrialJob(new Date(end.getTime() + 13 * DAY));
    expect((await tenantRow('t-y')).status).toBe('TRIAL');

    // Past it: suspended, and existing sessions stop.
    const after = new Date(end.getTime() + 14 * DAY + 60_000);
    expect((await trial.runTrialJob(after)).suspended).toBeGreaterThanOrEqual(1);
    expect((await trial.runTrialJob(after)).suspended).toBe(0);
    expect((await tenantRow('t-y')).status).toBe('SUSPENDED');
    expect(toYale().at(-1)!.subject).toContain('suspended');
    const blocked = await yAdmin.get('/api/v1/auth/me');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('TENANT_SUSPENDED');
    expect(await admin.auditLog.count({ where: { tenantId: 't-y', action: 'TENANT_SUSPENDED' } })).toBe(1);
    expect(await admin.auditLog.count({ where: { tenantId: 't-y', action: 'TRIAL_REMINDER_SENT' } })).toBe(2);

    // Converting the lapsed trial makes it a paid organisation again, with no trial left.
    const op = await as('operator', 'ops');
    const converted = await op.post('/api/v1/operator/tenants/t-y/trial/convert');
    expect(converted.status).toBe(200);
    expect(converted.body.data).toMatchObject({ status: 'ACTIVE', trialEndsAt: null, trialExpiredAt: null });
    expect(await tenantRow('t-y')).toMatchObject({ status: 'ACTIVE', trialEndsAt: null, trialExpiredAt: null, trialRemindersSent: 0 });
    expect((await yAdmin.get('/api/v1/auth/me')).status).toBe(200);
    expect((await yAdmin.get('/api/v1/trial')).body.data).toEqual({ state: 'NONE', trialEndsAt: null, daysLeft: null, readOnlyUntil: null });
    expect((await yAdmin.patch('/api/v1/admin/tenant').send({ primaryColor: '#112233' })).status).not.toBe(402);
  });

  it('never touches the operator organisation', async () => {
    await admin.tenant.update({ where: { id: 't-op' }, data: { status: 'TRIAL', trialEndsAt: new Date(Date.now() - DAY) } });
    try {
      await trial.runTrialJob(new Date());
      expect((await tenantRow('t-op')).trialExpiredAt).toBeNull();
    } finally {
      await admin.tenant.update({ where: { id: 't-op' }, data: { status: 'ACTIVE', trialEndsAt: null } });
    }
  });
});
