import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

vi.mock('../src/lib/prisma', async () => {
  const { createFakePrisma } = await import('./helpers.js');
  const fake = createFakePrisma();
  return { prisma: fake, default: fake };
});

import { prisma } from '../src/lib/prisma';
import type { FakePrisma } from './helpers';
import { app } from '../src/server';
import { setMailer } from '../src/lib/mailer';
import { hashOneTimeToken } from '../src/lib/one-time-token';

const fake = prisma as unknown as FakePrisma;
const SECRET = process.env.JWT_SECRET!;
const PASSWORD = 'CorrectHorse1!';
const TENANT = { id: 'ten_1', status: 'ACTIVE' };

const tokenFor = (over: Record<string, unknown> = {}, secret = SECRET, opts: jwt.SignOptions = {}) =>
  jwt.sign(
    { id: 'u1', role: 'STUDENT', email: 'a@x.edu', tenantId: 'ten_1', ...over },
    secret,
    { algorithm: 'HS256', expiresIn: '1h', ...opts }
  );

async function userRecord(over: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    tenantId: 'ten_1',
    email: 'a@x.edu',
    firstName: 'A',
    lastName: 'B',
    role: 'STUDENT',
    status: 'ACTIVE',
    emailVerified: true,
    avatarUrl: null,
    passwordHash: await bcrypt.hash(PASSWORD, 4),
    failedLoginCount: 0,
    lockedUntil: null,
    tenant: { id: 'ten_1', slug: 'harvard', name: 'Harvard' },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.tenant.findFirst.mockResolvedValue(TENANT);
  fake.auditLog.create.mockResolvedValue({});
  fake.user.update.mockImplementation(async ({ data }: any) => ({
    ...(await userRecord()),
    failedLoginCount: 1,
    ...Object.fromEntries(Object.entries(data).filter(([, v]) => typeof v !== 'object')),
  }));
});

