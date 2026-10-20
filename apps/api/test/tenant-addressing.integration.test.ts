import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// How a request's host names an organisation under TENANT_BASE_DOMAIN, and which addresses and custom domains
// an organisation may not have: reserved and punycode slugs, the platform's own hosts, and addresses under the
// base domain that belong to other organisations. Real PostgreSQL and RLS.

const PASSWORD = 'CorrectHorse1!';
let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;

beforeAll(async () => {
  process.env.PLATFORM_OPERATOR_TENANT = 'ops';
  process.env.ORG_REQUEST_RATE_LIMIT_MAX = '100';
  process.env.DEFAULT_TENANT_SLUG = 'default-tenant';
  process.env.TENANT_BASE_DOMAIN = 'lms.test';
  process.env.TRUST_PROXY = '1';
  // Service hosts: two under the base domain (their labels become reserved), one outside it.
  process.env.SCORM_CONTENT_ORIGIN = 'https://scorm-cdn.lms.test';
  process.env.LIVEKIT_URL = 'wss://rtc.lms.test';
  process.env.API_PUBLIC_URL = 'https://api.platform-example.com';
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  await admin.tenant.create({ data: { id: 't-op', slug: 'ops', name: 'Operator' } });
  await admin.tenant.create({ data: { id: 't-def', slug: 'default-tenant', name: 'Default' } });
  await admin.tenant.create({ data: { id: 't-h', slug: 'harvard', name: 'Harvard', customDomain: 'learn.harvard.edu' } });
  // Saved before validation existed: a custom domain that is another organisation's subdomain.
  await admin.tenant.create({ data: { id: 't-evil', slug: 'evil-college', name: 'Evil', customDomain: 'harvard.lms.test' } });
  await admin.user.create({
    data: { id: 'operator', tenantId: 't-op', email: 'operator@x.edu', firstName: 'Op', lastName: 'L', role: 'SUPER_ADMIN', passwordHash: bcrypt.hashSync(PASSWORD, 4), emailVerified: true },
  });
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
  const mailer = await import('../src/lib/mailer.js');
  mailer.setMailer({ async send() {} });
}, 240_000);

afterAll(async () => {
  await admin?.$disconnect();
  await db?.stop();
}, 60_000);

const availability = async (slug: string) => (await request(app).get(`/api/v1/organizations/availability?slug=${encodeURIComponent(slug)}`)).body.data;
const ask = (slug: string) =>
  request(app).post('/api/v1/organizations/requests').send({
    organizationName: `College ${slug}`, slug, institutionType: 'COLLEGE', contactFirstName: 'Ann', contactLastName: 'Lee', contactEmail: `ann@${slug.replace(/[^a-z0-9]/g, '')}.edu`, acceptTerms: true,
  });
const orgAt = (host: string) => request(app).get('/api/v1/tenant/config').set('Host', host);

describe('organisation addresses', () => {
  it('refuses reserved, service and punycode slugs', async () => {
    for (const slug of ['auth', 'sso', 'scorm', 'autodiscover', 'billing', 'staging', 'www', 'api']) {
      expect(await availability(slug), slug).toMatchObject({ available: false, reason: 'reserved' });
    }
    // The first label of configured service hosts under the base domain.
    expect(await availability('scorm-cdn')).toMatchObject({ available: false, reason: 'reserved' });
    expect(await availability('rtc')).toMatchObject({ available: false, reason: 'reserved' });
    for (const slug of ['xn--80ak6aa92e', 'xn--abc', 'ab--cd']) {
      expect(await availability(slug), slug).toMatchObject({ available: false, reason: 'invalid' });
    }
    expect(await availability('a-b--c')).toMatchObject({ available: true }); // "--" elsewhere is fine
  });

  it('refuses the same slugs on a registration request', async () => {
    expect((await ask('autodiscover')).status).toBe(409);
    expect((await ask('scorm-cdn')).status).toBe(409);
    expect((await ask('xn--80ak6aa92e')).status).toBe(400);
    expect(await admin.organizationRequest.count({ where: { slug: { in: ['autodiscover', 'scorm-cdn', 'xn--80ak6aa92e'] } } })).toBe(0);
  });
});

describe('custom domains', () => {
  async function operator() {
    const agent = request.agent(app);
    const res = await agent.post('/api/v1/auth/login').set('x-tenant-id', 'ops').send({ email: 'operator@x.edu', password: PASSWORD });
    expect(res.status).toBe(200);
    return agent;
  }
  const create = (op: request.Agent, slug: string, customDomain: string) =>
    op.post('/api/v1/operator/tenants').send({ name: `Org ${slug}`, slug, customDomain, adminFirstName: 'Bo', adminLastName: 'Ray', adminEmail: `bo@${slug}.edu` });

  it('refuses the base domain, addresses under it and the platform hosts', async () => {
    const op = await operator();
    for (const [slug, domain] of [['grab-one', 'harvard.lms.test'], ['grab-two', 'lms.test'], ['grab-three', 'deep.harvard.lms.test'], ['grab-four', 'api.platform-example.com']]) {
      const res = await create(op, slug, domain);
      expect(res.status, domain).toBe(400);
    }
    expect(await admin.tenant.count({ where: { slug: { startsWith: 'grab-' } } })).toBe(0);
    expect((await create(op, 'own-domain', 'learn.own-domain.edu')).status).toBe(201);
  });

  it('never lets a custom domain under the base domain take over a subdomain', async () => {
    // t-evil holds harvard.lms.test as its custom domain, but that host names Harvard by its subdomain.
    expect((await orgAt('harvard.lms.test')).body.slug).toBe('harvard');
    expect((await orgAt('learn.harvard.edu')).body.slug).toBe('harvard'); // a real custom domain still works
  });
});

describe('resolving the host', () => {
  it('does not send an unknown subdomain to the default organisation', async () => {
    expect((await orgAt('nobody-here.lms.test')).status).toBe(404);
    expect((await orgAt('a.b.lms.test')).status).toBe(404);
    const login = await request(app).post('/api/v1/auth/login').set('Host', 'nobody-here.lms.test').send({ email: 'operator@x.edu', password: PASSWORD });
    expect(login.status).toBe(401);
  });

  it('keeps the default organisation on the base domain and other hosts', async () => {
    expect((await orgAt('lms.test')).body.slug).toBe('default-tenant');
    expect((await orgAt('localhost:4000')).body.slug).toBe('default-tenant');
  });

  it('lets the x-tenant-id header win over the host', async () => {
    expect((await orgAt('nobody-here.lms.test').set('x-tenant-id', 'harvard')).body.slug).toBe('harvard');
    expect((await orgAt('harvard.lms.test').set('x-tenant-id', 'ops')).body.slug).toBe('ops');
  });

  it('believes the rightmost X-Forwarded-Host value, the one the trusted proxy added', async () => {
    const via = (forwarded: string) => request(app).get('/api/v1/tenant/config').set('Host', 'localhost:4000').set('x-forwarded-host', forwarded);
    expect((await via('harvard.lms.test')).body.slug).toBe('harvard');
    expect((await via('harvard.lms.test, nobody-here.lms.test')).status).toBe(404);
    expect((await via('nobody-here.lms.test, harvard.lms.test')).body.slug).toBe('harvard');
  });
});
