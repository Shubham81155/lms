import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import http from 'http';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// OpenID Connect sign-in against a mock identity provider that checks PKCE and issues signed ID
// tokens, with the real API, real migrations and the unprivileged database role.

const PASSWORD = 'CorrectHorse1!';
const CLIENT_ID = 'lms-client';
const CLIENT_SECRET = 'super-secret-value';
const APP = 'http://localhost:3000';
const pw = (slug: string) => `${PASSWORD}-${slug}`;

let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;

// ---- mock identity provider -------------------------------------------------------------------
const idpKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
let idp: http.Server;
let ISSUER: string;

interface Grant {
  claims: Record<string, unknown>;
  challenge: string;
  nonce: string;
  redirectUri?: string;
  override?: TokenOverride;
}
interface TokenOverride {
  key?: crypto.KeyObject;
  alg?: 'RS256' | 'HS256';
  aud?: string;
  nonce?: string;
  expiresIn?: number;
  iss?: string;
}
const grants = new Map<string, Grant>();
const tokenRequests: URLSearchParams[] = [];

function startIdp() {
  idp = http.createServer((req, res) => {
    const url = new URL(req.url!, ISSUER);
    const json = (b: unknown, status = 200) => {
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(b));
    };
    if (url.pathname === '/.well-known/openid-configuration') {
      return json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        jwks_uri: `${ISSUER}/jwks`,
      });
    }
    if (url.pathname === '/jwks') {
      return json({ keys: [{ ...idpKey.publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' }] });
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const f = new URLSearchParams(body);
        tokenRequests.push(f);
        const grant = grants.get(f.get('code') ?? '');
        grants.delete(f.get('code') ?? ''); // codes are single use
        const verifierOk =
          grant &&
          crypto
            .createHash('sha256')
            .update(f.get('code_verifier') ?? '')
            .digest('base64url') === grant.challenge;
        const redirectOk = grant && (grant.redirectUri === undefined || f.get('redirect_uri') === grant.redirectUri);
        if (
          !grant ||
          !verifierOk ||
          !redirectOk ||
          f.get('client_id') !== CLIENT_ID ||
          f.get('client_secret') !== CLIENT_SECRET ||
          f.get('grant_type') !== 'authorization_code'
        ) {
          return json({ error: 'invalid_grant' }, 400);
        }
        const o = grant.override ?? {};
        const payload = { iss: o.iss ?? ISSUER, aud: o.aud ?? CLIENT_ID, nonce: o.nonce ?? grant.nonce, ...grant.claims };
        const id_token =
          o.alg === 'HS256'
            ? jwt.sign(payload, 'shared-secret', { algorithm: 'HS256', expiresIn: '5m' })
            : jwt.sign(payload, (o.key ?? idpKey.privateKey) as any, { algorithm: 'RS256', keyid: 'k1', expiresIn: o.expiresIn ?? 300 });
        return json({ id_token, access_token: 'unused', token_type: 'Bearer' });
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  return new Promise<void>((r) =>
    idp.listen(0, '127.0.0.1', () => {
      ISSUER = `http://127.0.0.1:${(idp.address() as any).port}`;
      r();
    })
  );
}

async function seed() {
  await admin.tenant.create({ data: { id: 't-h', slug: 'harvard', name: 'Harvard', tier: 'ENTERPRISE' } });
  await admin.tenant.create({ data: { id: 't-m', slug: 'mit', name: 'MIT', tier: 'STARTER' } });
  const user = (id: string, tenantId: string, slug: string, role: any, extra: object = {}) =>
    admin.user.create({
      data: {
        id,
        tenantId,
        email: `${id}@x.edu`,
        firstName: id,
        lastName: 'L',
        role,
        passwordHash: bcrypt.hashSync(pw(slug), 4),
        emailVerified: true,
        ...extra,
      },
    });
  await user('admin', 't-h', 'harvard', 'TENANT_ADMIN');
  await user('teacher', 't-h', 'harvard', 'INSTRUCTOR');
  for (const s of ['s1', 's2', 's3', 's4', 's5', 's6']) await user(s, 't-h', 'harvard', 'STUDENT');
  await user('susp', 't-h', 'harvard', 'STUDENT', { status: 'SUSPENDED' });
  await user('bound', 't-h', 'harvard', 'STUDENT', { idpProvider: 'OIDC', idpSubjectId: 'sub-original' });
  await user('scim', 't-h', 'harvard', 'STUDENT', { idpProvider: 'SCIM', idpSubjectId: 'directory-id-1', passwordHash: null });
  await user('m-admin', 't-m', 'mit', 'TENANT_ADMIN');
}

beforeAll(async () => {
  await startIdp();
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  await seed();
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
}, 240_000);

afterAll(async () => {
  await new Promise<void>((r) => idp?.close(() => r()));
  await admin?.$disconnect();
  await db?.stop();
}, 60_000);

async function as(who: string, tenant: 'harvard' | 'mit' = 'harvard') {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/v1/auth/login')
    .set('x-tenant-id', tenant)
    .send({ email: `${who}@x.edu`, password: pw(tenant) });
  expect(res.status, `login as ${who}`).toBe(200);
  return agent;
}

/**
 * Plays the browser: starts the flow, lets the mock IdP authenticate `claims`, and returns to the
 * callback. `tweak` lets a test corrupt one step.
 */
async function signIn(
  claims: Record<string, unknown>,
  tweak: {
    override?: TokenOverride;
    state?: string;
    skipCookie?: boolean;
    error?: string;
    code?: string;
    host?: string;
    noTenantHeader?: boolean;
  } = {}
) {
  const agent = request.agent(app);
  const via = (r: request.Test) => {
    if (!tweak.noTenantHeader) r.set('x-tenant-id', 'harvard');
    if (tweak.host) r.set('Host', tweak.host);
    return r;
  };
  const start = await via(agent.get('/api/v1/auth/sso/start'));
  if (start.status !== 302 || !start.headers.location.startsWith(ISSUER)) return { agent, start, callback: start };
  const q = new URL(start.headers.location).searchParams;
  const code = tweak.code ?? crypto.randomUUID();
  grants.set(code, {
    claims,
    challenge: q.get('code_challenge')!,
    nonce: q.get('nonce')!,
    redirectUri: q.get('redirect_uri')!,
    override: tweak.override,
  });

  const params = new URLSearchParams(
    tweak.error ? { error: tweak.error, state: q.get('state')! } : { code, state: tweak.state ?? q.get('state')! }
  );
  const cb = tweak.skipCookie ? request(app) : agent;
  const callback = await via(cb.get(`/api/v1/auth/sso/callback?${params}`));
  return { agent, start, callback, query: q };
}

const refused = (r: { callback: request.Response }) => {
  expect(r.callback.status).toBe(302);
  expect(r.callback.headers.location).toBe(`${APP}/login?error=sso_failed`);
  expect(String(r.callback.headers['set-cookie'] ?? '')).not.toContain('lms_token=ey');
};

const goodClaims = (id: string, extra: Record<string, unknown> = {}) => ({
  sub: `sub-${id}`,
  email: `${id}@x.edu`,
  email_verified: true,
  ...extra,
});

// ---------------------------------------------------------------------------
describe('SSO configuration (administrator)', () => {
  const body = (over: object = {}) => ({
    issuer: ISSUER,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    enabled: true,
    allowedDomains: [],
    ...over,
  });

  it('reports SSO as unavailable until it is configured', async () => {
    expect((await request(app).get('/api/v1/auth/sso/status').set('x-tenant-id', 'harvard')).body).toEqual({
      enabled: false,
      oidc: false,
      saml: false,
    });
    const start = await request(app).get('/api/v1/auth/sso/start').set('x-tenant-id', 'harvard');
    expect(start.status).toBe(302);
    expect(start.headers.location).toBe(`${APP}/login?error=sso_unavailable`);
  });

  it('is administrator-only and plan-gated', async () => {
    expect((await (await as('teacher')).put('/api/v1/admin/sso').send(body())).status).toBe(403);
    expect((await (await as('teacher')).get('/api/v1/admin/sso')).status).toBe(403);
    expect((await request(app).put('/api/v1/admin/sso').send(body())).status).toBe(401);
    expect((await (await as('m-admin', 'mit')).put('/api/v1/admin/sso').send(body())).status).toBe(403); // STARTER plan
  });

  it('validates input and checks the provider before enabling', async () => {
    const harvard = await as('admin');
    expect((await harvard.put('/api/v1/admin/sso').send(body({ clientSecret: undefined }))).status).toBe(400); // first save needs a secret
    expect((await harvard.put('/api/v1/admin/sso').send(body({ issuer: 'not a url' }))).status).toBe(400);
    expect((await harvard.put('/api/v1/admin/sso').send(body({ allowedDomains: ['not a domain'] }))).status).toBe(400);
    expect((await harvard.put('/api/v1/admin/sso').send(body({ clientSecret: 'short' }))).status).toBe(400);
    const unreachable = await harvard.put('/api/v1/admin/sso').send(body({ issuer: 'http://127.0.0.1:1' }));
    expect(unreachable.status).toBe(400);
    expect(unreachable.body.error).toMatch(/provider's configuration/);
    expect(await admin.ssoConnection.count()).toBe(0);
  });

  it('stores the secret encrypted and never returns it', async () => {
    const harvard = await as('admin');
    const res = await harvard.put('/api/v1/admin/sso').send(body({ issuer: `${ISSUER}/`, allowedDomains: ['X.edu', 'x.edu'] }));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ issuer: ISSUER, clientId: CLIENT_ID, enabled: true, hasSecret: true, allowedDomains: ['x.edu'] });
    expect(res.body.data.redirectUris).toEqual([`${APP}/api/v1/auth/sso/callback`]);
    expect(JSON.stringify(res.body)).not.toContain(CLIENT_SECRET);

    const row = await admin.ssoConnection.findFirst();
    expect(row?.clientSecretEnc).toBeTruthy();
    expect(row?.clientSecretEnc).not.toContain(CLIENT_SECRET);
    expect(JSON.stringify((await harvard.get('/api/v1/admin/sso')).body)).not.toContain(CLIENT_SECRET);

    // Updating without a secret keeps the stored one.
    const keep = await harvard.put('/api/v1/admin/sso').send(body({ clientSecret: undefined, allowedDomains: [] }));
    expect(keep.status).toBe(200);
    expect((await admin.ssoConnection.findFirst())?.clientSecretEnc).toBe(row?.clientSecretEnc);
    expect(await admin.auditLog.count({ where: { action: 'SSO_CONFIG_UPDATED' } })).toBe(2);
  });

  it('shows the login button only for the configured tenant', async () => {
    expect((await request(app).get('/api/v1/auth/sso/status').set('x-tenant-id', 'harvard')).body).toEqual({
      enabled: true,
      oidc: true,
      saml: false,
    });
    expect((await request(app).get('/api/v1/auth/sso/status').set('x-tenant-id', 'mit')).body).toEqual({
      enabled: false,
      oidc: false,
      saml: false,
    });
    expect((await request(app).get('/api/v1/auth/sso/start').set('x-tenant-id', 'mit')).headers.location).toBe(
      `${APP}/login?error=sso_unavailable`
    );
  });
});

// ---------------------------------------------------------------------------
describe('OIDC sign-in', () => {
  it('redirects to the provider with PKCE, state, nonce and a protected flow cookie', async () => {
    const start = await request(app).get('/api/v1/auth/sso/start').set('x-tenant-id', 'harvard');
    expect(start.status).toBe(302);
    const loc = new URL(start.headers.location);
    expect(loc.origin).toBe(ISSUER);
    expect(loc.pathname).toBe('/authorize');
    const q = loc.searchParams;
    expect(q.get('response_type')).toBe('code');
    expect(q.get('client_id')).toBe(CLIENT_ID);
    expect(q.get('redirect_uri')).toBe(`${APP}/api/v1/auth/sso/callback`);
    expect(q.get('scope')).toBe('openid email profile');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('code_challenge')!.length).toBeGreaterThanOrEqual(43);
    expect(q.get('state')!.length).toBeGreaterThan(20);
    expect(q.get('nonce')!.length).toBeGreaterThan(20);
    expect(JSON.stringify(q)).not.toContain(CLIENT_SECRET);

    const cookie = String(start.headers['set-cookie']);
    expect(cookie).toContain('lms_sso=');
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toContain('Path=/api/v1/auth/sso');
    expect(cookie).not.toContain(q.get('state')!); // state is inside the signed token, not readable plaintext
  });

  it('signs in an existing user matched by verified e-mail, then by subject', async () => {
    const r = await signIn(goodClaims('s1'));
    expect(r.callback.status).toBe(302);
    expect(r.callback.headers.location).toBe(`${APP}/`);
    expect(String(r.callback.headers['set-cookie'])).toContain('lms_token=');
    expect(tokenRequests.at(-1)!.get('client_secret')).toBe(CLIENT_SECRET); // the server, not the browser, holds it

    const me = await r.agent.get('/api/v1/auth/me').set('x-tenant-id', 'harvard');
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ id: 's1', role: 'STUDENT' });

    const bound = await admin.user.findUnique({ where: { id: 's1' } });
    expect(bound).toMatchObject({ idpProvider: 'OIDC', idpSubjectId: 'sub-s1' });
    expect(bound?.lastLoginAt).toBeTruthy();
    expect(await admin.auditLog.count({ where: { userId: 's1', action: 'USER_LOGIN' } })).toBe(1);

    // Once bound, the subject is authoritative: a changed e-mail still reaches the same account,
    // and an unverified e-mail no longer matters.
    const again = await signIn({ sub: 'sub-s1', email: 'renamed@x.edu', email_verified: false });
    expect(again.callback.headers.location).toBe(`${APP}/`);
    expect((await again.agent.get('/api/v1/auth/me').set('x-tenant-id', 'harvard')).body.user.id).toBe('s1');
  });

  it('clears the flow cookie so a callback cannot be replayed', async () => {
    const r = await signIn(goodClaims('s2'));
    expect(r.callback.headers.location).toBe(`${APP}/`);
    const replay = await r.agent
      .get(`/api/v1/auth/sso/callback?code=anything&state=${r.query!.get('state')}`)
      .set('x-tenant-id', 'harvard');
    expect(replay.headers.location).toBe(`${APP}/login?error=sso_failed`);
  });

  it('never creates accounts', async () => {
    const before = await admin.user.count();
    refused(await signIn(goodClaims('stranger')));
    expect(await admin.user.count()).toBe(before);
  });

  it('refuses unverified or missing e-mail on first sign-in', async () => {
    refused(await signIn({ sub: 'sub-s3', email: 's3@x.edu', email_verified: false }));
    refused(await signIn({ sub: 'sub-s3', email: 's3@x.edu' })); // claim absent
    refused(await signIn({ sub: 'sub-s3' }));
    expect((await admin.user.findUnique({ where: { id: 's3' } }))?.idpSubjectId).toBeNull();
  });

  it('refuses suspended and locked accounts', async () => {
    refused(await signIn(goodClaims('susp')));
    await admin.user.update({ where: { id: 's4' }, data: { lockedUntil: new Date(Date.now() + 600_000) } });
    refused(await signIn(goodClaims('s4')));
    await admin.user.update({ where: { id: 's4' }, data: { lockedUntil: null } });
  });

  it('will not move an account bound to another identity, but binds a SCIM-provisioned one', async () => {
    refused(await signIn({ sub: 'sub-attacker', email: 'bound@x.edu', email_verified: true }));
    expect((await admin.user.findUnique({ where: { id: 'bound' } }))?.idpSubjectId).toBe('sub-original');

    const ok = await signIn({ sub: 'oidc-sub-for-scim-user', email: 'scim@x.edu', email_verified: true });
    expect(ok.callback.headers.location).toBe(`${APP}/`);
    expect(await admin.user.findUnique({ where: { id: 'scim' } })).toMatchObject({
      idpProvider: 'OIDC',
      idpSubjectId: 'oidc-sub-for-scim-user',
    });
  });

  it('enforces the allowed e-mail domains', async () => {
    await (
      await as('admin')
    )
      .put('/api/v1/admin/sso')
      .send({ issuer: ISSUER, clientId: CLIENT_ID, enabled: true, allowedDomains: ['partner.org'] });
    refused(await signIn(goodClaims('s5')));
    await (
      await as('admin')
    )
      .put('/api/v1/admin/sso')
      .send({ issuer: ISSUER, clientId: CLIENT_ID, enabled: true, allowedDomains: ['x.edu'] });
    expect((await signIn(goodClaims('s5'))).callback.headers.location).toBe(`${APP}/`);
  });

  it('rejects tampered or invalid flows', async () => {
    refused(await signIn(goodClaims('s6'), { state: 'forged-state' }));
    refused(await signIn(goodClaims('s6'), { skipCookie: true })); // no flow cookie (e.g. a login-CSRF attempt)
    refused(await signIn(goodClaims('s6'), { error: 'access_denied' }));
  });

  it('validates the ID token strictly', async () => {
    const claims = goodClaims('s6');
    refused(await signIn(claims, { override: { key: otherKey.privateKey } })); // signed by the wrong key
    refused(await signIn(claims, { override: { aud: 'someone-else' } }));
    refused(await signIn(claims, { override: { iss: 'https://evil.example' } }));
    refused(await signIn(claims, { override: { nonce: 'replayed-nonce' } }));
    refused(await signIn(claims, { override: { expiresIn: -60 } }));
    refused(await signIn(claims, { override: { alg: 'HS256' } })); // symmetric tokens are never accepted
    refused(await signIn({ email: 's6@x.edu', email_verified: true })); // no subject
    expect((await admin.user.findUnique({ where: { id: 's6' } }))?.idpSubjectId).toBeNull();
  });

  it('refuses when the provider rejects the exchange (wrong PKCE verifier or secret)', async () => {
    // A grant bound to a different challenge makes the provider's PKCE check fail.
    const agent = request.agent(app);
    const start = await agent.get('/api/v1/auth/sso/start').set('x-tenant-id', 'harvard');
    const q = new URL(start.headers.location).searchParams;
    grants.set('bad-pkce', { claims: goodClaims('s6'), challenge: 'not-the-real-challenge', nonce: q.get('nonce')! });
    const cb = await agent.get(`/api/v1/auth/sso/callback?code=bad-pkce&state=${q.get('state')}`).set('x-tenant-id', 'harvard');
    expect(cb.headers.location).toBe(`${APP}/login?error=sso_failed`);
    expect(String(cb.headers['set-cookie'] ?? '')).not.toContain('lms_token=ey');
  });

  it('records refusals in the audit log without leaking reasons to the browser', async () => {
    const failures = await admin.auditLog.findMany({ where: { action: 'SSO_LOGIN_FAILED' } });
    expect(failures.length).toBeGreaterThanOrEqual(8);
    const reasons = failures.map((f) => (f.diffJson as any).reason);
    expect(reasons).toContain('no matching account');
    expect(reasons).toContain('no verified email');
    const r = await signIn(goodClaims('stranger'));
    expect(r.callback.headers.location).not.toContain('account'); // generic error code only
  });

  it('keeps the password login working alongside SSO', async () => {
    expect(
      (
        await request(app)
          .post('/api/v1/auth/login')
          .set('x-tenant-id', 'harvard')
          .send({ email: 's1@x.edu', password: pw('harvard') })
      ).status
    ).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe('accounts created at first sign-in (OIDC)', () => {
  const conf = (over: object) => ({
    issuer: ISSUER,
    clientId: CLIENT_ID,
    enabled: true,
    allowedDomains: [],
    autoCreateAccounts: false,
    ...over,
  });
  const created = (email: string) => admin.user.findFirst({ where: { tenantId: 't-h', email } });

  it('is off by default, and needs allowed domains to be switched on', async () => {
    const a = await as('admin');
    expect((await a.get('/api/v1/admin/sso')).body.data.autoCreateAccounts).toBe(false);
    refused(await signIn({ sub: 'sub-new0', email: 'new0@x.edu', email_verified: true }));
    expect(await created('new0@x.edu')).toBeNull();
    const res = await a.put('/api/v1/admin/sso').send(conf({ autoCreateAccounts: true }));
    expect(res.status).toBe(400);
    const on = await a.put('/api/v1/admin/sso').send(conf({ autoCreateAccounts: true, allowedDomains: ['x.edu'] }));
    expect(on.body.data).toMatchObject({ autoCreateAccounts: true, allowedDomains: ['x.edu'] });
  });

  it('creates a learner bound to the identity, once', async () => {
    const r = await signIn({ sub: 'sub-new1', email: 'New1@X.edu', email_verified: true, given_name: 'Nia', family_name: 'Patel' });
    expect(r.callback.headers.location).toBe(`${APP}/`);
    const u = await created('new1@x.edu');
    expect(u).toMatchObject({
      role: 'STUDENT',
      status: 'ACTIVE',
      firstName: 'Nia',
      lastName: 'Patel',
      emailVerified: true,
      passwordHash: null,
      idpProvider: 'OIDC',
      idpSubjectId: 'sub-new1',
    });
    expect((await r.agent.get('/api/v1/auth/me').set('x-tenant-id', 'harvard')).body.user).toMatchObject({ id: u!.id, role: 'STUDENT' });
    expect(await admin.auditLog.count({ where: { action: 'SSO_USER_CREATED', resourceId: u!.id } })).toBe(1);

    const before = await admin.user.count();
    expect((await signIn({ sub: 'sub-new1', email: 'new1@x.edu', email_verified: true })).callback.headers.location).toBe(`${APP}/`);
    expect(await admin.user.count()).toBe(before);
  });

  it('splits a full name when the provider sends no given or family name', async () => {
    await signIn({ sub: 'sub-new2', email: 'new2@x.edu', email_verified: true, name: 'Ada King Lovelace' });
    expect(await created('new2@x.edu')).toMatchObject({ firstName: 'Ada King', lastName: 'Lovelace' });
  });

  it('never creates from an unverified e-mail, another domain, or past the seat quota', async () => {
    refused(await signIn({ sub: 'sub-new3', email: 'new3@x.edu', email_verified: false }));
    refused(await signIn({ sub: 'sub-new4', email: 'new4@elsewhere.org', email_verified: true }));
    await admin.tenant.update({
      where: { id: 't-h' },
      data: { seatQuota: await admin.user.count({ where: { tenantId: 't-h', status: { in: ['ACTIVE', 'INVITED'] } } }) },
    });
    refused(await signIn({ sub: 'sub-new5', email: 'new5@x.edu', email_verified: true }));
    await admin.tenant.update({ where: { id: 't-h' }, data: { seatQuota: null } });
    for (const e of ['new3@x.edu', 'new4@elsewhere.org', 'new5@x.edu']) expect(await created(e)).toBeNull();
    const reasons = (await admin.auditLog.findMany({ where: { action: 'SSO_LOGIN_FAILED' } })).map((f) => (f.diffJson as any).reason);
    expect(reasons).toContain('no seats left');
    await (await as('admin')).put('/api/v1/admin/sso').send(conf({}));
  });
});

describe('custom domains', () => {
  const CB = (origin: string) => `${origin}/api/v1/auth/sso/callback`;
  const CUSTOM = 'http://learn.harvard.edu'; // tests run with APP_URL on http, so custom domains follow it

  beforeAll(async () => {
    await admin.tenant.update({ where: { id: 't-h' }, data: { customDomain: 'learn.harvard.edu' } });
    await admin.tenant.update({ where: { id: 't-m' }, data: { customDomain: 'learn.mit.edu' } });
  });

  it('tells the administrator every redirect URI to register', async () => {
    const res = await (await as('admin')).get('/api/v1/admin/sso');
    expect(res.body.redirectUris).toEqual([CB(APP), CB(CUSTOM)]);
    expect(res.body.data.redirectUris).toEqual([CB(APP), CB(CUSTOM)]);
  });

  it('starts and finishes sign-in on the custom domain it began on', async () => {
    const r = await signIn(goodClaims('s1'), { host: 'learn.harvard.edu', noTenantHeader: true }); // tenant found from the host alone
    expect(new URL(r.start.headers.location).searchParams.get('redirect_uri')).toBe(CB(CUSTOM));
    expect(tokenRequests.at(-1)!.get('redirect_uri')).toBe(CB(CUSTOM)); // identical in the code exchange
    expect(r.callback.status).toBe(302);
    expect(r.callback.headers.location).toBe(`${CUSTOM}/`);
    expect(String(r.callback.headers['set-cookie'])).toContain('lms_token=');
  });

  it('sends failures back to the same domain', async () => {
    const r = await signIn(goodClaims('s1'), { host: 'learn.harvard.edu', state: 'forged-state' });
    expect(r.callback.headers.location).toBe(`${CUSTOM}/login?error=sso_failed`);
  });

  it('keeps using the platform address when that is where the user came from', async () => {
    const r = await signIn(goodClaims('s1'));
    expect(new URL(r.start.headers.location).searchParams.get('redirect_uri')).toBe(CB(APP));
    expect(r.callback.headers.location).toBe(`${APP}/`);
    expect((await signIn(goodClaims('s1'), { host: 'localhost:3000' })).callback.headers.location).toBe(`${APP}/`);
  });

  it('never lets a forged, foreign or inexact Host choose the destination', async () => {
    for (const host of [
      'evil.example',
      'learn.mit.edu',
      'learn.harvard.edu:8443',
      'learn.harvard.edu.evil.example',
      'LEARN.HARVARD.EDU.',
    ]) {
      const r = await signIn(goodClaims('s1'), { host });
      const redirect = new URL(r.start.headers.location).searchParams.get('redirect_uri');
      // 'LEARN.HARVARD.EDU.' (trailing dot) is deliberately not treated as a match either.
      expect(redirect, host).toBe(CB(APP));
      expect(r.callback.headers.location, host).toBe(`${APP}/`);
      expect(JSON.stringify([r.start.headers.location, r.callback.headers.location]), host).not.toContain('evil.example');
    }
    // Host matching is case-insensitive for the real domain.
    const ok = await signIn(goodClaims('s1'), { host: 'Learn.Harvard.EDU' });
    expect(new URL(ok.start.headers.location).searchParams.get('redirect_uri')).toBe(CB(CUSTOM));
  });

  it('does not let one tenant use another tenant’s domain', async () => {
    // MIT's domain with Harvard's tenant hint: Harvard may only use its own origins.
    const r = await signIn(goodClaims('s1'), { host: 'learn.mit.edu' });
    expect(new URL(r.start.headers.location).searchParams.get('redirect_uri')).toBe(CB(APP));
  });

  it('shows the SSO button for the tenant that owns the domain', async () => {
    expect((await request(app).get('/api/v1/auth/sso/status').set('Host', 'learn.harvard.edu')).body.enabled).toBe(true);
    expect((await request(app).get('/api/v1/auth/sso/status').set('Host', 'learn.mit.edu')).body.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('SSO switch-off and removal', () => {
  it('stops sign-in as soon as the administrator disables it', async () => {
    const harvard = await as('admin');
    expect(
      (await harvard.put('/api/v1/admin/sso').send({ issuer: ISSUER, clientId: CLIENT_ID, enabled: false, allowedDomains: [] })).body.data
        .enabled
    ).toBe(false);
    expect((await request(app).get('/api/v1/auth/sso/status').set('x-tenant-id', 'harvard')).body.enabled).toBe(false);
    expect((await signIn(goodClaims('s1'))).start.headers.location).toBe(`${APP}/login?error=sso_unavailable`);
  });

  it('disabling mid-flow invalidates a started sign-in', async () => {
    const harvard = await as('admin');
    await harvard.put('/api/v1/admin/sso').send({ issuer: ISSUER, clientId: CLIENT_ID, enabled: true, allowedDomains: [] });
    const agent = request.agent(app);
    const start = await agent.get('/api/v1/auth/sso/start').set('x-tenant-id', 'harvard');
    const q = new URL(start.headers.location).searchParams;
    grants.set('mid-flow', { claims: goodClaims('s1'), challenge: q.get('code_challenge')!, nonce: q.get('nonce')! });
    await harvard.put('/api/v1/admin/sso').send({ issuer: ISSUER, clientId: CLIENT_ID, enabled: false, allowedDomains: [] });
    const cb = await agent.get(`/api/v1/auth/sso/callback?code=mid-flow&state=${q.get('state')}`).set('x-tenant-id', 'harvard');
    expect(cb.headers.location).toBe(`${APP}/login?error=sso_failed`);
  });

  it('removes the connection and keeps tenants isolated', async () => {
    const harvard = await as('admin');
    expect((await (await as('m-admin', 'mit')).delete('/api/v1/admin/sso')).status).toBe(404); // not Harvard's to delete
    expect((await harvard.delete('/api/v1/admin/sso')).status).toBe(204);
    expect((await harvard.get('/api/v1/admin/sso')).body.data).toBeNull();
    expect(await admin.ssoConnection.count()).toBe(0);
  });

  it('hides connections from a database session with no tenant context', async () => {
    await admin.ssoConnection.create({ data: { tenantId: 't-h', issuer: ISSUER, clientId: 'c', clientSecretEnc: 'x' } });
    const unscoped = new PrismaClient({ datasourceUrl: db.appUrl });
    try {
      expect(await unscoped.ssoConnection.count()).toBe(0);
    } finally {
      await unscoped.$disconnect();
    }
  });
});