describe('authentication cannot be bypassed', () => {
  it.each([
    ['/api/v1/courses'],
    ['/api/v1/admin/stats'],
    ['/api/v1/users'],
    ['/api/v1/auth/me'],
  ])('rejects forged x-user-* headers on %s', async (path) => {
    const res = await request(app)
      .get(path)
      .set('x-user-role', 'SUPER_ADMIN')
      .set('x-user-id', 'anyone')
      .set('x-tenant-id', 'ten_1');
    expect(res.status).toBe(401);
  });

  it('rejects a token signed with a different secret', async () => {
    const forged = tokenFor({ role: 'SUPER_ADMIN' }, 'attacker-secret-attacker-secret-attacker');
    const res = await request(app).get('/api/v1/admin/stats').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it('rejects an unsigned (alg=none) token', async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
      id: 'u1', role: 'SUPER_ADMIN', email: 'a@x.edu', tenantId: 'ten_1',
    })}.`;
    const res = await request(app).get('/api/v1/admin/stats').set('Authorization', `Bearer ${none}`);
    expect(res.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const expired = tokenFor({}, SECRET, { expiresIn: -10 });
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  it('rejects a token missing required claims', async () => {
    const bad = jwt.sign({ id: 'u1' }, SECRET, { algorithm: 'HS256' });
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${bad}`);
    expect(res.status).toBe(401);
  });

  it('enforces roles: a student token cannot reach admin routes', async () => {
    const res = await request(app)
      .get('/api/v1/admin/stats')
      .set('Authorization', `Bearer ${tokenFor()}`);
    expect(res.status).toBe(403);
  });

  it('takes the tenant from the token, ignoring the x-tenant-id header', async () => {
    fake.user.findFirst.mockResolvedValue(await userRecord());
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .set('x-tenant-id', 'some-other-tenant');
    expect(fake.user.findFirst.mock.calls[0][0].where).toMatchObject({ tenantId: 'ten_1' });
  });

  it('accepts the httpOnly session cookie', async () => {
    fake.user.findFirst.mockResolvedValue(await userRecord());
    const res = await request(app).get('/api/v1/auth/me').set('Cookie', `lms_token=${tokenFor()}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('a@x.edu');
  });

  it('invalidates the session when the account is no longer active', async () => {
    fake.user.findFirst.mockResolvedValue(await userRecord({ status: 'SUSPENDED' }));
    const res = await request(app).get('/api/v1/auth/me').set('Cookie', `lms_token=${tokenFor()}`);
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/login', () => {
  const login = (body: object) => request(app).post('/api/v1/auth/login').send(body);

  it('signs in with the right password and sets an httpOnly cookie', async () => {
    fake.user.findFirst.mockResolvedValue(await userRecord());
    const res = await login({ email: 'A@X.edu', password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeUndefined();
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('lms_token='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const token = cookie.split(';')[0].split('=')[1];
    const claims = jwt.verify(token, SECRET) as any;
    expect(claims).toMatchObject({ id: 'u1', tenantId: 'ten_1', role: 'STUDENT' });
    expect(fake.user.findFirst.mock.calls[0][0].where.email).toBe('a@x.edu');
  });

  it('resolves the tenant through the database, not by trusting the hint as an id', async () => {
    fake.user.findFirst.mockResolvedValue(await userRecord());
    await login({ email: 'a@x.edu', password: PASSWORD });
    expect(fake.tenant.findFirst.mock.calls[0][0].where.OR).toEqual(
      expect.arrayContaining([{ slug: 'harvard' }])
    );
    expect(fake.user.findFirst.mock.calls[0][0].where.tenantId).toBe('ten_1');
  });

  it('rejects a wrong password and counts the failure', async () => {
    fake.user.findFirst.mockResolvedValue(await userRecord());
    const res = await login({ email: 'a@x.edu', password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(fake.user.update.mock.calls[0][0].data).toEqual({ failedLoginCount: { increment: 1 } });
  });

  it('locks the account once the failure threshold is reached', async () => {
    fake.user.findFirst.mockResolvedValue(await userRecord());
    fake.user.update.mockResolvedValueOnce({ failedLoginCount: 3 }).mockResolvedValue({});
    const res = await login({ email: 'a@x.edu', password: 'wrong-password' });
    expect(res.status).toBe(401);
    const lockCall = fake.user.update.mock.calls[1][0];
    expect(lockCall.data.lockedUntil.getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1000);
    expect(lockCall.data.failedLoginCount).toBe(0);
  });

  it('refuses a locked account even with the correct password', async () => {
    fake.user.findFirst.mockResolvedValue(
      await userRecord({ lockedUntil: new Date(Date.now() + 60_000) })
    );
    const res = await login({ email: 'a@x.edu', password: PASSWORD });
    expect(res.status).toBe(423);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('allows sign-in again after the lock expires and clears it', async () => {
    fake.user.findFirst.mockResolvedValue(
      await userRecord({ lockedUntil: new Date(Date.now() - 1000), failedLoginCount: 0 })
    );
    const res = await login({ email: 'a@x.edu', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(fake.user.update.mock.calls[0][0].data).toMatchObject({ lockedUntil: null, failedLoginCount: 0 });
  });

  it('gives the same answer for an unknown user as for a wrong password', async () => {
    fake.user.findFirst.mockResolvedValue(null);
    const unknown = await login({ email: 'nobody@x.edu', password: PASSWORD });
    fake.user.findFirst.mockResolvedValue(await userRecord());
    const wrong = await login({ email: 'a@x.edu', password: 'wrong-password' });
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });

  it('rejects an unknown tenant', async () => {
    fake.tenant.findFirst.mockResolvedValue(null);
    const res = await login({ email: 'a@x.edu', password: PASSWORD });
    expect(res.status).toBe(401);
    expect(fake.user.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a suspended tenant', async () => {
    fake.tenant.findFirst.mockResolvedValue({ id: 'ten_1', status: 'SUSPENDED' });
    const res = await login({ email: 'a@x.edu', password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it('does not accept a plaintext value stored as the password hash', async () => {
    fake.user.findFirst.mockResolvedValue(await userRecord({ passwordHash: 'plaintext-pass-1' }));
    const res = await login({ email: 'a@x.edu', password: 'plaintext-pass-1' });
    expect(res.status).toBe(401);
  });

  it('upgrades a legacy SHA-256 hash to bcrypt on successful sign-in', async () => {
    const sha = crypto.createHash('sha256').update(PASSWORD).digest('hex');
    fake.user.findFirst.mockResolvedValue(await userRecord({ passwordHash: sha }));
    const res = await login({ email: 'a@x.edu', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(fake.user.update.mock.calls[0][0].data.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('upgrades a legacy salt:scrypt hash to bcrypt on successful sign-in', async () => {
    const salt = 'somesalt';
    const legacy = `${salt}:${crypto.scryptSync(PASSWORD, salt, 64).toString('hex')}`;
    fake.user.findFirst.mockResolvedValue(await userRecord({ passwordHash: legacy }));
    const res = await login({ email: 'a@x.edu', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(fake.user.update.mock.calls[0][0].data.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('rejects a correct password for a suspended account without issuing a session', async () => {
    fake.user.findFirst.mockResolvedValue(await userRecord({ status: 'SUSPENDED' }));
    const res = await login({ email: 'a@x.edu', password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('validates the body', async () => {
    expect((await login({ email: 'not-an-email', password: 'x' })).status).toBe(400);
    expect((await login({ email: 'a@x.edu' })).status).toBe(400);
  });
});

describe('POST /auth/logout', () => {
  it('clears the cookie even without a valid session', async () => {
    const res = await request(app).post('/api/v1/auth/logout');
    expect(res.status).toBe(200);
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('lms_token='))!;
    expect(cookie).toMatch(/Expires=Thu, 01 Jan 1970/);
  });
});

describe('password reset', () => {
  const sent: { to: string; text: string }[] = [];
  beforeEach(() => {
    sent.length = 0;
    setMailer({ send: async (m) => void sent.push(m) });
  });

  it('answers identically for known and unknown emails, and only mails known ones', async () => {
    fake.user.findFirst.mockResolvedValueOnce({ id: 'u1', email: 'a@x.edu', tenantId: 'ten_1' });
    const known = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'a@x.edu' });
    fake.user.findFirst.mockResolvedValueOnce(null);
    const unknown = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'z@x.edu' });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    expect(sent).toHaveLength(1);
  });

  it('stores only a hash of the emailed token', async () => {
    fake.user.findFirst.mockResolvedValueOnce({ id: 'u1', email: 'a@x.edu', tenantId: 'ten_1' });
    await request(app).post('/api/v1/auth/forgot-password').send({ email: 'a@x.edu' });

    const emailed = sent[0].text.match(/token=([\w-]+)/)![1];
    const stored = fake.passwordResetToken.create.mock.calls[0][0].data;
    expect(stored.tokenHash).toBe(hashOneTimeToken(emailed));
    expect(JSON.stringify(stored)).not.toContain(emailed);
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  const validRecord = (over: Record<string, unknown> = {}) => ({
    userId: 'u1',
    usedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    user: { id: 'u1', tenantId: 'ten_1', status: 'ACTIVE' },
    ...over,
  });
  const reset = (password = 'a-brand-new-password') =>
    request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: 'x'.repeat(43), password });

  it('sets a bcrypt hash, clears the lockout and burns outstanding tokens', async () => {
    fake.passwordResetToken.findUnique.mockResolvedValue(validRecord());
    const res = await reset();
    expect(res.status).toBe(200);
    const data = fake.user.update.mock.calls[0][0].data;
    expect(data.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(data).toMatchObject({ failedLoginCount: 0, lockedUntil: null });
    expect(fake.passwordResetToken.updateMany).toHaveBeenCalled();
  });

  it.each([
    ['unknown token', null],
    ['expired token', validRecord({ expiresAt: new Date(Date.now() - 1000) })],
    ['already used token', validRecord({ usedAt: new Date() })],
    ['suspended user', validRecord({ user: { id: 'u1', tenantId: 'ten_1', status: 'SUSPENDED' } })],
  ])('rejects an %s', async (_label, record) => {
    fake.passwordResetToken.findUnique.mockResolvedValue(record);
    const res = await reset();
    expect(res.status).toBe(400);
    expect(fake.user.update).not.toHaveBeenCalled();
  });

  it('enforces the password policy', async () => {
    fake.passwordResetToken.findUnique.mockResolvedValue(validRecord());
    expect((await reset('short')).status).toBe(400);
    expect(fake.user.update).not.toHaveBeenCalled();
  });
});

describe('email verification', () => {
  it('marks the email verified for a valid token', async () => {
    fake.emailVerificationToken.findUnique.mockResolvedValue({
      userId: 'u1',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: 'u1', tenantId: 'ten_1' },
    });
    const res = await request(app).post('/api/v1/auth/verify-email').send({ token: 'x'.repeat(43) });
    expect(res.status).toBe(200);
    expect(fake.user.update.mock.calls[0][0].data).toEqual({ emailVerified: true });
  });

  it('rejects an expired token', async () => {
    fake.emailVerificationToken.findUnique.mockResolvedValue({
      userId: 'u1',
      usedAt: null,
      expiresAt: new Date(Date.now() - 1000),
      user: { id: 'u1', tenantId: 'ten_1' },
    });
    const res = await request(app).post('/api/v1/auth/verify-email').send({ token: 'x'.repeat(43) });
    expect(res.status).toBe(400);
  });
});

describe('CORS', () => {
  it('echoes only allow-listed origins', async () => {
    const ok = await request(app).get('/health').set('Origin', 'http://localhost:3000');
    const bad = await request(app).get('/health').set('Origin', 'https://evil.example');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });
});
