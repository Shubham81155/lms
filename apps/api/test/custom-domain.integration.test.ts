import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// Custom domains with proof of ownership: a requested domain waits until DNS carries its TXT record, never
// resolves before that, and a live domain stays live until a new one verifies. DNS is a fake resolver. Real
// PostgreSQL and RLS.

const PASSWORD = 'CorrectHorse1!';
const TLS_SECRET = 'tls-ask-secret-for-tests';
let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;

// name -> TXT values, or an error code; CNAMEs separately.
let txt: Record<string, string[] | string> = {};
let cnames: Record<string, string[]> = {};

const dnsError = (code: string) => Object.assign(new Error(code), { code });

beforeAll(async () => {
  process.env.PLATFORM_OPERATOR_TENANT = 'ops';
  process.env.DEFAULT_TENANT_SLUG = 'default-tenant';
  process.env.TENANT_BASE_DOMAIN = 'lms.test';
  process.env.CUSTOM_DOMAIN_TARGET = 'edge.platform-example.com';
  process.env.TLS_ASK_SECRET = TLS_SECRET;
  process.env.LOGIN_RATE_LIMIT_MAX = '100';
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  await admin.tenant.create({ data: { id: 't-op', slug: 'ops', name: 'Operator' } });
  await admin.tenant.create({ data: { id: 't-def', slug: 'default-tenant', name: 'Default' } });
  await admin.tenant.create({ data: { id: 't-a', slug: 'alpha', name: 'Alpha' } });
  await admin.tenant.create({ data: { id: 't-b', slug: 'beta', name: 'Beta' } });
  await admin.tenant.create({
    data: {
      id: 't-gone',
      slug: 'gone',
      name: 'Gone',
      status: 'ARCHIVED',
      customDomain: 'learn.gone.edu',
      customDomainVerifiedAt: new Date(),
    },
  });
  const user = (id: string, tenantId: string, email: string, role: string) =>
    admin.user.create({
      data: {
        id,
        tenantId,
        email,
        firstName: 'A',
        lastName: 'B',
        role: role as any,
        passwordHash: bcrypt.hashSync(PASSWORD, 4),
        emailVerified: true,
      },
    });
  await user('operator', 't-op', 'operator@x.edu', 'SUPER_ADMIN');
  await user('a-admin', 't-a', 'admin@alpha.edu', 'TENANT_ADMIN');
  await user('a-super', 't-a', 'super@alpha.edu', 'SUPER_ADMIN');
  await user('a-student', 't-a', 'student@alpha.edu', 'STUDENT');
  await user('b-admin', 't-b', 'admin@beta.edu', 'TENANT_ADMIN');
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
  const mailer = await import('../src/lib/mailer.js');
  mailer.setMailer({ async send() {} });
  const { setDnsResolver } = await import('../src/lib/custom-domain.js');
  const answer = <T>(v: T[] | string | undefined): Promise<T[]> =>
    typeof v === 'string' ? Promise.reject(dnsError(v)) : v ? Promise.resolve(v) : Promise.reject(dnsError('ENOTFOUND'));
  setDnsResolver({
    resolveTxt: (name) =>
      answer(typeof txt[name] === 'string' ? (txt[name] as string) : (txt[name] as string[] | undefined)?.map((v) => [v])),
    resolveCname: (name) => answer(cnames[name]),
    resolve4: () => Promise.reject(dnsError('ENODATA')),
    resolve6: () => Promise.reject(dnsError('ENODATA')),
  });
}, 240_000);

afterAll(async () => {
  await admin?.$disconnect();
  await db?.stop();
}, 60_000);

beforeEach(() => {
  txt = {};
  cnames = {};
});

async function signIn(tenant: string, email: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').set('x-tenant-id', tenant).send({ email, password: PASSWORD });
  expect(res.status, email).toBe(200);
  return agent;
}
const orgAt = (host: string) => request(app).get('/api/v1/tenant/config').set('Host', host);
const ask = (domain: string, secret: string | null = TLS_SECRET) => {
  const r = request(app).get('/internal/tls/allowed').query({ domain });
  return secret ? r.set('X-TLS-Ask-Secret', secret) : r;
};
const audits = (tenantId: string, action: string) => admin.auditLog.findMany({ where: { tenantId, action } });

