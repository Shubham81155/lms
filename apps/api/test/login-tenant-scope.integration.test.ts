import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// A sign-in only ever looks in the organisation the request is for. Never across organisations.

let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  for (const [id, slug] of [
    ['t1', 'harvard'],
    ['t2', 'mit'],
  ])
    await admin.tenant.create({ data: { id, slug, name: slug } });
  const user = (id: string, tenantId: string, email: string, password: string) =>
    admin.user.create({
      data: {
        id,
        tenantId,
        email,
        firstName: id,
        lastName: 'U',
        role: 'STUDENT',
        passwordHash: bcrypt.hashSync(password, 4),
        emailVerified: true,
      },
    });
  await user('h-shared', 't1', 'shared@x.edu', 'Harvard-Pass-1!');
  await user('m-shared', 't2', 'shared@x.edu', 'Mit-Pass-1234!');
  await user('m-only', 't2', 'only-mit@x.edu', 'Mit-Pass-1234!');
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
}, 240_000);

afterAll(async () => {
  await admin?.$disconnect();
  await db?.stop();
}, 60_000);

const login = (tenant: string, email: string, password: string) =>
  request(app).post('/api/v1/auth/login').set('x-tenant-id', tenant).send({ email, password });

describe('POST /auth/login is scoped to the organisation', () => {
  it('signs in to the organisation asked for when the e-mail exists in two', async () => {
    const h = await login('harvard', 'shared@x.edu', 'Harvard-Pass-1!');
    const m = await login('mit', 'shared@x.edu', 'Mit-Pass-1234!');
    expect(h.body.user.id).toBe('h-shared');
    expect(m.body.user.id).toBe('m-shared');
  });

  it('does not accept another organisation’s password for the same e-mail', async () => {
    expect((await login('harvard', 'shared@x.edu', 'Mit-Pass-1234!')).status).toBe(401);
  });

  it('answers an e-mail that exists only elsewhere exactly like an unknown one', async () => {
    const elsewhere = await login('harvard', 'only-mit@x.edu', 'Mit-Pass-1234!');
    const unknown = await login('harvard', 'nobody@x.edu', 'Mit-Pass-1234!');
    expect(elsewhere.status).toBe(401);
    expect(elsewhere.body).toEqual(unknown.body);
    expect(elsewhere.headers['set-cookie']).toBeUndefined();
  });

  it('counts failed attempts against the organisation’s own account only', async () => {
    for (let i = 0; i < 10; i++) await login('harvard', 'shared@x.edu', 'wrong-wrong-wrong');
    const [h, m] = await Promise.all([
      admin.user.findUnique({ where: { id: 'h-shared' } }),
      admin.user.findUnique({ where: { id: 'm-shared' } }),
    ]);
    expect(h!.lockedUntil).not.toBeNull();
    expect(m!.lockedUntil).toBeNull();
    expect(m!.failedLoginCount).toBe(0);
    expect((await login('mit', 'shared@x.edu', 'Mit-Pass-1234!')).status).toBe(200);
  });
});
