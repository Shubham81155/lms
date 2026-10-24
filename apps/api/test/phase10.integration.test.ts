import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import zlib from 'zlib';
import { SignedXml } from 'xml-crypto';
import { generate as generateCert } from 'selfsigned';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// SAML 2.0 sign-in against a mock identity provider that builds and signs real SAML responses,
// with the real API, real migrations and the unprivileged database role.

const PASSWORD = 'CorrectHorse1!';
const APP = 'http://localhost:3000';
const IDP = 'https://idp.example.org/metadata';
const ENTRY = 'https://idp.example.org/sso';
const ACS = `${APP}/api/v1/auth/saml/acs`;
const SP = `${APP}/api/v1/auth/saml/metadata/harvard`;
const pw = (slug: string) => `${PASSWORD}-${slug}`;

let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;
let saml: typeof import('../src/lib/saml.js');

// ---- the identity provider's keys ---------------------------------------------------------------
const rsa = () =>
  crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
const idpKeys = rsa();
const otherKeys = rsa();

// ---- building SAML responses --------------------------------------------------------------------
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Opts {
  inResponseTo?: string | null;
  audience?: string;
  issuer?: string;
  responseIssuer?: string;
  nameId?: string;
  nameIdFormat?: string;
  attributes?: Record<string, string>;
  notOnOrAfter?: number;
  notBefore?: number;
  recipient?: string;
  destination?: string;
  statusCode?: string;
  signWith?: string | null; // private key PEM; null = leave the assertion unsigned
  tamper?: (signed: string) => string;
}

function assertion(o: Opts & { id?: string }) {
  const attrs = Object.entries(o.attributes ?? {})
    .map(([k, v]) => `<saml:Attribute Name="${k}"><saml:AttributeValue>${xmlEscape(v)}</saml:AttributeValue></saml:Attribute>`)
    .join('');
  return (
    `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${o.id ?? '_a' + crypto.randomBytes(8).toString('hex')}" Version="2.0" IssueInstant="${iso(0)}">` +
    `<saml:Issuer>${o.issuer ?? IDP}</saml:Issuer>` +
    `<saml:Subject><saml:NameID Format="${o.nameIdFormat ?? 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent'}">${xmlEscape(o.nameId ?? 'nid-1')}</saml:NameID>` +
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="${iso(o.notOnOrAfter ?? 300_000)}" Recipient="${o.recipient ?? ACS}"${o.inResponseTo ? ` InResponseTo="${o.inResponseTo}"` : ''}/></saml:SubjectConfirmation></saml:Subject>` +
    `<saml:Conditions NotBefore="${iso(o.notBefore ?? -60_000)}" NotOnOrAfter="${iso(o.notOnOrAfter ?? 300_000)}"><saml:AudienceRestriction><saml:Audience>${o.audience ?? SP}</saml:Audience></saml:AudienceRestriction></saml:Conditions>` +
    `<saml:AuthnStatement AuthnInstant="${iso(-1000)}" SessionIndex="_s1"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:Password</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>` +
    (attrs ? `<saml:AttributeStatement>${attrs}</saml:AttributeStatement>` : '') +
    `</saml:Assertion>`
  );
}

function sign(xml: string, privateKey: string) {
  const sig = new SignedXml({
    privateKey,
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
}

/** A complete, base64-encoded SAMLResponse as an IdP would POST it. */
function samlResponse(o: Opts, extraBeforeAssertion = ''): string {
  const a = assertion(o);
  const signed = o.signWith === null ? a : sign(a, o.signWith ?? idpKeys.privateKey);
  let xml =
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r${crypto.randomBytes(8).toString('hex')}" Version="2.0" IssueInstant="${iso(0)}" Destination="${o.destination ?? ACS}"${o.inResponseTo ? ` InResponseTo="${o.inResponseTo}"` : ''}>` +
    `<saml:Issuer>${o.responseIssuer ?? o.issuer ?? IDP}</saml:Issuer>` +
    `<samlp:Status><samlp:StatusCode Value="${o.statusCode ?? 'urn:oasis:names:tc:SAML:2.0:status:Success'}"/></samlp:Status>` +
    extraBeforeAssertion +
    signed +
    `</samlp:Response>`;
  if (o.tamper) xml = o.tamper(xml);
  return Buffer.from(xml).toString('base64');
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
  for (const s of ['s1', 's2', 's3', 's4', 's5', 's6', 's7']) await user(s, 't-h', 'harvard', 'STUDENT');
  await user('susp', 't-h', 'harvard', 'STUDENT', { status: 'SUSPENDED' });
  await user('bound', 't-h', 'harvard', 'STUDENT', { idpProvider: 'SAML', idpSubjectId: `saml:${IDP}|original` });
  await user('oidcuser', 't-h', 'harvard', 'STUDENT', { idpProvider: 'OIDC', idpSubjectId: 'oidc-sub' });
  await user('scim', 't-h', 'harvard', 'STUDENT', { idpProvider: 'SCIM', idpSubjectId: 'dir-1', passwordHash: null });
  await user('m-admin', 't-m', 'mit', 'TENANT_ADMIN');
}

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  await seed();
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
  saml = await import('../src/lib/saml.js');
}, 240_000);