describe('an administrator verifying the organisation domain', () => {
  let a: request.Agent;
  beforeAll(async () => {
    a = await signIn('alpha', 'admin@alpha.edu');
  });

  it('asks for a domain: it waits for its TXT record and does not resolve', async () => {
    const res = await a.put('/api/v1/admin/custom-domain').send({ domain: 'Learn.Alpha.edu' });
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d).toMatchObject({
      subdomain: 'alpha.lms.test',
      customDomain: null,
      target: 'edge.platform-example.com',
      pending: { domain: 'learn.alpha.edu', txtName: '_lms-verify.learn.alpha.edu' },
    });
    expect(d.pending.txtValue).toMatch(/^lms-verify=[0-9a-f]{32}$/);
    // Asking again keeps the token (the record may already be published).
    const again = await a.put('/api/v1/admin/custom-domain').send({ domain: 'learn.alpha.edu' });
    expect(again.body.data.pending.txtValue).toBe(d.pending.txtValue);
    expect((await orgAt('learn.alpha.edu')).body.slug).not.toBe('alpha');
    expect(await ask('learn.alpha.edu').then((r) => r.status)).toBe(404);
    expect(await audits('t-a', 'CUSTOM_DOMAIN_REQUESTED')).toHaveLength(1);
  });

  it('keeps waiting, with the reason, while the TXT record is missing or wrong', async () => {
    const missing = await a.post('/api/v1/admin/custom-domain/verify');
    expect(missing.status).toBe(200);
    expect(missing.body.data.check).toMatchObject({ verified: false, domain: 'learn.alpha.edu' });
    expect(missing.body.data.check.error).toMatch(/No TXT record found at _lms-verify\.learn\.alpha\.edu/);

    txt['_lms-verify.learn.alpha.edu'] = ['lms-verify=not-the-token', 'v=spf1 -all'];
    const wrong = await a.post('/api/v1/admin/custom-domain/verify');
    expect(wrong.body.data.check.verified).toBe(false);
    expect(wrong.body.data.check.error).toMatch(/different value/);
    expect(wrong.body.data.pending.error).toMatch(/different value/);
    expect(wrong.body.data.pending.checkedAt).toBeTruthy();
    expect(wrong.body.data.customDomain).toBeNull();

    txt['_lms-verify.learn.alpha.edu'] = 'ETIMEOUT';
    expect((await a.post('/api/v1/admin/custom-domain/verify')).body.data.check.error).toMatch(/timed out/);
    expect((await orgAt('learn.alpha.edu')).body.slug).not.toBe('alpha');
  });

  it('makes the domain live once the TXT record matches', async () => {
    const state = (await a.get('/api/v1/admin/custom-domain')).body.data;
    txt['_lms-verify.learn.alpha.edu'] = ['something else', state.pending.txtValue];
    cnames['learn.alpha.edu'] = ['edge.platform-example.com.'];
    const res = await a.post('/api/v1/admin/custom-domain/verify');
    expect(res.status).toBe(200);
    expect(res.body.data.check).toMatchObject({
      verified: true,
      error: null,
      routing: { target: 'edge.platform-example.com', pointsAtPlatform: true },
    });
    expect(res.body.data).toMatchObject({ customDomain: 'learn.alpha.edu', pending: null });
    expect(res.body.data.verifiedAt).toBeTruthy();
    expect((await orgAt('learn.alpha.edu')).body.slug).toBe('alpha');
    expect((await ask('learn.alpha.edu')).status).toBe(200);
    expect(await audits('t-a', 'CUSTOM_DOMAIN_VERIFIED')).toHaveLength(1);
    // Nothing waits any more.
    expect((await a.post('/api/v1/admin/custom-domain/verify')).status).toBe(409);
  });

  it('keeps the old domain live until the new one verifies', async () => {
    const asked = await a.put('/api/v1/admin/custom-domain').send({ domain: 'courses.alpha.edu' });
    expect(asked.body.data).toMatchObject({ customDomain: 'learn.alpha.edu', pending: { domain: 'courses.alpha.edu' } });
    expect((await a.post('/api/v1/admin/custom-domain/verify')).body.data.check.verified).toBe(false);
    expect((await orgAt('learn.alpha.edu')).body.slug).toBe('alpha');
    expect((await orgAt('courses.alpha.edu')).body.slug).not.toBe('alpha');

    txt['_lms-verify.courses.alpha.edu'] = [asked.body.data.pending.txtValue];
    const res = await a.post('/api/v1/admin/custom-domain/verify');
    expect(res.body.data).toMatchObject({
      customDomain: 'courses.alpha.edu',
      pending: null,
      check: { verified: true, routing: { pointsAtPlatform: false } },
    });
    expect((await orgAt('courses.alpha.edu')).body.slug).toBe('alpha');
    expect((await orgAt('learn.alpha.edu')).body.slug).not.toBe('alpha');
    expect((await ask('learn.alpha.edu')).status).toBe(404);
  });

  it('withdraws the domain waiting, then the live one', async () => {
    await a.put('/api/v1/admin/custom-domain').send({ domain: 'next.alpha.edu' });
    const cancelled = await a.delete('/api/v1/admin/custom-domain?scope=pending');
    expect(cancelled.body.data).toMatchObject({ customDomain: 'courses.alpha.edu', pending: null });
    expect(await audits('t-a', 'CUSTOM_DOMAIN_REQUEST_CANCELLED')).toHaveLength(1);

    const removed = await a.delete('/api/v1/admin/custom-domain');
    expect(removed.status).toBe(200);
    expect(removed.body.data).toMatchObject({ customDomain: null, verifiedAt: null, pending: null });
    expect((await orgAt('courses.alpha.edu')).body.slug).not.toBe('alpha');
    expect(await audits('t-a', 'CUSTOM_DOMAIN_REMOVED')).toHaveLength(1);
  });

  it('lets the super administrator of the organisation do the same, and nobody else in it', async () => {
    const s = await signIn('alpha', 'super@alpha.edu');
    expect((await s.get('/api/v1/admin/custom-domain')).status).toBe(200);
    const student = await signIn('alpha', 'student@alpha.edu');
    expect((await student.get('/api/v1/admin/custom-domain')).status).toBe(403);
    expect((await student.put('/api/v1/admin/custom-domain').send({ domain: 'learn.alpha.edu' })).status).toBe(403);
  });

  it('refuses platform domains and malformed names', async () => {
    for (const domain of ['beta.lms.test', 'lms.test', 'edge', 'learn_alpha.edu', '-x.alpha.edu']) {
      expect((await a.put('/api/v1/admin/custom-domain').send({ domain })).status, domain).toBe(400);
    }
  });
});

