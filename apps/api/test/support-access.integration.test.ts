import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// Consented support access: an organisation's administrator grants the platform operator a time-limited pass;
// the operator enters through a one-time link and works as the organisation's support account until the pass
// is revoked or expires. Runs as lms_app, so row-level security (and the operator's listing function) is real.

const PASSWORD = 'CorrectHorse1!';
let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  await admin.tenant.create({ data: { id: 't-op', slug: 'ops', name: 'Operator', tier: 'ENTERPRISE' } });
  await admin.tenant.create({ data: { id: 't-h', slug: 'harvard', name: 'Harvard', tier: 'ENTERPRISE' } });
  const user = (id: string, tenantId: string, role: any) =>
    admin.user.create({ data: { id, tenantId, email: `${id}@x.edu`, firstName: id, lastName: 'L', role, passwordHash: bcrypt.hashSync(PASSWORD, 4), emailVerified: true } });
  await user('operator', 't-op', 'SUPER_ADMIN');
  await user('op-admin', 't-op', 'TENANT_ADMIN');
  await user('h-admin', 't-h', 'TENANT_ADMIN');
  await user('h-student', 't-h', 'STUDENT');
  process.env.PLATFORM_OPERATOR_TENANT = 'ops';
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
}, 240_000);

afterAll(async () => {
  await admin?.$disconnect();
  await db?.stop();
}, 60_000);

// One pass in force at a time: each test starts from none.
beforeEach(async () => {
  await admin.supportPass.updateMany({ where: { revokedAt: null }, data: { revokedAt: new Date() } });
});

async function as(who: string, tenant: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').set('x-tenant-id', tenant).send({ email: `${who}@x.edu`, password: PASSWORD });
  expect(res.status, `login as ${who}`).toBe(200);
  return agent;
}

