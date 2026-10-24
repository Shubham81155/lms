import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// Suspending an organisation ends access that already exists (sessions, SCIM tokens), not only new
// sign-ins; and seat-quota checks are atomic with the account they let in.

const PASSWORD = 'CorrectHorse1!';
let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;
let withSeat: typeof import('../src/lib/features.js').withSeat;

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  await admin.tenant.create({ data: { id: 't-op', slug: 'ops', name: 'Operator', tier: 'ENTERPRISE' } });
  await admin.tenant.create({ data: { id: 't-h', slug: 'harvard', name: 'Harvard', tier: 'ENTERPRISE' } });
  const user = (id: string, tenantId: string, role: any) =>
    admin.user.create({
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
  await user('operator', 't-op', 'SUPER_ADMIN');
  await user('h-admin', 't-h', 'TENANT_ADMIN');
  await user('h-student', 't-h', 'STUDENT');
  process.env.PLATFORM_OPERATOR_TENANT = 'ops';
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
  ({ withSeat } = await import('../src/lib/features.js'));
}, 240_000);

afterAll(async () => {
  await admin?.$disconnect();
  await db?.stop();
}, 60_000);

async function as(who: string, tenant: string) {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/v1/auth/login')
    .set('x-tenant-id', tenant)
    .send({ email: `${who}@x.edu`, password: PASSWORD });
  expect(res.status, `login as ${who}`).toBe(200);
  return agent;
}

const setStatus = async (status: 'ACTIVE' | 'SUSPENDED') => {
  const res = await (await as('operator', 'ops')).patch('/api/v1/operator/tenants/t-h/status').send({ status });
  expect(res.status).toBe(200);
};

describe('a suspended organisation', () => {
  it('stops existing sessions, and they work again after reactivation', async () => {
    const student = await as('h-student', 'harvard');
    expect((await student.get('/api/v1/auth/me')).status).toBe(200);

    await setStatus('SUSPENDED');
    const blocked = await student.get('/api/v1/auth/me');
    expect(blocked.status).toBe(403);
    expect(blocked.body).toMatchObject({ code: 'TENANT_SUSPENDED', error: expect.stringContaining('suspended') });
    await admin.tenant.update({ where: { id: 't-h' }, data: { status: 'ARCHIVED' } });
    expect((await student.get('/api/v1/auth/me')).status).toBe(403);
    // No new sessions either.
    expect(
      (await request(app).post('/api/v1/auth/login').set('x-tenant-id', 'harvard').send({ email: 'h-student@x.edu', password: PASSWORD }))
        .status
    ).not.toBe(200);

    await setStatus('ACTIVE');
    expect((await student.get('/api/v1/auth/me')).status).toBe(200);
  });

  it('tells visitors of its address that it is suspended, not that it does not exist', async () => {
    await setStatus('SUSPENDED');
    const config = await request(app).get('/api/v1/tenant/config').set('x-tenant-id', 'harvard');
    expect(config.status).toBe(403);
    expect(config.body).toEqual({ error: expect.stringContaining('suspended'), code: 'TENANT_SUSPENDED' });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .set('x-tenant-id', 'harvard')
      .send({ email: 'h-student@x.edu', password: PASSWORD });
    expect(login.status).toBe(403);
    expect(login.body.code).toBe('TENANT_SUSPENDED');

    await setStatus('ACTIVE');
    expect((await request(app).get('/api/v1/tenant/config').set('x-tenant-id', 'harvard')).status).toBe(200);
  });

  it('rejects its SCIM token while suspended', async () => {
    const token = (await (await as('h-admin', 'harvard')).post('/api/v1/admin/scim-tokens').send({ label: 'Okta' })).body.data.token;
    const scim = () => request(app).get('/api/v1/scim/v2/Users').set('authorization', `Bearer ${token}`);
    expect((await scim()).status).toBe(200);

    await setStatus('SUSPENDED');
    const blocked = await scim();
    expect(blocked.status).toBe(403);
    expect(blocked.body.detail).toContain('suspended');

    await setStatus('ACTIVE');
    expect((await scim()).status).toBe(200);
  });
});

describe('seat quota', () => {
  it('lets only one of several concurrent creations take the last seat', async () => {
    const used = await admin.user.count({ where: { tenantId: 't-h', status: { in: ['ACTIVE', 'INVITED'] } } });
    await admin.tenant.update({ where: { id: 't-h' }, data: { seatQuota: used + 1 } });
    const results = await Promise.allSettled(
      [1, 2, 3, 4, 5].map((n) =>
        withSeat('t-h', async (tx) => {
          await new Promise((r) => setTimeout(r, 100)); // widen the gap between the seat check and the insert
          return tx.user.create({
            data: { tenantId: 't-h', email: `race${n}@x.edu`, firstName: 'R', lastName: 'L', role: 'STUDENT', status: 'ACTIVE' },
          });
        })
      )
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected').every((r: any) => r.reason?.status === 409)).toBe(true);
    expect(await admin.user.count({ where: { tenantId: 't-h', email: { startsWith: 'race' } } })).toBe(1);
  });
});
