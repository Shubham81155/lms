import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

vi.mock('../src/lib/prisma', async () => {
  const { createFakePrisma } = await import('./helpers.js');
  const fake = createFakePrisma();
  return {
    prisma: fake,
    default: fake,
    basePrisma: fake,
    runInTenantTransaction: async (_tenantId: string, fn: (tx: unknown) => Promise<unknown>) => fn(fake),
  };
});

import { prisma } from '../src/lib/prisma';
import type { FakePrisma } from './helpers';
import { currentTenantId } from '@enterprise-lms/database';
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

  describe('server-side session checks', () => {
    const session = (over: Record<string, unknown> = {}) =>
      fake.user.findFirst.mockResolvedValue({ role: 'STUDENT', status: 'ACTIVE', tokenVersion: 0, tenant: { status: 'ACTIVE' }, ...over });

    it('rejects a token issued before the user token version was bumped', async () => {
      session({ tokenVersion: 3 });
      const res = await request(app).get('/api/v1/courses').set('Authorization', `Bearer ${tokenFor()}`);
      expect(res.status).toBe(401);
    });

    it('accepts a token whose version still matches', async () => {
      session({ tokenVersion: 3 });
      const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${tokenFor({ tv: 3 })}`);
      expect(res.status).not.toBe(401);
    });

    it('rejects a token for a suspended or deleted user', async () => {
      session({ status: 'SUSPENDED' });
      expect((await request(app).get('/api/v1/courses').set('Authorization', `Bearer ${tokenFor()}`)).status).toBe(401);
      fake.user.findFirst.mockResolvedValue(null);
      expect((await request(app).get('/api/v1/courses').set('Authorization', `Bearer ${tokenFor()}`)).status).toBe(401);
    });

    it('rejects a valid token of a suspended organisation with 403', async () => {
      session({ tenant: { status: 'SUSPENDED' } });
      const res = await request(app).get('/api/v1/courses').set('Authorization', `Bearer ${tokenFor()}`);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('TENANT_SUSPENDED');
    });

    it('uses the role stored in the database, not the one in the token', async () => {
      session({ role: 'STUDENT' });
      const res = await request(app).get('/api/v1/admin/stats').set('Authorization', `Bearer ${tokenFor({ role: 'SUPER_ADMIN' })}`);
      expect(res.status).toBe(403);
    });

    it('logout bumps the token version so the old token stops working', async () => {
      session();
      await request(app).post('/api/v1/auth/logout').set('Authorization', `Bearer ${tokenFor()}`);
      const bump = fake.user.update.mock.calls.find((c: any) => c[0].data.tokenVersion);
      expect(bump?.[0].data.tokenVersion).toEqual({ increment: 1 });
    });
  });

  it('rejects a token missing required claims', async () => {
    const bad = jwt.sign({ id: 'u1' }, SECRET, { algorithm: 'HS256' });
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${bad}`);
    expect(res.status).toBe(401);
  });

  it('enforces roles: a student token cannot reach admin routes', async () => {
    fake.user.findFirst.mockResolvedValue({ role: 'STUDENT', status: 'ACTIVE', tokenVersion: 0, tenant: { status: 'ACTIVE' } });
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
    expect(fake.user.findFirst.mock.calls.map((c: any) => c[0].where).find((w: any) => w.tenantId)).toMatchObject({ tenantId: 'ten_1' });
  });

  it('runs the request inside the tenant context from the token, not from headers', async () => {
    let seen: string | undefined;
    fake.user.findFirst.mockImplementation(async () => {
      seen = currentTenantId();
      return userRecord();
    });
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokenFor({ tenantId: 'ten_1' })}`)
      .set('x-tenant-id', 'ten_attacker');
    expect(seen).toBe('ten_1');
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

  it('tries tenant hints in priority order: header, custom domain, subdomain, default', async () => {
    fake.tenant.findFirst.mockResolvedValue(null);
    await request(app)
      .post('/api/v1/auth/login')
      .set('Host', 'stanford.lms.example.com')
      .set('x-tenant-id', 'ten_hdr')
      .send({ email: 'a@x.edu', password: PASSWORD });

    const hints = fake.tenant.findFirst.mock.calls.map((c: any) => c[0].where.OR[0].id);
    expect(hints).toEqual(['ten_hdr', 'stanford.lms.example.com', 'stanford', 'harvard']);
  });

  it('does not treat an IP address host as a tenant subdomain', async () => {
    fake.tenant.findFirst.mockResolvedValue(null);
    await request(app)
      .post('/api/v1/auth/login')
      .set('Host', '10.0.0.5:4000')
      .send({ email: 'a@x.edu', password: PASSWORD });
    const hints = fake.tenant.findFirst.mock.calls.map((c: any) => c[0].where.OR[0].id);
    expect(hints).toEqual(['harvard']);
  });

  it('ignores X-Forwarded-Host unless a trusted proxy is configured', async () => {
    fake.tenant.findFirst.mockResolvedValue(null);
    await request(app)
      .post('/api/v1/auth/login')
      .set('x-forwarded-host', 'victim.lms.example.com')
      .send({ email: 'a@x.edu', password: PASSWORD });
    const hints = fake.tenant.findFirst.mock.calls.map((c: any) => c[0].where.OR[0].id);
    expect(hints).not.toContain('victim');
  });

  it('runs the login queries inside the resolved tenant context', async () => {
    const seen: (string | undefined)[] = [];
    fake.user.findFirst.mockImplementation(async () => {
      seen.push(currentTenantId());
      return userRecord();
    });
    await request(app).post('/api/v1/auth/login').send({ email: 'a@x.edu', password: PASSWORD });
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set(['ten_1']));
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

  it('rejects a suspended tenant, saying it is suspended', async () => {
    fake.tenant.findFirst.mockResolvedValue({ id: 'ten_1', status: 'SUSPENDED' });
    const res = await login({ email: 'a@x.edu', password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TENANT_SUSPENDED');
    expect(fake.user.findFirst).not.toHaveBeenCalled();
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
    expect(stored.tenantId).toBe('ten_1');
    expect(stored.tokenHash).toBe(hashOneTimeToken(emailed));
    expect(JSON.stringify(stored)).not.toContain(emailed);
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  const validRecord = (over: Record<string, unknown> = {}) => ({
    userId: 'u1',
    tenantId: 'ten_1',
    usedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    ...over,
  });
  const reset = (password = 'a-brand-new-password') =>
    request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: 'x'.repeat(43), password });

  it('sets a bcrypt hash, clears the lockout and burns outstanding tokens', async () => {
    fake.passwordResetToken.findUnique.mockResolvedValue(validRecord());
    fake.user.findFirst.mockResolvedValue({ status: 'ACTIVE' });
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
    ['suspended user', validRecord()],
  ])('rejects an %s', async (label, record) => {
    fake.passwordResetToken.findUnique.mockResolvedValue(record);
    fake.user.findFirst.mockResolvedValue({ status: label === 'suspended user' ? 'SUSPENDED' : 'ACTIVE' });
    const res = await reset();
    expect(res.status).toBe(400);
    expect(fake.user.update).not.toHaveBeenCalled();
  });

  it('enforces the password policy', async () => {
    fake.passwordResetToken.findUnique.mockResolvedValue(validRecord());
    fake.user.findFirst.mockResolvedValue({ status: 'ACTIVE' });
    expect((await reset('short')).status).toBe(400);
    expect(fake.user.update).not.toHaveBeenCalled();
  });
});

describe('email verification', () => {
  it('marks the email verified for a valid token', async () => {
    fake.emailVerificationToken.findUnique.mockResolvedValue({
      userId: 'u1',
      tenantId: 'ten_1',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const res = await request(app).post('/api/v1/auth/verify-email').send({ token: 'x'.repeat(43) });
    expect(res.status).toBe(200);
    expect(fake.user.update.mock.calls[0][0].data).toEqual({ emailVerified: true });
  });

  it('rejects an expired token', async () => {
    fake.emailVerificationToken.findUnique.mockResolvedValue({
      userId: 'u1',
      tenantId: 'ten_1',
      usedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    });
    const res = await request(app).post('/api/v1/auth/verify-email').send({ token: 'x'.repeat(43) });
    expect(res.status).toBe(400);
  });
});

describe('health endpoints', () => {
  it('does not claim compliance', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/ferpa|soc2|wcag|compliance/i);
  });

  it('reports ready only when the database answers', async () => {
    (fake as any).$queryRaw = vi.fn().mockResolvedValueOnce([{ '?column?': 1 }]).mockRejectedValueOnce(new Error('down'));
    expect((await request(app).get('/ready')).status).toBe(200);
    expect((await request(app).get('/ready')).status).toBe(503);
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

describe('GET /tenant/config', () => {
  it('is public and backed by the database', async () => {
    fake.tenant.findUnique.mockResolvedValue({
      id: 'ten_1', slug: 'harvard', name: 'Harvard University',
      logoUrl: null, faviconUrl: null, primaryColor: '#a51c30', secondaryColor: '#111111',
    });
    const res = await request(app).get('/api/v1/tenant/config');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tenantId: 'ten_1', name: 'Harvard University' });
    expect(res.body.theme.primaryColor).toBe('#a51c30');
  });

  it('404s for an unknown tenant', async () => {
    fake.tenant.findFirst.mockResolvedValue(null);
    const res = await request(app).get('/api/v1/tenant/config');
    expect(res.status).toBe(404);
  });
});