afterAll(async () => {
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

/** The AuthnRequest the app sent, decoded. */
function decodeRequest(location: string) {
  const u = new URL(location);
  const xml = zlib.inflateRawSync(Buffer.from(u.searchParams.get('SAMLRequest')!, 'base64')).toString();
  return { url: u, xml, id: /ID="([^"]+)"/.exec(xml)![1] };
}

interface Flow {
  host?: string;
  skipCookie?: boolean;
  mutate?: (o: Opts, requestId: string) => Opts;
  extra?: string;
  rawResponse?: string;
}

/** Plays the browser: SP-initiated start, the IdP answers the request, the response is POSTed back. */
async function signIn(attrs: Record<string, string>, o: Opts = {}, flow: Flow = {}) {
  const agent = request.agent(app);
  const withHost = (r: request.Test) => (flow.host ? r.set('Host', flow.host) : r.set('x-tenant-id', 'harvard'));
  const start = await withHost(agent.get('/api/v1/auth/saml/start'));
  if (start.status !== 302 || !start.headers.location.startsWith(ENTRY))
    return { agent, start, acs: start as request.Response, req: undefined as any };
  const req = decodeRequest(start.headers.location);
  const built: Opts = { inResponseTo: req.id, attributes: attrs, ...o };
  const final = flow.mutate ? flow.mutate(built, req.id) : built;
  const body = { SAMLResponse: flow.rawResponse ?? samlResponse(final, flow.extra), RelayState: '' };
  const post = (flow.skipCookie ? request(app) : agent).post('/api/v1/auth/saml/acs').type('form');
  const acs = await withHost(post).send(body);
  return { agent, start, acs, req };
}

const refused = (r: { acs: request.Response }) => {
  expect(r.acs.status).toBe(303);
  expect(r.acs.headers.location).toBe(`${APP}/login?error=sso_failed`);
  expect(String(r.acs.headers['set-cookie'] ?? '')).not.toContain('lms_token=ey');
};
const ok = (r: { acs: request.Response }) => {
  expect(r.acs.status).toBe(303);
  expect(r.acs.headers.location).toBe(`${APP}/`);
  expect(String(r.acs.headers['set-cookie'])).toContain('lms_token=');
};

// ---------------------------------------------------------------------------
describe('pure helpers', () => {
  it('recognises only a Success status', () => {
    const resp = (code: string) =>
      Buffer.from(
        `<samlp:Response xmlns:samlp="p"><samlp:Status><samlp:StatusCode Value="${code}"/></samlp:Status></samlp:Response>`
      ).toString('base64');
    expect(saml.responseSucceeded(resp('urn:oasis:names:tc:SAML:2.0:status:Success'))).toBe(true);
    expect(saml.responseSucceeded(resp('urn:oasis:names:tc:SAML:2.0:status:Responder'))).toBe(false);
    expect(saml.responseSucceeded(Buffer.from('<nothing/>').toString('base64'))).toBe(false);
    expect(saml.responseSucceeded('')).toBe(false);
  });

  it('validates the key an administrator pastes', async () => {
    expect(() => saml.parseIdpKey(otherKeys.privateKey)).toThrow(/private key/i);
    expect(() => saml.parseIdpKey('not a cert at all, just text that is long enough')).toThrow(/Could not read/);
    const pub = saml.parseIdpKey(idpKeys.publicKey);
    expect(pub).toMatchObject({ kind: 'PUBLIC KEY', notAfter: null });
    expect(pub.fingerprint).toMatch(/^[0-9a-f]{64}$/);

    const good = await generateCert([{ name: 'commonName', value: 'idp' }], {
      keyPair: { privateKey: idpKeys.privateKey, publicKey: idpKeys.publicKey },
      algorithm: 'sha256',
    });
    const cert = saml.parseIdpKey(good.cert);
    expect(cert.kind).toBe('CERTIFICATE');
    expect(cert.notAfter!.getTime()).toBeGreaterThan(Date.now());
    const bare = good.cert.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, ''); // as found in IdP metadata
    expect(saml.parseIdpKey(bare).fingerprint).toBe(cert.fingerprint);

    const expired = await generateCert([{ name: 'commonName', value: 'old' }], {
      keyPair: { privateKey: idpKeys.privateKey, publicKey: idpKeys.publicKey },
      algorithm: 'sha256',
      notBeforeDate: new Date(Date.now() - 3 * 86_400_000),
      notAfterDate: new Date(Date.now() - 86_400_000),
    });
    expect(() => saml.parseIdpKey(expired.cert)).toThrow(/expired/);
  });

  it('finds the e-mail and a stable subject in a profile', () => {
    const p = (o: object) =>
      ({ issuer: IDP, nameID: 'n1', nameIDFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent', ...o }) as any;
    expect(saml.emailFromProfile(p({ email: ' A@x.edu ' }), 'email')).toBe('A@x.edu');
    expect(saml.emailFromProfile(p({ mail: 'm@x.edu' }), 'email')).toBe('m@x.edu');
    expect(saml.emailFromProfile(p({ 'urn:custom:mail': ['c@x.edu'] }), 'urn:custom:mail')).toBe('c@x.edu');
    // A named attribute is used exclusively: no fallback to other fields or the NameID.
    expect(saml.emailFromProfile(p({ email: 'e@x.edu', mail: 'm@x.edu' }), 'urn:custom:mail')).toBeNull();
    expect(
      saml.emailFromProfile(
        p({ nameID: 'n@x.edu', nameIDFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress' }),
        'urn:custom:mail'
      )
    ).toBeNull();
    expect(
      saml.emailFromProfile(p({ nameID: 'n@x.edu', nameIDFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress' }), 'email')
    ).toBe('n@x.edu');
    expect(saml.emailFromProfile(p({}), 'email')).toBeNull();

    expect(saml.subjectFromProfile(p({}), IDP)).toBe(`saml:${IDP}|n1`);
    expect(saml.subjectFromProfile(p({ nameIDFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient' }), IDP)).toBeNull();
    expect(saml.subjectFromProfile(p({ nameID: 'x'.repeat(300) }), IDP)).toBeNull();
    expect(saml.subjectFromProfile(p({ nameID: '' }), IDP)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('configuration (administrator)', () => {
  const body = (over: object = {}) => ({
    entryPoint: ENTRY,
    idpIssuer: IDP,
    idpCert: idpKeys.publicKey,
    emailAttribute: 'email',
    enabled: true,
    allowedDomains: [],
    ...over,
  });

  it('is administrator-only and plan-gated', async () => {
    expect((await (await as('teacher')).put('/api/v1/admin/saml').send(body())).status).toBe(403);
    expect((await (await as('teacher')).get('/api/v1/admin/saml')).status).toBe(403);
    expect((await request(app).put('/api/v1/admin/saml').send(body())).status).toBe(401);
    expect((await (await as('m-admin', 'mit')).put('/api/v1/admin/saml').send(body())).status).toBe(403);
  });

  it('lists what to give the identity provider before anything is configured', async () => {
    const res = await (await as('admin')).get('/api/v1/admin/saml');
    expect(res.body.data).toBeNull();
    expect(res.body.sp.entityIds).toEqual([SP]);
    expect(res.body.sp.acsUrls).toEqual([ACS]);
  });

  it('validates input and refuses private keys, junk and expired certificates', async () => {
    const a = await as('admin');
    expect((await a.put('/api/v1/admin/saml').send(body({ idpCert: undefined }))).status).toBe(400); // first save needs a key
    expect((await a.put('/api/v1/admin/saml').send(body({ idpCert: otherKeys.privateKey }))).body.error).toMatch(/private key/i);
    expect((await a.put('/api/v1/admin/saml').send(body({ idpCert: 'x'.repeat(60) }))).status).toBe(400);
    expect((await a.put('/api/v1/admin/saml').send(body({ entryPoint: 'ftp://idp.example.org/sso' }))).status).toBe(400);
    expect((await a.put('/api/v1/admin/saml').send(body({ entryPoint: 'nope' }))).status).toBe(400);
    expect((await a.put('/api/v1/admin/saml').send(body({ idpIssuer: '' }))).status).toBe(400);
    expect((await a.put('/api/v1/admin/saml').send(body({ allowedDomains: ['bad domain'] }))).status).toBe(400);
    const expired = await generateCert([{ name: 'commonName', value: 'old' }], {
      keyPair: { privateKey: idpKeys.privateKey, publicKey: idpKeys.publicKey },
      algorithm: 'sha256',
      notBeforeDate: new Date(Date.now() - 3 * 86_400_000),
      notAfterDate: new Date(Date.now() - 86_400_000),
    });
    expect((await a.put('/api/v1/admin/saml').send(body({ idpCert: expired.cert }))).body.error).toMatch(/expired/);
    expect(await admin.samlConnection.count()).toBe(0);
  });

  it('pins the key, shows only its fingerprint, and keeps it when omitted later', async () => {
    const a = await as('admin');
    const res = await a.put('/api/v1/admin/saml').send(body({ allowedDomains: ['X.edu'] }));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      entryPoint: ENTRY,
      idpIssuer: IDP,
      enabled: true,
      keyKind: 'PUBLIC KEY',
      allowedDomains: ['x.edu'],
    });
    expect(res.body.data.keyFingerprint).toBe(saml.parseIdpKey(idpKeys.publicKey).fingerprint);
    expect(JSON.stringify(res.body)).not.toContain('BEGIN PUBLIC KEY');

    const keep = await a.put('/api/v1/admin/saml').send(body({ idpCert: undefined, allowedDomains: [] }));
    expect(keep.status).toBe(200);
    expect(keep.body.data.keyFingerprint).toBe(res.body.data.keyFingerprint);
    expect(await admin.auditLog.count({ where: { action: 'SAML_CONFIG_UPDATED' } })).toBe(2);
  });

  it('serves public SP metadata for the tenant that has SAML, and 404 otherwise', async () => {
    const meta = await request(app).get('/api/v1/auth/saml/metadata/harvard');
    expect(meta.status).toBe(200);
    expect(meta.headers['content-type']).toMatch(/samlmetadata\+xml/);
    expect(meta.text).toContain(`entityID="${SP}"`);
    expect(meta.text).toContain(ACS);
    expect(meta.text).toMatch(/WantAssertionsSigned="true"/);
    expect((await request(app).get('/api/v1/auth/saml/metadata/mit')).status).toBe(404); // no connection
    expect((await request(app).get('/api/v1/auth/saml/metadata/nowhere')).status).toBe(404);
  });

  it('reports SAML as available on the status endpoint', async () => {
    expect((await request(app).get('/api/v1/auth/sso/status').set('x-tenant-id', 'harvard')).body).toMatchObject({
      enabled: true,
      saml: true,
      oidc: false,
    });
    expect((await request(app).get('/api/v1/auth/sso/status').set('x-tenant-id', 'mit')).body).toMatchObject({
      enabled: false,
      saml: false,
    });
  });
});

// ---------------------------------------------------------------------------
describe('SP-initiated sign-in', () => {
  it('sends a well-formed AuthnRequest and sets a protected flow cookie', async () => {
    const start = await request(app).get('/api/v1/auth/saml/start').set('x-tenant-id', 'harvard');
    expect(start.status).toBe(302);
    const r = decodeRequest(start.headers.location);
    expect(r.url.origin + r.url.pathname).toBe(ENTRY);
    expect(r.id).toMatch(/^_[0-9a-f]{40}$/); // unpredictable
    expect(r.xml).toContain(`AssertionConsumerServiceURL="${ACS}"`);
    expect(r.xml).toContain(`>${SP}</saml:Issuer>`);
    const cookie = String(start.headers['set-cookie']);
    expect(cookie).toContain('lms_saml=');
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toContain('Path=/api/v1/auth/saml');
    expect(cookie).not.toContain(r.id); // the request id is inside the signed token
  });

  it('signs in an existing user from a signed assertion, then by subject', async () => {
    const r = await signIn({ email: 's1@x.edu' }, { nameId: 'nid-s1' });
    ok(r);
    const me = await r.agent.get('/api/v1/auth/me').set('x-tenant-id', 'harvard');
    expect(me.body.user).toMatchObject({ id: 's1', role: 'STUDENT' });
    expect(await admin.user.findUnique({ where: { id: 's1' } })).toMatchObject({ idpProvider: 'SAML', idpSubjectId: `saml:${IDP}|nid-s1` });
    expect(await admin.auditLog.count({ where: { userId: 's1', action: 'USER_LOGIN' } })).toBe(1);

    // Bound now: the same subject reaches the same account even if the e-mail attribute changed.
    const again = await signIn({ email: 'renamed@x.edu' }, { nameId: 'nid-s1' });
    ok(again);
    expect((await again.agent.get('/api/v1/auth/me').set('x-tenant-id', 'harvard')).body.user.id).toBe('s1');
  });

  it('takes the e-mail from an e-mail NameID, a configured attribute, or the "mail" alias', async () => {
    ok(await signIn({}, { nameId: 's2@x.edu', nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress' }));
    expect(await admin.user.findUnique({ where: { id: 's2' } })).toMatchObject({ idpProvider: 'SAML' });
    ok(await signIn({ mail: 's3@x.edu' }, { nameId: 'nid-s3' }));
    await (
      await as('admin')
    )
      .put('/api/v1/admin/saml')
      .send({ entryPoint: ENTRY, idpIssuer: IDP, enabled: true, allowedDomains: [], emailAttribute: 'urn:custom:work-email' });
    ok(await signIn({ 'urn:custom:work-email': 's4@x.edu' }, { nameId: 'nid-s4' }));
    refused(await signIn({ email: 's5@x.edu' }, { nameId: 'nid-s5' })); // the configured attribute is absent, so no e-mail
    await (
      await as('admin')
    )
      .put('/api/v1/admin/saml')
      .send({ entryPoint: ENTRY, idpIssuer: IDP, enabled: true, allowedDomains: [], emailAttribute: 'email' });
  });

  it('finds accounts by e-mail every time when the NameID is transient, without binding it', async () => {
    const t = { nameIdFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient' };
    ok(await signIn({ email: 's6@x.edu' }, { ...t, nameId: 'random-1' }));
    ok(await signIn({ email: 's6@x.edu' }, { ...t, nameId: 'random-2' }));
    expect((await admin.user.findUnique({ where: { id: 's6' } }))?.idpSubjectId).toBeNull();
  });

  it('never creates accounts', async () => {
    const before = await admin.user.count();
    refused(await signIn({ email: 'stranger@x.edu' }, { nameId: 'nid-x' }));
    expect(await admin.user.count()).toBe(before);
  });

  it('creates a learner from the assertion name attributes when the organisation allows it', async () => {
    const a = await as('admin');
    const conf = { entryPoint: ENTRY, idpIssuer: IDP, enabled: true, emailAttribute: 'email' };
    expect((await a.put('/api/v1/admin/saml').send({ ...conf, allowedDomains: [], autoCreateAccounts: true })).status).toBe(400);
    await a.put('/api/v1/admin/saml').send({ ...conf, allowedDomains: ['x.edu'], autoCreateAccounts: true });
    ok(await signIn({ email: 'newcomer@x.edu', 'urn:oid:2.5.4.42': 'Grace', 'urn:oid:2.5.4.4': 'Hopper' }, { nameId: 'nid-newcomer' }));
    expect(await admin.user.findFirst({ where: { tenantId: 't-h', email: 'newcomer@x.edu' } })).toMatchObject({
      role: 'STUDENT',
      status: 'ACTIVE',
      firstName: 'Grace',
      lastName: 'Hopper',
      idpProvider: 'SAML',
      idpSubjectId: `saml:${IDP}|nid-newcomer`,
    });
    refused(await signIn({ email: 'outsider@partner.org' }, { nameId: 'nid-outsider' }));
    await a.put('/api/v1/admin/saml').send({ ...conf, allowedDomains: [], autoCreateAccounts: false });
  });

  it('refuses suspended accounts, other domains, and accounts bound to a different identity', async () => {
    refused(await signIn({ email: 'susp@x.edu' }, { nameId: 'nid-susp' }));
    refused(await signIn({ email: 'bound@x.edu' }, { nameId: 'attacker' }));
    expect((await admin.user.findUnique({ where: { id: 'bound' } }))?.idpSubjectId).toBe(`saml:${IDP}|original`);
    await (
      await as('admin')
    )
      .put('/api/v1/admin/saml')
      .send({ entryPoint: ENTRY, idpIssuer: IDP, enabled: true, allowedDomains: ['partner.org'], emailAttribute: 'email' });
    refused(await signIn({ email: 's7@x.edu' }, { nameId: 'nid-s7' }));
    await (
      await as('admin')
    )
      .put('/api/v1/admin/saml')
      .send({ entryPoint: ENTRY, idpIssuer: IDP, enabled: true, allowedDomains: [], emailAttribute: 'email' });
    ok(await signIn({ email: 's7@x.edu' }, { nameId: 'nid-s7' }));
  });

  it('binds a SCIM-provisioned account, and moves an account over from OIDC', async () => {
    ok(await signIn({ email: 'scim@x.edu' }, { nameId: 'scim-nid' }));
    expect(await admin.user.findUnique({ where: { id: 'scim' } })).toMatchObject({
      idpProvider: 'SAML',
      idpSubjectId: `saml:${IDP}|scim-nid`,
    });
    ok(await signIn({ email: 'oidcuser@x.edu' }, { nameId: 'moved' })); // the tenant switched identity provider
    expect(await admin.user.findUnique({ where: { id: 'oidcuser' } })).toMatchObject({ idpProvider: 'SAML' });
  });
});

// ---------------------------------------------------------------------------
describe('responses that must be refused', () => {
  const email = { email: 'teacher@x.edu' };

  it('needs the flow cookie from this browser', async () => {
    refused(await signIn(email, {}, { skipCookie: true }));
  });

  it('refuses a missing, empty or garbage response', async () => {
    refused(await signIn(email, {}, { rawResponse: '' }));
    refused(await signIn(email, {}, { rawResponse: 'not-base64-xml!!' }));
    refused(await signIn(email, {}, { rawResponse: Buffer.from('<hello/>').toString('base64') }));
  });

  it('checks the signature against the pinned key', async () => {
    refused(await signIn(email, { signWith: otherKeys.privateKey })); // someone else's key
    refused(await signIn(email, { signWith: null })); // unsigned assertion
  });

  it('detects tampering after signing', async () => {
    refused(await signIn(email, { tamper: (x) => x.replace('teacher@x.edu', 's1@x.edu') })); // swap the identity
    refused(await signIn(email, { tamper: (x) => x.replace('nid-1', 'nid-evil') }));
    expect(await admin.user.findUnique({ where: { id: 's1' } })).not.toMatchObject({ idpSubjectId: `saml:${IDP}|nid-1` });
  });

  it('is not fooled by an unsigned assertion placed ahead of the signed one (signature wrapping)', async () => {
    // A forged assertion for s2, followed by a genuine signed one for the teacher.
    const forged = assertion({ inResponseTo: undefined, attributes: { email: 's2@x.edu' }, nameId: 'forged' });
    const r = await signIn(email, {}, { extra: forged });
    const who = (await r.agent.get('/api/v1/auth/me').set('x-tenant-id', 'harvard')).body?.user?.id;
    expect(who).not.toBe('s2'); // either refused, or the signed (teacher) identity, never the forged one
    expect(await admin.user.findUnique({ where: { id: 's2' } })).not.toMatchObject({ idpSubjectId: `saml:${IDP}|forged` });
  });

  it('enforces time conditions', async () => {
    refused(await signIn(email, { notOnOrAfter: -120_000 })); // expired
    refused(await signIn(email, { notBefore: 600_000, notOnOrAfter: 900_000 })); // not valid yet
  });

  it('enforces the audience: the assertion must be addressed to this tenant', async () => {
    refused(await signIn(email, { audience: 'https://another-sp.example/metadata' }));
    refused(await signIn(email, { audience: `${APP}/api/v1/auth/saml/metadata/mit` })); // another tenant's entity id
  });

  it('enforces the issuer', async () => {
    refused(await signIn(email, { issuer: 'https://evil-idp.example/metadata' }));
  });

  it('only accepts a response to the request this browser started', async () => {
    refused(await signIn(email, { inResponseTo: '_someone_elses_request' })); // swapped
    refused(await signIn(email, {}, { mutate: (o) => ({ ...o, inResponseTo: null }) })); // IdP-initiated / unsolicited
  });

  it('refuses a failed status and replays', async () => {
    refused(await signIn(email, { statusCode: 'urn:oasis:names:tc:SAML:2.0:status:AuthnFailed' }));
    // Replay: the first POST works, the flow cookie is spent, so the identical POST fails.
    const first = await signIn(email, { nameId: 'replay' });
    ok(first);
    const captured = Buffer.from(samlResponse({ inResponseTo: first.req.id, attributes: email, nameId: 'replay' })).toString();
    const replay = await first.agent
      .post('/api/v1/auth/saml/acs')
      .type('form')
      .set('x-tenant-id', 'harvard')
      .send({ SAMLResponse: captured });
    expect(replay.headers.location).toBe(`${APP}/login?error=sso_failed`);
  });

  it('records refusals in the audit log with a reason, but never in the redirect', async () => {
    const failures = await admin.auditLog.findMany({ where: { action: 'SAML_LOGIN_FAILED' } });
    expect(failures.length).toBeGreaterThanOrEqual(8);
    expect(failures.every((f) => typeof (f.diffJson as any).reason === 'string')).toBe(true);
    const r = await signIn({ email: 'stranger@x.edu' }, { nameId: 'nid-stranger' });
    expect(r.acs.headers.location).toBe(`${APP}/login?error=sso_failed`);
  });
});

// ---------------------------------------------------------------------------
describe('custom domains', () => {
  const CUSTOM = 'http://learn.harvard.edu';
  const CSP = `${CUSTOM}/api/v1/auth/saml/metadata/harvard`;
  const CACS = `${CUSTOM}/api/v1/auth/saml/acs`;

  beforeAll(async () => {
    await admin.tenant.update({ where: { id: 't-h' }, data: { customDomain: 'learn.harvard.edu' } });
    await admin.user.create({
      data: {
        id: 'cdomain',
        tenantId: 't-h',
        email: 'cdomain@x.edu',
        firstName: 'c',
        lastName: 'L',
        role: 'STUDENT',
        passwordHash: null,
        emailVerified: true,
      },
    });
  });

  it('lists both sets of identifiers for the administrator', async () => {
    const res = await (await as('admin')).get('/api/v1/admin/saml');
    expect(res.body.sp.entityIds).toEqual([SP, CSP]);
    expect(res.body.sp.acsUrls).toEqual([ACS, CACS]);
  });

  it('runs the whole flow on the domain it started on, addressed to that domain', async () => {
    const r = await signIn(
      { email: 'cdomain@x.edu' },
      { audience: CSP, recipient: CACS, destination: CACS },
      { host: 'learn.harvard.edu' }
    );
    expect(r.req.xml).toContain(`AssertionConsumerServiceURL="${CACS}"`);
    expect(r.acs.status).toBe(303);
    expect(r.acs.headers.location).toBe(`${CUSTOM}/`);
  });

  it('refuses an assertion addressed to the other origin', async () => {
    // Started on the custom domain but addressed to the platform address: wrong audience.
    const r = await signIn({ email: 'cdomain@x.edu' }, { audience: SP }, { host: 'learn.harvard.edu' });
    expect(r.acs.headers.location).toBe(`${CUSTOM}/login?error=sso_failed`);
  });

  it('ignores a forged Host and falls back to the platform address', async () => {
    const start = await request(app).get('/api/v1/auth/saml/start').set('Host', 'evil.example').set('x-tenant-id', 'harvard');
    expect(decodeRequest(start.headers.location).xml).toContain(`AssertionConsumerServiceURL="${ACS}"`);
  });
});

// ---------------------------------------------------------------------------
describe('switching off and isolation', () => {
  it('stops sign-in the moment SAML is disabled, even mid-flow', async () => {
    const a = await as('admin');
    const agent = request.agent(app);
    const start = await agent.get('/api/v1/auth/saml/start').set('x-tenant-id', 'harvard');
    const req = decodeRequest(start.headers.location);
    await a
      .put('/api/v1/admin/saml')
      .send({ entryPoint: ENTRY, idpIssuer: IDP, enabled: false, allowedDomains: [], emailAttribute: 'email' });
    const acs = await agent
      .post('/api/v1/auth/saml/acs')
      .type('form')
      .set('x-tenant-id', 'harvard')
      .send({ SAMLResponse: samlResponse({ inResponseTo: req.id, attributes: { email: 'teacher@x.edu' } }) });
    expect(acs.headers.location).toBe(`${APP}/login?error=sso_failed`);
    expect((await request(app).get('/api/v1/auth/saml/start').set('x-tenant-id', 'harvard')).headers.location).toBe(
      `${APP}/login?error=sso_unavailable`
    );
    expect((await request(app).get('/api/v1/auth/sso/status').set('x-tenant-id', 'harvard')).body.saml).toBe(false);
  });

  it('removes the connection, only for the caller’s tenant', async () => {
    expect((await (await as('m-admin', 'mit')).delete('/api/v1/admin/saml')).status).toBe(404);
    expect((await (await as('admin')).delete('/api/v1/admin/saml')).status).toBe(204);
    expect((await (await as('admin')).get('/api/v1/admin/saml')).body.data).toBeNull();
    expect((await request(app).get('/api/v1/auth/saml/metadata/harvard')).status).toBe(404);
  });

  it('hides connections from a database session with no tenant context', async () => {
    await admin.samlConnection.create({ data: { tenantId: 't-h', entryPoint: ENTRY, idpIssuer: IDP, idpCert: idpKeys.publicKey } });
    const unscoped = new PrismaClient({ datasourceUrl: db.appUrl });
    try {
      expect(await unscoped.samlConnection.count()).toBe(0);
    } finally {
      await unscoped.$disconnect();
    }
  });
});
