import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import http from 'http';
import jwt from 'jsonwebtoken';
import { SignedXml } from 'xml-crypto';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// Contract test: every identity/integration operation described in openapi/responses/identity.ts is
// called for real (mock OIDC provider, signed SAML responses, LTI platform key set, SCIM token,
// signed provider callbacks) and its answer is checked against the described status, content type
// and schema.

const PASSWORD = 'CorrectHorse1!';
const APP = 'http://localhost:3000';
const pw = (slug: string) => `${PASSWORD}-${slug}`;

// ---- secrets for the signed callbacks (set before the app loads)
const PLAG_SECRET = 'plagiarism-secret-'.padEnd(40, 'x');
const LK_KEY = 'APIkeyForTests';
const LK_SECRET = 'live-secret-'.padEnd(48, 'x');

// ---- OIDC provider
const CLIENT_ID = 'lms-client';
const CLIENT_SECRET = 'super-secret-value';
const idpKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
let idp: http.Server;
let ISSUER: string;
const grants = new Map<string, { claims: Record<string, unknown>; challenge: string; nonce: string }>();

// ---- SAML provider
const IDP = 'https://idp.example.org/metadata';
const ENTRY = 'https://idp.example.org/sso';
const ACS = `${APP}/api/v1/auth/saml/acs`;
const SP = `${APP}/api/v1/auth/saml/metadata/harvard`;
const samlKeys = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

// ---- LTI platform
const ltiKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const CLAIM = 'https://purl.imsglobal.org/spec/lti/claim';
let jwksServer: http.Server;

let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;
let R: typeof import('../src/openapi/responses/identity.js');
let signCallback: typeof import('../src/routes/integrations.routes.js').signCallback;