async function grant(scope: 'READ_ONLY' | 'FULL' = 'READ_ONLY', hours = 1) {
  const res = await (await as('h-admin', 'harvard')).post('/api/v1/support/passes').send({ scope, hours, reason: 'Gradebook totals look wrong' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string; scope: string; status: string; expiresAt: string };
}

/** The operator asks for a link; returns its token. */
async function handoff(passId: string) {
  const res = await (await as('operator', 'ops')).post(`/api/v1/operator/support-passes/${passId}/enter`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const url = new URL(res.body.data.url);
  expect(url.pathname).toBe('/support/enter');
  return url.searchParams.get('token')!;
}

async function enter(passId: string) {
  const token = await handoff(passId);
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/support/enter').send({ token });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { agent, token };
}

const auditActions = async (passId: string) =>
  (await admin.auditLog.findMany({ where: { tenantId: 't-h', resourceId: passId }, orderBy: { createdAt: 'asc' } })).map((a) => a.action);

describe('granting', () => {
  it('lets an administrator grant a pass the operator then sees', async () => {
    const pass = await grant('READ_ONLY', 4);
    expect(pass).toMatchObject({ scope: 'READ_ONLY', status: 'ACTIVE' });
    expect(new Date(pass.expiresAt).getTime() - Date.now()).toBeGreaterThan(3.9 * 3600_000);

    const list = await (await as('operator', 'ops')).get('/api/v1/operator/support-passes');
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([expect.objectContaining({ id: pass.id, organization: expect.objectContaining({ slug: 'harvard' }), grantedByEmail: 'h-admin@x.edu' })]);

    const own = await (await as('h-admin', 'harvard')).get('/api/v1/support/passes');
    expect(own.body.data[0]).toMatchObject({ id: pass.id, status: 'ACTIVE' });
    expect(await auditActions(pass.id)).toContain('SUPPORT_ACCESS_GRANTED');
  });

  it('refuses a second pass while one is in force, and durations other than the offered ones', async () => {
    await grant();
    const again = await (await as('h-admin', 'harvard')).post('/api/v1/support/passes').send({ hours: 1, reason: 'Another look' });
    expect(again.status).toBe(409);
    const long = await (await as('h-admin', 'harvard')).post('/api/v1/support/passes').send({ hours: 100, reason: 'A long look' });
    expect(long.status).toBe(400);
  });

  it('is for administrators only', async () => {
    const res = await (await as('h-student', 'harvard')).post('/api/v1/support/passes').send({ hours: 1, reason: 'Please help me' });
    expect(res.status).toBe(403);
    expect((await (await as('h-student', 'harvard')).get('/api/v1/support/passes')).status).toBe(403);
  });

  it('cannot target the platform operator organisation', async () => {
    const res = await (await as('op-admin', 'ops')).post('/api/v1/support/passes').send({ hours: 1, reason: 'Support ourselves' });
    expect(res.status).toBe(409);
    expect(await admin.supportPass.count({ where: { tenantId: 't-op' } })).toBe(0);
  });

  it('keeps the operator console to operators', async () => {
    expect((await (await as('h-admin', 'harvard')).get('/api/v1/operator/support-passes')).status).toBe(403);
    expect((await (await as('op-admin', 'ops')).get('/api/v1/operator/support-passes')).status).toBe(403);
  });
});

describe('entering', () => {
  it('turns a one-time link into a support session, once', async () => {
    const pass = await grant();
    const { agent, token } = await enter(pass.id);

    const me = await agent.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ tenantId: 't-h', role: 'TENANT_ADMIN', firstName: 'Platform' });
    const session = await agent.get('/api/v1/support/session');
    expect(session.body.data).toMatchObject({ passId: pass.id, scope: 'READ_ONLY', operatorEmail: 'operator@x.edu' });
    // Can look at what an administrator sees.
    expect((await agent.get('/api/v1/admin/audit-logs')).status).toBe(200);

    const reuse = await request(app).post('/api/v1/support/enter').send({ token });
    expect(reuse.status).toBe(410);

    // An ordinary session is not a support session.
    expect((await (await as('h-admin', 'harvard')).get('/api/v1/support/session')).body.data).toBeNull();
    const row = await admin.supportPass.findUniqueOrThrow({ where: { id: pass.id } });
    expect(row.lastEnteredByEmail).toBe('operator@x.edu');
  });

  it('refuses an expired link', async () => {
    const pass = await grant();
    const token = await handoff(pass.id);
    await admin.supportHandoff.updateMany({ where: { passId: pass.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await request(app).post('/api/v1/support/enter').send({ token })).status).toBe(410);
  });

  it('refuses changes in a read-only session, but lets it leave', async () => {
    const pass = await grant('READ_ONLY');
    const { agent } = await enter(pass.id);
    const write = await agent.post('/api/v1/admin/scim-tokens').send({ label: 'Okta' });
    expect(write.status).toBe(403);
    expect(write.body.code).toBe('SUPPORT_READ_ONLY');
    // Nor may it hand out or withdraw support access.
    expect((await agent.post(`/api/v1/support/passes/${pass.id}/revoke`)).status).toBe(403);

    const exit = await agent.post('/api/v1/support/exit');
    expect(exit.status).toBe(200);
    expect(exit.body.data.redirect).toMatch(/\/platform$/);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
    // The support account takes no seat between sessions.
    expect(await admin.user.count({ where: { tenantId: 't-h', email: 'platform-support@support.invalid', status: 'ACTIVE' } })).toBe(0);
    expect(await auditActions(pass.id)).toEqual(expect.arrayContaining(['SUPPORT_ACCESS_GRANTED', 'SUPPORT_SESSION_STARTED', 'SUPPORT_SESSION_ENDED']));
  });

  it('allows and audits every change in a full session', async () => {
    const pass = await grant('FULL');
    const { agent } = await enter(pass.id);
    const write = await agent.post('/api/v1/admin/scim-tokens').send({ label: 'Okta' });
    expect(write.status).toBe(201);
    await new Promise((r) => setTimeout(r, 200)); // the entry is written once the response has gone
    const writes = await admin.auditLog.findMany({ where: { tenantId: 't-h', action: 'SUPPORT_WRITE', resourceId: pass.id } });
    expect(writes).toHaveLength(1);
    expect(writes[0].diffJson).toMatchObject({ operatorEmail: 'operator@x.edu', method: 'POST', path: '/api/v1/admin/scim-tokens', status: 201 });
  });
});

describe('ending', () => {
  it('ends the session at once when the administrator revokes the pass', async () => {
    const pass = await grant();
    const { agent } = await enter(pass.id);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(200);

    const revoke = await (await as('h-admin', 'harvard')).post(`/api/v1/support/passes/${pass.id}/revoke`);
    expect(revoke.status).toBe(200);
    expect(revoke.body.data).toMatchObject({ status: 'REVOKED', revokedByEmail: 'h-admin@x.edu' });
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
    expect((await agent.get('/api/v1/support/session')).status).toBe(401);

    // Gone from the operator's list, and cannot be entered again.
    expect((await (await as('operator', 'ops')).get('/api/v1/operator/support-passes')).body.data).toEqual([]);
    expect((await (await as('operator', 'ops')).post(`/api/v1/operator/support-passes/${pass.id}/enter`)).status).toBe(404);
    expect(await auditActions(pass.id)).toContain('SUPPORT_ACCESS_REVOKED');
  });

  it('ends the session when the pass expires', async () => {
    const pass = await grant();
    const { agent } = await enter(pass.id);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(200);
    await admin.supportPass.update({ where: { id: pass.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
    expect((await (await as('h-admin', 'harvard')).get('/api/v1/support/passes')).body.data[0]).toMatchObject({ id: pass.id, status: 'EXPIRED' });
  });

  it('ends the support session on an ordinary sign-out, as exit does', async () => {
    const pass = await grant();
    const { agent } = await enter(pass.id);
    expect((await agent.post('/api/v1/auth/logout')).status).toBe(200);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
    expect(await admin.user.count({ where: { tenantId: 't-h', email: 'platform-support@support.invalid', status: 'ACTIVE' } })).toBe(0);
    const ended = await admin.auditLog.findMany({ where: { tenantId: 't-h', action: 'SUPPORT_SESSION_ENDED', resourceId: pass.id } });
    expect(ended).toHaveLength(1);
    expect(ended[0].diffJson).toMatchObject({ operatorEmail: 'operator@x.edu', via: 'logout' });
  });

  it('refuses a link for a pass revoked after it was issued', async () => {
    const pass = await grant();
    const token = await handoff(pass.id);
    await (await as('h-admin', 'harvard')).post(`/api/v1/support/passes/${pass.id}/revoke`);
    expect((await request(app).post('/api/v1/support/enter').send({ token })).status).toBe(410);
  });
});