describe('other organisations and the platform operator', () => {
  it("keeps another organisation's administrator away from a domain in use or being verified", async () => {
    const a = await signIn('alpha', 'admin@alpha.edu');
    const b = await signIn('beta', 'admin@beta.edu');
    const asked = await a.put('/api/v1/admin/custom-domain').send({ domain: 'shared.alpha.edu' });
    expect((await b.put('/api/v1/admin/custom-domain').send({ domain: 'shared.alpha.edu' })).status).toBe(409);
    txt['_lms-verify.shared.alpha.edu'] = [asked.body.data.pending.txtValue];
    expect((await a.post('/api/v1/admin/custom-domain/verify')).body.data.check.verified).toBe(true);
    expect((await b.put('/api/v1/admin/custom-domain').send({ domain: 'shared.alpha.edu' })).status).toBe(409);
    // Beta's own calls only ever touch Beta; the operator's routes are not for it.
    expect((await b.delete('/api/v1/admin/custom-domain')).body.data.customDomain).toBeNull();
    expect((await orgAt('shared.alpha.edu')).body.slug).toBe('alpha');
    expect((await b.get('/api/v1/operator/tenants/t-a/custom-domain')).status).toBe(403);
    expect((await b.delete('/api/v1/operator/tenants/t-a/custom-domain')).status).toBe(403);
  });

  it('lets a week-old unverified request go when another organisation asks', async () => {
    const a = await signIn('alpha', 'admin@alpha.edu');
    const b = await signIn('beta', 'admin@beta.edu');
    await a.put('/api/v1/admin/custom-domain').send({ domain: 'squat.example.org' });
    await admin.tenant.update({ where: { id: 't-a' }, data: { customDomainRequestedAt: new Date(Date.now() - 8 * 24 * 3600_000) } });
    const res = await b.put('/api/v1/admin/custom-domain').send({ domain: 'squat.example.org' });
    expect(res.status).toBe(200);
    expect(res.body.data.pending.domain).toBe('squat.example.org');
    expect((await a.get('/api/v1/admin/custom-domain')).body.data).toMatchObject({ customDomain: 'shared.alpha.edu', pending: null });
    expect(await audits('t-a', 'CUSTOM_DOMAIN_REQUEST_LAPSED')).toHaveLength(1);
    await b.delete('/api/v1/admin/custom-domain?scope=pending');
  });

  it('lets the operator set, verify and remove any organisation domain, audited in both trails', async () => {
    const op = await signIn('ops', 'operator@x.edu');
    const asked = await op.put('/api/v1/operator/tenants/t-b/custom-domain').send({ domain: 'learn.beta.edu' });
    expect(asked.status).toBe(200);
    expect(asked.body.data.pending.domain).toBe('learn.beta.edu');
    const listed = (await op.get('/api/v1/operator/tenants')).body.data.find((t: any) => t.id === 't-b');
    expect(listed).toMatchObject({ customDomain: null, pendingCustomDomain: 'learn.beta.edu' });

    txt['_lms-verify.learn.beta.edu'] = [asked.body.data.pending.txtValue];
    const verified = await op.post('/api/v1/operator/tenants/t-b/custom-domain/verify');
    expect(verified.body.data).toMatchObject({ customDomain: 'learn.beta.edu', check: { verified: true } });
    expect((await orgAt('learn.beta.edu')).body.slug).toBe('beta');
    expect(await audits('t-op', 'CUSTOM_DOMAIN_VERIFIED')).toHaveLength(1);
    expect((await audits('t-b', 'CUSTOM_DOMAIN_VERIFIED'))[0]).toMatchObject({ userId: null });

    expect((await op.get('/api/v1/operator/tenants/t-b/custom-domain')).body.data.customDomain).toBe('learn.beta.edu');
    expect((await op.delete('/api/v1/operator/tenants/t-b/custom-domain')).body.data.customDomain).toBeNull();
    expect((await op.get('/api/v1/operator/tenants/nope/custom-domain')).status).toBe(404);
  });

  it('creates an organisation with its custom domain waiting, not live', async () => {
    const op = await signIn('ops', 'operator@x.edu');
    const res = await op.post('/api/v1/operator/tenants').send({
      name: 'Gamma',
      slug: 'gamma',
      customDomain: 'learn.gamma.edu',
      adminFirstName: 'G',
      adminLastName: 'H',
      adminEmail: 'g@gamma.edu',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.organization).toMatchObject({ customDomain: null, pendingCustomDomain: 'learn.gamma.edu' });
    expect((await orgAt('learn.gamma.edu')).body.slug).not.toBe('gamma');
    const state = (await op.get(`/api/v1/operator/tenants/${res.body.data.organization.id}/custom-domain`)).body.data;
    expect(state.pending.txtValue).toMatch(/^lms-verify=/);
  });
});

describe('the TLS ask check', () => {
  it('needs the shared secret', async () => {
    expect((await ask('alpha.lms.test', null)).status).toBe(403);
    expect((await ask('alpha.lms.test', 'wrong-secret-value')).status).toBe(403);
    expect((await request(app).get('/internal/tls/allowed').query({ domain: 'alpha.lms.test', secret: TLS_SECRET })).status).toBe(200);
    expect((await request(app).get('/internal/tls/allowed').set('X-TLS-Ask-Secret', TLS_SECRET)).status).toBe(400);
  });

  it('allows live custom domains and the subdomains of organisations, and nothing else', async () => {
    expect((await ask('shared.alpha.edu')).status).toBe(200);
    expect((await ask('SHARED.alpha.edu.')).status).toBe(200);
    expect((await ask('alpha.lms.test')).status).toBe(200);
    expect((await ask('nobody.lms.test')).status).toBe(404);
    expect((await ask('a.b.lms.test')).status).toBe(404);
    expect((await ask('lms.test')).status).toBe(404);
    expect((await ask('learn.gamma.edu')).status).toBe(404); // pending
    expect((await ask('learn.gone.edu')).status).toBe(404); // archived organisation
    expect((await ask('gone.lms.test')).status).toBe(404);
    expect((await ask('random.example.com')).status).toBe(404);
  });
});
