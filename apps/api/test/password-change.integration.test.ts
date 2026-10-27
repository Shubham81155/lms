import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// Changing a password signs the account out everywhere, an administrator's password is for a super admin to
// reset, and an account with no password cannot be given one without the e-mailed link.

const OLD = 'CorrectHorse1!';
const NEW = 'BrandNewSecret9!';
let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  await admin.tenant.create({ data: { id: 't1', slug: 'harvard', name: 'Harvard' } });
  const hash = bcrypt.hashSync(OLD, 4);
  for (const [id, role, passwordHash] of [
    ['super', 'SUPER_ADMIN', hash],
    ['admin', 'TENANT_ADMIN', hash],
    ['admin2', 'TENANT_ADMIN', hash],
    ['student', 'STUDENT', hash],
    ['student2', 'STUDENT', hash],
    ['sso', 'STUDENT', null],
  ] as const) {
    await admin.user.create({
      data: { id, tenantId: 't1', email: `${id}@x.edu`, firstName: id, lastName: 'U', role, passwordHash, emailVerified: true },
    });
  }
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
}, 240_000);

afterAll(async () => {
  await admin?.$disconnect();
  await db?.stop();
}, 60_000);

async function as(who: string, password = OLD) {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/v1/auth/login')
    .set('x-tenant-id', 'harvard')
    .send({ email: `${who}@x.edu`, password });
  expect(res.status, `login as ${who}: ${JSON.stringify(res.body)}`).toBe(200);
  return agent;
}

const canLogin = async (who: string, password: string) =>
  (
    await request(app)
      .post('/api/v1/auth/login')
      .set('x-tenant-id', 'harvard')
      .send({ email: `${who}@x.edu`, password })
  ).status === 200;

describe('mayResetPasswordOf', () => {
  it('lets a super admin reset anyone and a tenant admin only non-administrators', async () => {
    const { mayResetPasswordOf } = await import('../src/lib/account-password.js');
    expect(mayResetPasswordOf('SUPER_ADMIN', 'TENANT_ADMIN')).toBe(true);
    expect(mayResetPasswordOf('TENANT_ADMIN', 'STUDENT')).toBe(true);
    expect(mayResetPasswordOf('TENANT_ADMIN', 'TENANT_ADMIN')).toBe(false);
    expect(mayResetPasswordOf('TENANT_ADMIN', 'SUPER_ADMIN')).toBe(false);
    expect(mayResetPasswordOf('INSTRUCTOR', 'STUDENT')).toBe(false);
  });
});

describe.each([
  ['POST /auth/change-password', '/api/v1/auth/change-password'],
  ['POST /users/me/password', '/api/v1/users/me/password'],
])('own password change: %s', (_name, url) => {
  it('refuses a wrong current password and changes nothing', async () => {
    const a = await as('student2');
    const res = await a.post(url).send({ currentPassword: 'nope-nope-nope', newPassword: NEW });
    expect(res.status).toBe(400);
    expect(await canLogin('student2', OLD)).toBe(true);
  });

  it('signs out other sessions, keeps the current one, and the new password works', async () => {
    const other = await as('student');
    const current = await as('student');
    expect((await other.get('/api/v1/auth/me')).status).toBe(200);

    const res = await current.post(url).send({ currentPassword: OLD, newPassword: NEW });
    expect(res.status).toBe(200);

    expect((await other.get('/api/v1/auth/me')).status).toBe(401);
    expect((await current.get('/api/v1/auth/me')).status).toBe(200);
    expect(await canLogin('student', OLD)).toBe(false);
    expect(await canLogin('student', NEW)).toBe(true);

    // put it back for the next table row
    const back = await as('student', NEW);
    expect((await back.post(url).send({ currentPassword: NEW, newPassword: OLD })).status).toBe(200);
  });

  it('will not give a passwordless account a password without the e-mailed link', async () => {
    await admin.user.update({ where: { id: 'sso' }, data: { status: 'ACTIVE' } });
    const { generateToken } = await import('../src/middleware/auth.js');
    const token = generateToken({ id: 'sso', role: 'STUDENT', email: 'sso@x.edu', tenantId: 't1', tokenVersion: 0 });
    const res = await request(app)
      .post(url)
      .set('x-tenant-id', 'harvard')
      .set('authorization', `Bearer ${token}`)
      .send({ newPassword: NEW });
    expect(res.status).toBe(409);
    expect((await admin.user.findUnique({ where: { id: 'sso' } }))?.passwordHash).toBeNull();
  });
});

describe('administrator-set passwords', () => {
  it('lets a tenant admin reset a student, which signs the student out', async () => {
    const student = await as('student2');
    const a = await as('admin');
    const res = await a.post('/api/v1/users/student2/password').send({ newPassword: NEW });
    expect(res.status).toBe(200);
    expect((await student.get('/api/v1/auth/me')).status).toBe(401);
    expect(await canLogin('student2', NEW)).toBe(true);
    expect((await a.get('/api/v1/auth/me')).status).toBe(200);
  });

  it('refuses a tenant admin resetting another admin or a super admin', async () => {
    const a = await as('admin');
    for (const target of ['admin2', 'super']) {
      expect((await a.post(`/api/v1/users/${target}/password`).send({ newPassword: NEW })).status).toBe(403);
      expect(await canLogin(target, OLD)).toBe(true);
    }
  });

  it('lets a super admin reset an administrator', async () => {
    const s = await as('super');
    expect((await s.post('/api/v1/users/admin2/password').send({ newPassword: NEW })).status).toBe(200);
    expect(await canLogin('admin2', NEW)).toBe(true);
  });

  it('refuses a student changing someone else’s password', async () => {
    const s = await as('student');
    expect((await s.post('/api/v1/users/admin/password').send({ newPassword: NEW })).status).toBe(403);
  });
});