function startIdp() {
  idp = http.createServer((req, res) => {
    const url = new URL(req.url!, ISSUER);
    const json = (b: unknown, status = 200) => {
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(b));
    };
    if (url.pathname === '/.well-known/openid-configuration')
      return json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        jwks_uri: `${ISSUER}/jwks`,
      });
    if (url.pathname === '/jwks')
      return json({ keys: [{ ...idpKey.publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' }] });
    if (url.pathname === '/token' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const f = new URLSearchParams(body);
        const grant = grants.get(f.get('code') ?? '');
        grants.delete(f.get('code') ?? '');
        const ok =
          grant &&
          crypto
            .createHash('sha256')
            .update(f.get('code_verifier') ?? '')
            .digest('base64url') === grant.challenge &&
          f.get('client_secret') === CLIENT_SECRET;
        if (!grant || !ok) return json({ error: 'invalid_grant' }, 400);
        const id_token = jwt.sign({ iss: ISSUER, aud: CLIENT_ID, nonce: grant.nonce, ...grant.claims }, idpKey.privateKey, {
          algorithm: 'RS256',
          keyid: 'k1',
          expiresIn: 300,
        });
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

async function seed(jwksUrl: string) {
  await admin.tenant.create({ data: { id: 't-h', slug: 'harvard', name: 'Harvard', tier: 'ENTERPRISE' } });
  await admin.tenant.create({ data: { id: 't-m', slug: 'mit', name: 'MIT', tier: 'STARTER' } });
  // Suspended tenants never resolve; an unknown hint would fall through to the default tenant instead.
  await admin.tenant.create({ data: { id: 't-s', slug: 'suspended', name: 'Gone', tier: 'STARTER', status: 'SUSPENDED' } });
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
  for (const s of ['s1', 's2', 's4']) await user(s, 't-h', 'harvard', 'STUDENT');
  await user('unver', 't-h', 'harvard', 'STUDENT', { emailVerified: false });

  await admin.course.create({ data: { id: 'c1', tenantId: 't-h', code: 'C1', title: 'Course c1', status: 'PUBLISHED' } });
  await admin.courseInstructor.create({ data: { courseId: 'c1', userId: 'teacher', isPrimary: true } });
  await admin.assignment.create({
    data: { id: 'a1', tenantId: 't-h', courseId: 'c1', title: 'Essay', instructions: 'Write', maxPoints: 100 },
  });
  await admin.assignmentSubmission.create({ data: { id: 'as-1', assignmentId: 'a1', userId: 's1', submissionText: 'x' } });
  await admin.liveSession.create({
    data: {
      id: 'ls-1',
      tenantId: 't-h',
      courseId: 'c1',
      createdById: 'teacher',
      title: 'Live',
      scheduledAt: new Date(),
      roomName: 'lms_t-h_ls-1',
    },
  });
  await admin.ltiDeployment.create({
    data: {
      tenantId: 't-h',
      clientId: 'client-1',
      deploymentId: 'dep-1',
      issuer: 'https://platform.example.edu',
      authLoginUrl: 'https://p/login',
      authTokensUrl: 'https://p/token',
      keySetUrl: jwksUrl,
    },
  });
}

beforeAll(async () => {
  await startIdp();
  const jwk = { ...ltiKeys.publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' };
  jwksServer = http.createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((r) => jwksServer.listen(0, '127.0.0.1', r));
  const jwksUrl = `http://127.0.0.1:${(jwksServer.address() as any).port}/jwks`;

  process.env.PLAGIARISM_WEBHOOK_SECRET = PLAG_SECRET;
  process.env.LIVEKIT_URL = 'wss://live.example.org';
  process.env.LIVEKIT_API_KEY = LK_KEY;
  process.env.LIVEKIT_API_SECRET = LK_SECRET;
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  await seed(jwksUrl);
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
  ({ signCallback } = await import('../src/routes/integrations.routes.js'));
  R = await import('../src/openapi/responses/identity.js');
}, 240_000);

afterAll(async () => {
  await new Promise<void>((r) => idp?.close(() => r()));
  await new Promise<void>((r) => jwksServer?.close(() => r()));
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
 * Looks the answer up in the described table: the status must be described (as the success answer,
 * another success answer, or a declared error), the content type must match, and where a schema is
 * described the body must satisfy it.
 */
function conforms(key: string, res: request.Response, opts: { json?: boolean } = {}) {
  const entry = R.RESPONSES[key];
  expect(entry, `${key} is described`).toBeTruthy();
  const docs = [entry.response, ...(entry.otherResponses ?? [])].filter((d): d is NonNullable<typeof d> => !!d);
  const doc = docs.find((d) => d.status === res.status);
  if (!doc) {
    // An error: declared in `errors` (401/403 are implied for guarded routes, 429 for limiters).
    expect([401, 403, 429], `${key} answered ${res.status}: ${res.text}`).toSatisfy(
      (implied: number[]) => (entry.errors ?? []).includes(res.status) || implied.includes(res.status)
    );
    return;
  }
  if (doc.contentType) expect(String(res.headers['content-type'])).toContain(doc.contentType);
  if (doc.schema) {
    const body =
      opts.json === false
        ? res.text
        : doc.contentType && doc.contentType !== 'application/json' && doc.contentType.includes('json')
          ? JSON.parse(res.text)
          : res.body;
    const parsed = doc.schema.safeParse(body);
    expect(
      parsed.success,
      `${key} ${res.status}: ${JSON.stringify(parsed.success ? null : parsed.error)} body=${JSON.stringify(body)}`
    ).toBe(true);
  }
}

const redirectTo = (res: request.Response, status: number, location: string | RegExp) => {
  expect(res.status).toBe(status);
  if (typeof location === 'string') expect(res.headers.location).toBe(location);
  else expect(res.headers.location).toMatch(location);
};

// ---------------------------------------------------------------------------
describe('server and tenant', () => {
  it('GET /health', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    conforms('GET /health', res);
  });

  it('GET /ready', async () => {
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    conforms('GET /ready', res);
    expect(R.RESPONSES['GET /ready'].otherResponses?.[0].status).toBe(503); // 503 described from source: needs a database outage
  });

  it('GET /api/v1/tenant/config', async () => {
    const res = await request(app).get('/api/v1/tenant/config').set('x-tenant-id', 'harvard');
    expect(res.status).toBe(200);
    conforms('GET /api/v1/tenant/config', res);
    expect(res.body.features.sso).toBe(true);
    // A suspended organisation says so, so its login page can tell visitors why nobody can sign in.
    const suspended = await request(app).get('/api/v1/tenant/config').set('x-tenant-id', 'suspended');
    expect(suspended.status).toBe(403);
    expect(suspended.body.code).toBe('TENANT_SUSPENDED');
    conforms('GET /api/v1/tenant/config', suspended);
  });

  it('GET /api/v1/openapi.json', async () => {
    const res = await request(app).get('/api/v1/openapi.json');
    expect(res.status).toBe(200);
    conforms('GET /api/v1/openapi.json', res);
  });
});

// ---------------------------------------------------------------------------
describe('POST /api/v1/auth/resend-verification', () => {
  it('sends a link to an unverified user, and says so when already verified', async () => {
    const a = await as('unver');
    const sent = await a.post('/api/v1/auth/resend-verification');
    expect(sent.status).toBe(200);
    expect(sent.body.message).toBe('Verification email sent');
    conforms('POST /api/v1/auth/resend-verification', sent);
    const done = await (await as('s1')).post('/api/v1/auth/resend-verification');
    expect(done.body.message).toBe('Email is already verified');
    conforms('POST /api/v1/auth/resend-verification', done);
    const anon = await request(app).post('/api/v1/auth/resend-verification');
    expect(anon.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe('OIDC single sign-on', () => {
  it('GET /sso/status and /sso/start before configuration', async () => {
    const status = await request(app).get('/api/v1/auth/sso/status').set('x-tenant-id', 'harvard');
    expect(status.body).toEqual({ enabled: false, oidc: false, saml: false });
    conforms('GET /api/v1/auth/sso/status', status);
    const none = await request(app).get('/api/v1/auth/sso/status').set('x-tenant-id', 'suspended');
    expect(none.body).toEqual({ enabled: false });
    conforms('GET /api/v1/auth/sso/status', none);
    const start = await request(app).get('/api/v1/auth/sso/start').set('x-tenant-id', 'harvard');
    redirectTo(start, 302, `${APP}/login?error=sso_unavailable`);
  });

  it('configures, starts, and completes a sign-in', async () => {
    const put = await (
      await as('admin')
    )
      .put('/api/v1/admin/sso')
      .send({ issuer: ISSUER, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, enabled: true, allowedDomains: [] });
    expect(put.status).toBe(200);

    const status = await request(app).get('/api/v1/auth/sso/status').set('x-tenant-id', 'harvard');
    expect(status.body).toEqual({ enabled: true, oidc: true, saml: false });
    conforms('GET /api/v1/auth/sso/status', status);

    const agent = request.agent(app);
    const start = await agent.get('/api/v1/auth/sso/start').set('x-tenant-id', 'harvard');
    redirectTo(start, 302, new RegExp(`^${ISSUER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/authorize\\?`));
    expect(String(start.headers['set-cookie'])).toContain('lms_sso=');
    const q = new URL(start.headers.location).searchParams;
    grants.set('good-code', {
      claims: { sub: 'sub-s1', email: 's1@x.edu', email_verified: true },
      challenge: q.get('code_challenge')!,
      nonce: q.get('nonce')!,
    });
    const cb = await agent.get(`/api/v1/auth/sso/callback?code=good-code&state=${q.get('state')}`).set('x-tenant-id', 'harvard');
    redirectTo(cb, 302, `${APP}/`);
    expect(String(cb.headers['set-cookie'])).toContain('lms_token=');
  });

  it('GET /sso/callback refuses a forged state', async () => {
    const agent = request.agent(app);
    const start = await agent.get('/api/v1/auth/sso/start').set('x-tenant-id', 'harvard');
    expect(start.status).toBe(302);
    const cb = await agent.get('/api/v1/auth/sso/callback?code=x&state=forged').set('x-tenant-id', 'harvard');
    redirectTo(cb, 302, `${APP}/login?error=sso_failed`);
    const noCookie = await request(app).get('/api/v1/auth/sso/callback?code=x&state=y');
    redirectTo(noCookie, 302, `${APP}/login?error=sso_failed`);
  });
});

// ---------------------------------------------------------------------------
describe('SAML single sign-on', () => {
  const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
  const assertion = (inResponseTo: string, email: string) =>
    `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_a${crypto.randomBytes(8).toString('hex')}" Version="2.0" IssueInstant="${iso(0)}">` +
    `<saml:Issuer>${IDP}</saml:Issuer>` +
    `<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:2.0:nameid-format:persistent">nid-contract</saml:NameID>` +
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="${iso(300_000)}" Recipient="${ACS}" InResponseTo="${inResponseTo}"/></saml:SubjectConfirmation></saml:Subject>` +
    `<saml:Conditions NotBefore="${iso(-60_000)}" NotOnOrAfter="${iso(300_000)}"><saml:AudienceRestriction><saml:Audience>${SP}</saml:Audience></saml:AudienceRestriction></saml:Conditions>` +
    `<saml:AuthnStatement AuthnInstant="${iso(-1000)}" SessionIndex="_s1"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:Password</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>` +
    `<saml:AttributeStatement><saml:Attribute Name="email"><saml:AttributeValue>${email}</saml:AttributeValue></saml:Attribute></saml:AttributeStatement>` +
    `</saml:Assertion>`;
  const sign = (xml: string) => {
    const sig = new SignedXml({
      privateKey: samlKeys.privateKey,
      canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
      signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    });
    sig.addReference({
      xpath: "//*[local-name(.)='Assertion']",
      digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
      transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'],
    });
    sig.computeSignature(xml, { location: { reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']", action: 'after' } });
    return sig.getSignedXml();
  };
  const response = (inResponseTo: string, email: string) =>
    Buffer.from(
      `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r${crypto.randomBytes(8).toString('hex')}" Version="2.0" IssueInstant="${iso(0)}" Destination="${ACS}" InResponseTo="${inResponseTo}">` +
        `<saml:Issuer>${IDP}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>${sign(assertion(inResponseTo, email))}</samlp:Response>`
    ).toString('base64');

  it('GET /saml/metadata/:slug is 404 until SAML is configured, then XML', async () => {
    const before = await request(app).get('/api/v1/auth/saml/metadata/harvard');
    expect(before.status).toBe(404);
    conforms('GET /api/v1/auth/saml/metadata/:slug', before);
    const put = await (
      await as('admin')
    )
      .put('/api/v1/admin/saml')
      .send({ entryPoint: ENTRY, idpIssuer: IDP, idpCert: samlKeys.publicKey, emailAttribute: 'email', enabled: true, allowedDomains: [] });
    expect(put.status).toBe(200);
    const meta = await request(app).get('/api/v1/auth/saml/metadata/harvard');
    expect(meta.status).toBe(200);
    expect(meta.headers['content-type']).toMatch(/samlmetadata\+xml/);
    expect(meta.text).toContain(`entityID="${SP}"`);
    conforms('GET /api/v1/auth/saml/metadata/:slug', meta, { json: false });
  });

  it('GET /saml/start redirects to the IdP, POST /saml/acs signs in or refuses', async () => {
    const agent = request.agent(app);
    const start = await agent.get('/api/v1/auth/saml/start').set('x-tenant-id', 'harvard');
    redirectTo(start, 302, new RegExp(`^${ENTRY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\?SAMLRequest=`));
    expect(String(start.headers['set-cookie'])).toContain('lms_saml=');

    const { inflateRawSync } = await import('zlib');
    const xml = inflateRawSync(Buffer.from(new URL(start.headers.location).searchParams.get('SAMLRequest')!, 'base64')).toString();
    const id = /ID="([^"]+)"/.exec(xml)![1];
    const acs = await agent
      .post('/api/v1/auth/saml/acs')
      .set('x-tenant-id', 'harvard')
      .type('form')
      .send({ SAMLResponse: response(id, 's2@x.edu'), RelayState: '' });
    redirectTo(acs, 303, `${APP}/`);
    expect(String(acs.headers['set-cookie'])).toContain('lms_token=');

    const refused = await request(app).post('/api/v1/auth/saml/acs').type('form').send({ SAMLResponse: 'AAAA' });
    redirectTo(refused, 303, `${APP}/login?error=sso_failed`);
    const unavailable = await request(app).get('/api/v1/auth/saml/start').set('x-tenant-id', 'mit');
    redirectTo(unavailable, 302, `${APP}/login?error=sso_unavailable`);
  });
});

// ---------------------------------------------------------------------------
describe('LTI 1.3 launch', () => {
  const token = (over: Record<string, unknown> = {}) =>
    jwt.sign(
      {
        iss: 'https://platform.example.edu',
        aud: 'client-1',
        sub: 'u1',
        email: 's4@x.edu',
        nonce: `n-${crypto.randomUUID()}`,
        [`${CLAIM}/version`]: '1.3.0',
        [`${CLAIM}/deployment_id`]: 'dep-1',
        [`${CLAIM}/target_link_uri`]: 'https://lms/courses/c1',
        ...over,
      },
      ltiKeys.privateKey,
      { algorithm: 'RS256', keyid: 'k1', expiresIn: '5m' }
    );
  const launch = (id_token: string, tenant = 'harvard') =>
    request(app).post('/api/v1/lti/launch').set('x-tenant-id', tenant).send({ id_token });

  it('answers 200 with the launch result', async () => {
    const res = await launch(token());
    expect(res.status).toBe(200);
    conforms('POST /api/v1/lti/launch', res);
    expect(String(res.headers['set-cookie'])).toContain('lms_token');
    const noTarget = await launch(token({ [`${CLAIM}/target_link_uri`]: undefined }));
    expect(noTarget.body.targetLinkUri).toBeNull();
    conforms('POST /api/v1/lti/launch', noTarget);
  });

  it('answers the documented errors', async () => {
    for (const [res, status] of [
      [await launch('a.b.c'), 400],
      [await launch(token({ nonce: undefined })), 401],
      [await launch(token({ email: 'nobody@x.edu' })), 403],
      [await launch(token(), 'mit'), 403],
      [await launch(token(), 'suspended'), 404],
    ] as const) {
      expect(res.status).toBe(status);
      conforms('POST /api/v1/lti/launch', res);
    }
  });
});

// ---------------------------------------------------------------------------
describe('SCIM 2.0', () => {
  let tok: string;
  let id: string;
  const scim = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, bearer: string | null = tok) => {
    const r = (request(app) as any)[method](`/api/v1/scim/v2${path}`).set('content-type', 'application/scim+json');
    return bearer ? r.set('authorization', `Bearer ${bearer}`) : r;
  };
  const check = (key: string, res: request.Response) => {
    // supertest does not parse scim+json: the helper parses res.text for these.
    conforms(key, res);
    if (res.status >= 400) {
      const parsed = R.ScimError.safeParse(JSON.parse(res.text));
      expect(parsed.success, `SCIM error body ${res.text}`).toBe(true);
      expect(res.headers['content-type']).toContain('application/scim+json');
    }
  };
  const user = {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    userName: 'New.Person@x.edu',
    externalId: 'okta-123',
    name: { givenName: 'New', familyName: 'Person' },
    active: true,
  };

  beforeAll(async () => {
    const res = await (await as('admin')).post('/api/v1/admin/scim-tokens').send({ label: 'Okta' });
    expect(res.status).toBe(201);
    tok = res.body.data.token;
  });

  it('describes the service provider and rejects bad tokens', async () => {
    const sp = await scim('get', '/ServiceProviderConfig');
    expect(sp.status).toBe(200);
    check('GET /api/v1/scim/v2/ServiceProviderConfig', sp);
    const noToken = await scim('get', '/Users', null);
    expect(noToken.status).toBe(401);
    check('GET /api/v1/scim/v2/Users', noToken);
  });

  it('creates, lists and reads users', async () => {
    const created = await scim('post', '/Users').send(JSON.stringify(user));
    expect(created.status).toBe(201);
    check('POST /api/v1/scim/v2/Users', created);
    id = JSON.parse(created.text).id;
    const dup = await scim('post', '/Users').send(JSON.stringify(user));
    expect(dup.status).toBe(409);
    check('POST /api/v1/scim/v2/Users', dup);
    const bad = await scim('post', '/Users').send(JSON.stringify({ userName: 'nope' }));
    expect(bad.status).toBe(400);
    check('POST /api/v1/scim/v2/Users', bad);

    const list = await scim('get', '/Users?filter=userName eq "new.person@x.edu"');
    expect(list.status).toBe(200);
    check('GET /api/v1/scim/v2/Users', list);
    expect(JSON.parse(list.text).Resources).toHaveLength(1);
    const badFilter = await scim('get', '/Users?filter=name.givenName co "x"');
    expect(badFilter.status).toBe(400);
    check('GET /api/v1/scim/v2/Users', badFilter);

    const one = await scim('get', `/Users/${id}`);
    expect(one.status).toBe(200);
    check('GET /api/v1/scim/v2/Users/:id', one);
    const missing = await scim('get', '/Users/missing');
    expect(missing.status).toBe(404);
    check('GET /api/v1/scim/v2/Users/:id', missing);
  });

  it('replaces, patches and deprovisions', async () => {
    const put = await scim('put', `/Users/${id}`).send(JSON.stringify({ ...user, name: { givenName: 'Newer', familyName: 'Person' } }));
    expect(put.status).toBe(200);
    check('PUT /api/v1/scim/v2/Users/:id', put);
    const rename = await scim('put', `/Users/${id}`).send(JSON.stringify({ userName: 'else@x.edu' }));
    expect(rename.status).toBe(400);
    check('PUT /api/v1/scim/v2/Users/:id', rename);

    const patch = await scim('patch', `/Users/${id}`).send(
      JSON.stringify({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'active', value: false }],
      })
    );
    expect(patch.status).toBe(200);
    check('PATCH /api/v1/scim/v2/Users/:id', patch);
    expect(JSON.parse(patch.text).active).toBe(false);
    const badPatch = await scim('patch', `/Users/${id}`).send(
      JSON.stringify({ Operations: [{ op: 'replace', path: 'role', value: 'SUPER_ADMIN' }] })
    );
    expect(badPatch.status).toBe(400);
    check('PATCH /api/v1/scim/v2/Users/:id', badPatch);
    const protectedPatch = await scim('patch', '/Users/admin').send(
      JSON.stringify({ Operations: [{ op: 'replace', path: 'active', value: false }] })
    );
    expect(protectedPatch.status).toBe(403);
    check('PATCH /api/v1/scim/v2/Users/:id', protectedPatch);

    const del = await scim('delete', `/Users/${id}`);
    expect(del.status).toBe(204);
    expect(del.text).toBe('');
    check('DELETE /api/v1/scim/v2/Users/:id', del);
    const protectedDel = await scim('delete', '/Users/admin');
    expect(protectedDel.status).toBe(403);
    check('DELETE /api/v1/scim/v2/Users/:id', protectedDel);
  });
});

// ---------------------------------------------------------------------------
describe('signed provider callbacks', () => {
  const plag = (body: unknown, over: { slug?: string; secret?: string } = {}) => {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    const ts = String(Math.floor(Date.now() / 1000));
    return request(app)
      .post(`/api/v1/integrations/plagiarism/${over.slug ?? 'harvard'}`)
      .set('content-type', 'application/json')
      .set('x-lms-timestamp', ts)
      .set('x-lms-signature', `sha256=${signCallback(over.secret ?? PLAG_SECRET, ts, raw)}`)
      .send(raw);
  };

  it('POST /integrations/plagiarism/:tenantSlug', async () => {
    const low = await plag({ submissionId: 'as-1', score: 10 });
    expect(low.status).toBe(200);
    expect(low.body).toEqual({ status: 'recorded', alerted: 0 });
    conforms('POST /api/v1/integrations/plagiarism/:tenantSlug', low);
    const high = await plag({ submissionId: 'as-1', score: 61, reportUrl: 'https://turnitin.example/r/1' });
    expect(high.body.alerted).toBe(1);
    conforms('POST /api/v1/integrations/plagiarism/:tenantSlug', high);

    for (const [res, status] of [
      [await plag({ submissionId: 'as-1', score: 10 }, { secret: 'z'.repeat(40) }), 401],
      [await plag({ score: 'high' }), 400],
      [await plag({ submissionId: 'as-1', score: 10 }, { slug: 'nowhere' }), 404],
      [await plag({ submissionId: 'missing', score: 10 }), 404],
    ] as const) {
      expect(res.status).toBe(status);
      conforms('POST /api/v1/integrations/plagiarism/:tenantSlug', res);
    }
  });

  const hook = (body: object | string, secret = LK_SECRET) => {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    const token = jwt.sign({ iss: LK_KEY, sha256: crypto.createHash('sha256').update(raw).digest('base64') }, secret, {
      algorithm: 'HS256',
      expiresIn: 300,
    });
    return request(app)
      .post('/api/v1/integrations/livekit')
      .set('content-type', 'application/webhook+json')
      .set('authorization', token)
      .send(raw);
  };

  it('POST /integrations/livekit', async () => {
    const joined = await hook({
      event: 'participant_joined',
      room: { name: 'lms_t-h_ls-1' },
      participant: { identity: 's1' },
      createdAt: Math.floor(Date.now() / 1000),
    });
    expect(joined.status).toBe(200);
    expect(joined.body).toEqual({ ok: true });
    conforms('POST /api/v1/integrations/livekit', joined);
    const foreign = await hook({ event: 'room_finished', room: { name: 'someone-elses-room' } });
    expect(foreign.body).toEqual({ ok: true, ignored: 'unknown room' });
    conforms('POST /api/v1/integrations/livekit', foreign);
    const unknownSession = await hook({ event: 'room_finished', room: { name: 'lms_t-h_nope' } });
    expect(unknownSession.body.ignored).toBe('unknown session');
    conforms('POST /api/v1/integrations/livekit', unknownSession);

    for (const [res, status] of [
      [await hook({ event: 'x' }, 'y'.repeat(40)), 401],
      [await hook('not json'), 400],
      [await request(app).post('/api/v1/integrations/livekit').send({}), 401],
    ] as const) {
      expect(res.status).toBe(status);
      conforms('POST /api/v1/integrations/livekit', res);
    }
  });
});
