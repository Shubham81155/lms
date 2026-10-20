import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import http from 'http';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';
import { totp } from '../src/lib/totp';

// Contract test for responses/admin.ts: every operation in the table is called for real and its
// body is parsed with the documented schema. Secret-bearing fields are asserted exactly.

const PASSWORD = 'CorrectHorse1!';
const pw = (slug: string) => `${PASSWORD}-${slug}`;
const LK_URL = 'wss://live.example.org';
const LK_SECRET = 'live-secret-'.padEnd(48, 'x');
const CLIENT_SECRET = 'oidc-client-secret-value';

let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;
let RESPONSES: typeof import('../src/openapi/responses/admin.js').RESPONSES;
const covered = new Set<string>();

async function seed() {
  await admin.tenant.create({ data: { id: 't-h', slug: 'harvard', name: 'Harvard', tier: 'ENTERPRISE' } });
  const user = (id: string, role: any) =>
    admin.user.create({ data: { id, tenantId: 't-h', email: `${id}@x.edu`, firstName: id, lastName: 'L', role, passwordHash: bcrypt.hashSync(pw('harvard'), 4), emailVerified: true } });
  await user('admin', 'TENANT_ADMIN');
  await user('teacher', 'INSTRUCTOR');
  await user('ta', 'TEACHING_ASSISTANT');
  await user('auditor', 'AUDITOR');
  await user('mfauser', 'STUDENT');
  for (const s of ['s1', 's2']) await user(s, 'STUDENT');
  await admin.course.create({ data: { id: 'c1', tenantId: 't-h', code: 'C1', title: 'Course 1', status: 'PUBLISHED' } });
  await admin.courseInstructor.createMany({ data: [{ courseId: 'c1', userId: 'teacher', isPrimary: true }, { courseId: 'c1', userId: 'ta' }] });
  for (const s of ['s1', 's2']) await admin.enrollment.create({ data: { id: `e-${s}`, tenantId: 't-h', courseId: 'c1', userId: s, status: 'IN_PROGRESS' } });
  await admin.module.create({ data: { id: 'mod1', courseId: 'c1', title: 'Module 1', lessons: { create: [{ id: 'les1', title: 'Lesson 1' }] } } });
  await admin.enrollment.update({ where: { id: 'e-s1' }, data: { status: 'COMPLETED', completedAt: new Date(), finalGrade: 90 } });
  await admin.certificate.create({ data: { id: 'cert1', enrollmentId: 'e-s1', certificateNumber: 'CERT-1', verificationQr: 'https://x.example/verify/CERT-1' } });
  // The platform operator's organisation, whose super administrators manage every plan.
  await admin.tenant.create({ data: { id: 't-op', slug: 'ops', name: 'Operator', tier: 'ENTERPRISE' } });
  await admin.user.create({ data: { id: 'operator', tenantId: 't-op', email: 'operator@x.edu', firstName: 'Op', lastName: 'L', role: 'SUPER_ADMIN', passwordHash: bcrypt.hashSync(pw('ops'), 4), emailVerified: true } });
  // An audit row whose acting user no longer exists.
  await admin.auditLog.create({ data: { tenantId: 't-h', userId: null, action: 'SEEDED_ORPHAN', resourceType: 'TENANT', diffJson: { a: 1 } } });
}

beforeAll(async () => {
  process.env.PLATFORM_OPERATOR_TENANT = 'ops';
  process.env.LIVEKIT_URL = LK_URL;
  process.env.LIVEKIT_API_KEY = 'APIkeyForTests';
  process.env.LIVEKIT_API_SECRET = LK_SECRET;
  process.env.TLS_ASK_SECRET = 'tls-ask-secret-for-contract-tests';
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  await seed();
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
  ({ RESPONSES } = await import('../src/openapi/responses/admin.js'));
}, 240_000);

afterAll(async () => {
  await admin?.$disconnect();
  await db?.stop();
}, 60_000);

async function as(who: string, tenant = 'harvard') {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').set('x-tenant-id', tenant).send({ email: `${who}@x.edu`, password: pw(tenant) });
  expect(res.status, `login as ${who}`).toBe(200);
  return agent;
}

/** Asserts the status is a documented success status and the body matches its schema. */
function check(key: string, res: request.Response, status?: number): any {
  const entry = RESPONSES[key];
  expect(entry, `${key} is in the table`).toBeTruthy();
  const docs = [entry.response!, ...(entry.otherResponses ?? [])];
  expect(res.status, `${key}: ${JSON.stringify(res.body)}`).toBe(status ?? entry.response!.status);
  const doc = docs.find((d) => d.status === res.status);
  expect(doc, `${key} documents ${res.status}`).toBeTruthy();
  if (doc!.schema) {
    const parsed = doc!.schema.safeParse(res.body);
    expect(parsed.success, `${key}: ${JSON.stringify(parsed.success ? null : parsed.error)} body=${JSON.stringify(res.body)}`).toBe(true);
  } else {
    expect(res.text, key).toBeFalsy();
  }
  covered.add(key);
  return res.body;
}

const keys = (o: object) => Object.keys(o).sort();
const inFuture = (ms: number) => new Date(Date.now() + ms).toISOString();

// ---------------------------------------------------------------------------
describe('tenant settings, audit log and stats', () => {
  it('GET/PATCH /admin/tenant', async () => {
    const a = await as('admin');
    const got = check('GET /api/v1/admin/tenant', await a.get('/api/v1/admin/tenant'));
    expect(got.data).toMatchObject({ id: 't-h', userCount: 7, courseCount: 1, campusCount: 0, ltiDeploymentCount: 0 });
    const patched = check('PATCH /api/v1/admin/tenant', await a.patch('/api/v1/admin/tenant').send({ name: 'Harvard U', primaryColor: '#112233', logoUrl: '' }));
    expect(patched.data).toMatchObject({ name: 'Harvard U', logoUrl: null });
    expect(patched.data).not.toHaveProperty('userCount');
    expect((await (await as('teacher')).get('/api/v1/admin/tenant')).status).toBe(403);
  });

  it('audit log: filters, action list and CSV export for auditors', async () => {
    const aud = await as('auditor');
    const actions = check('GET /api/v1/admin/audit-logs/actions', await aud.get('/api/v1/admin/audit-logs/actions'));
    expect(actions.data.map((a: any) => a.action)).toContain('SEEDED_ORPHAN');

    const byActor = await aud.get('/api/v1/admin/audit-logs?actor=AUDITOR@x.edu&limit=100');
    expect(byActor.status).toBe(200);
    expect(byActor.body.data.length).toBeGreaterThan(0);
    expect(byActor.body.data.every((l: any) => l.user?.email === 'auditor@x.edu')).toBe(true);

    const csv = await aud.get('/api/v1/admin/audit-logs/export.csv?action=SEEDED_ORPHAN');
    check('GET /api/v1/admin/audit-logs/export.csv', { ...csv, body: csv.text } as any);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain('attachment');
    const lines = csv.text.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lines[0]).toBe('time,action,resource_type,resource_id,user_email,user_role,ip_address,user_agent,details');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('SEEDED_ORPHAN');
    expect(await admin.auditLog.count({ where: { action: 'AUDIT_LOG_EXPORTED' } })).toBe(1);

    expect((await (await as('teacher')).get('/api/v1/admin/audit-logs/export.csv')).status).toBe(403);
  });

  it('GET /admin/audit-logs (including an entry without a user)', async () => {
    const res = await (await as('auditor')).get('/api/v1/admin/audit-logs?limit=100');
    const body = check('GET /api/v1/admin/audit-logs', res);
    expect(body.data.some((l: any) => l.user === null && l.action === 'SEEDED_ORPHAN')).toBe(true);
    expect(body.data.some((l: any) => l.user?.role === 'TENANT_ADMIN')).toBe(true);
    // The embedded user exposes only these fields.
    expect(keys(body.data.find((l: any) => l.user).user)).toEqual(['email', 'firstName', 'id', 'lastName', 'role']);
    expect((await (await as('admin')).get('/api/v1/admin/audit-logs?startDate=2030-01-01&endDate=2020-01-01')).status).toBe(400);
  });

  it('GET /admin/stats', async () => {
    const body = check('GET /api/v1/admin/stats', await (await as('admin')).get('/api/v1/admin/stats'));
    expect(body.data).toMatchObject({ totalUsers: 7, totalCourses: 1, totalEnrollments: 2, completedEnrollments: 1, activeEnrollments: 1, completionRate: 50 });
    expect(body.data.roleCounts).toMatchObject({ TENANT_ADMIN: 1, STUDENT: 3 });
  });
});

// ---------------------------------------------------------------------------
describe('features, usage and export', () => {
  it('GET /admin/features: organisations read their plan but cannot change it', async () => {
    const a = await as('admin');
    const got = check('GET /api/v1/admin/features', await a.get('/api/v1/admin/features'));
    expect(got.data).toMatchObject({ sso: true, webhooks: true, scim: true });
    expect(keys(got.data)).toEqual(['aiAssistant', 'lti13', 'scim', 'sso', 'webhooks']);
    expect((await a.put('/api/v1/admin/features').send({ aiAssistant: false })).status).toBe(404);
    expect((await a.put('/api/v1/admin/usage/quota').send({ seatQuota: 50 })).status).toBe(404);
    expect((await a.get('/api/v1/operator/tenants')).status).toBe(403);
  });

  it('the platform operator manages plans, quotas and feature overrides', async () => {
    const op = await as('operator', 'ops');
    const list = check('GET /api/v1/operator/tenants', await op.get('/api/v1/operator/tenants'));
    const harvard = list.data.find((t: any) => t.slug === 'harvard');
    expect(harvard).toMatchObject({ tier: 'ENTERPRISE', seatQuota: null, seatsUsed: 7, overrides: {} });

    const set = check('PATCH /api/v1/operator/tenants/:id', await op.patch('/api/v1/operator/tenants/t-h').send({ seatQuota: 50, features: { aiAssistant: false } }));
    expect(set.data).toMatchObject({ seatQuota: 50, features: { aiAssistant: false }, overrides: { aiAssistant: false } });
    const a = await as('admin');
    expect((await a.get('/api/v1/admin/usage')).body.data.seats).toMatchObject({ quota: 50, remaining: 43 });
    expect((await a.get('/api/v1/admin/features')).body.data.aiAssistant).toBe(false);

    expect((await op.patch('/api/v1/operator/tenants/t-h').send({ seatQuota: 1 })).status).toBe(409);
    expect((await op.patch('/api/v1/operator/tenants/t-h').send({})).status).toBe(400);
    expect((await op.patch('/api/v1/operator/tenants/t-h').send({ tier: 'GOLD' })).status).toBe(400);
    expect((await op.patch('/api/v1/operator/tenants/nope').send({ seatQuota: 5 })).status).toBe(404);
    const back = check('PATCH /api/v1/operator/tenants/:id', await op.patch('/api/v1/operator/tenants/t-h').send({ seatQuota: null, features: { aiAssistant: null } }));
    expect(back.data).toMatchObject({ seatQuota: null, features: { aiAssistant: true }, overrides: {} });

    // Both audit trails record the change.
    expect(await admin.auditLog.count({ where: { action: 'TENANT_PLAN_UPDATED', tenantId: 't-h' } })).toBe(2);
    expect(await admin.auditLog.count({ where: { action: 'TENANT_PLAN_UPDATED', tenantId: 't-op' } })).toBe(2);
  });

  it('GET /admin/usage', async () => {
    const usage = check('GET /api/v1/admin/usage', await (await as('admin')).get('/api/v1/admin/usage'));
    expect(usage.data).toMatchObject({ tier: 'ENTERPRISE', seats: { used: 7, quota: null, remaining: null }, totals: { courses: 1, enrollments: 2, certificates: 1 } });
  });

  it('GET /admin/export contains the documented sections and no credentials', async () => {
    const res = await (await as('admin')).get('/api/v1/admin/export');
    const body = check('GET /api/v1/admin/export', res);
    expect(res.headers['content-disposition']).toContain('tenant-export-harvard.json');
    expect(keys(body)).toEqual([
      'assignmentSubmissions', 'assignments', 'auditLog', 'calendarEvents', 'campuses', 'certificates', 'courseGrades', 'courses', 'enrollments', 'exportedAt',
      'forumPosts', 'forumThreads', 'gradeAppeals', 'gradeCategories', 'liveAttendance', 'liveSessions', 'quizAttempts', 'quizzes', 'tenant', 'users',
    ]);
    expect(body.auditLog.length).toBeGreaterThan(0);
    expect(body.users).toHaveLength(7);
    expect(body.courses[0].modules[0].lessons).toHaveLength(1);
    expect(body.certificates).toHaveLength(1);
    expect(keys(body.users[0])).toEqual(['createdAt', 'email', 'firstName', 'id', 'lastLoginAt', 'lastName', 'role', 'status']);
    expect(JSON.stringify(body)).not.toMatch(/passwordHash|mfaSecret|mfaRecovery|clientSecret|tokenHash|whsec_/);
  });
});

// ---------------------------------------------------------------------------
describe('webhooks', () => {
  let server: http.Server;
  let url: string;
  let id: string;
  let secret: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.statusCode = req.url === '/fail' ? 500 : 200;
        res.end('ok');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('shows the signing secret once, on creation only', async () => {
    const a = await as('admin');
    const created = check('POST /api/v1/admin/webhooks', await a.post('/api/v1/admin/webhooks').send({ url: `${url}/ok`, events: ['webhook.test', 'quiz.submitted'] }));
    expect(keys(created.data)).toEqual(['createdAt', 'events', 'id', 'isActive', 'secret', 'url']);
    expect(created.data.secret).toMatch(/^whsec_/);
    id = created.data.id;
    secret = created.data.secret;
    expect((await a.post('/api/v1/admin/webhooks').send({ url: `${url}/x`, events: [] })).status).toBe(400);

    const list = await a.get('/api/v1/admin/webhooks');
    const body = check('GET /api/v1/admin/webhooks', list);
    expect(keys(body.data[0])).toEqual(['createdAt', 'events', 'id', 'isActive', 'url']);
    expect(JSON.stringify(body)).not.toContain(secret);

    const patched = check('PATCH /api/v1/admin/webhooks/:id', await a.patch(`/api/v1/admin/webhooks/${id}`).send({ isActive: false }));
    expect(keys(patched.data)).toEqual(['createdAt', 'events', 'id', 'isActive', 'url']);
    expect(patched.data.isActive).toBe(false);
    expect(JSON.stringify(patched)).not.toContain(secret);
    expect((await a.patch('/api/v1/admin/webhooks/nope').send({ isActive: true })).status).toBe(404);
  });

  it('records test deliveries (success, receiver error, unreachable)', async () => {
    const a = await as('admin');
    const test = check('POST /api/v1/admin/webhooks/:id/test', await a.post(`/api/v1/admin/webhooks/${id}/test`));
    expect(test.data).toEqual({ success: true, statusCode: 200, error: null });
    const bad = (await a.post('/api/v1/admin/webhooks').send({ url: `${url}/fail`, events: ['webhook.test'] })).body.data.id;
    const failed = check('POST /api/v1/admin/webhooks/:id/test', await a.post(`/api/v1/admin/webhooks/${bad}/test`));
    expect(failed.data).toEqual({ success: false, statusCode: 500, error: 'HTTP 500' });
    const dead = (await a.post('/api/v1/admin/webhooks').send({ url: 'http://127.0.0.1:1/nothing', events: ['webhook.test'] })).body.data.id;
    const unreachable = check('POST /api/v1/admin/webhooks/:id/test', await a.post(`/api/v1/admin/webhooks/${dead}/test`));
    expect(unreachable.data).toMatchObject({ success: false, statusCode: null });
    expect(typeof unreachable.data.error).toBe('string');

    // A failed delivery that may be retried keeps its request body for the worker.
    await admin.webhookDelivery.create({ data: { tenantId: 't-h', endpointId: id, event: 'quiz.submitted', success: false, statusCode: 500, error: 'HTTP 500', payload: '{"x":1}', nextAttemptAt: new Date() } });
    const deliveries = check('GET /api/v1/admin/webhooks/:id/deliveries', await a.get(`/api/v1/admin/webhooks/${id}/deliveries`));
    expect(deliveries.data.some((d: any) => d.payload !== null && d.nextAttemptAt !== null)).toBe(true);
    expect(deliveries.data.some((d: any) => d.success === true && d.statusCode === 200)).toBe(true);
    expect(JSON.stringify(deliveries)).not.toContain(secret);
    expect((await a.get('/api/v1/admin/webhooks/nope/deliveries')).status).toBe(404);
    // The secret does not appear in the audit trail either.
    expect(JSON.stringify((await a.get('/api/v1/admin/audit-logs?limit=100')).body)).not.toContain(secret);
  });

  it('deletes an endpoint', async () => {
    const a = await as('admin');
    const res = await a.delete(`/api/v1/admin/webhooks/${id}`);
    check('DELETE /api/v1/admin/webhooks/:id', res);
    expect((await a.delete(`/api/v1/admin/webhooks/${id}`)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe('SCIM tokens', () => {
  it('returns the bearer token once and never again', async () => {
    const a = await as('admin');
    const created = check('POST /api/v1/admin/scim-tokens', await a.post('/api/v1/admin/scim-tokens').send({ label: 'Directory sync' }));
    expect(keys(created.data)).toEqual(['id', 'label', 'token']);
    const token: string = created.data.token;
    expect(token.length).toBeGreaterThan(20);

    const list = check('GET /api/v1/admin/scim-tokens', await a.get('/api/v1/admin/scim-tokens'));
    expect(keys(list.data[0])).toEqual(['createdAt', 'id', 'label', 'revokedAt']);
    expect(JSON.stringify(list)).not.toContain(token);
    expect(JSON.stringify((await a.get('/api/v1/admin/audit-logs?limit=100')).body)).not.toContain(token);

    check('DELETE /api/v1/admin/scim-tokens/:id', await a.delete(`/api/v1/admin/scim-tokens/${created.data.id}`));
    expect((await a.delete(`/api/v1/admin/scim-tokens/${created.data.id}`)).status).toBe(404);
    const after = (await a.get('/api/v1/admin/scim-tokens')).body.data.find((t: any) => t.id === created.data.id);
    expect(after.revokedAt).toEqual(expect.any(String));
    expect(check('GET /api/v1/admin/scim-tokens', await a.get('/api/v1/admin/scim-tokens')).data.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe('OIDC single sign-on', () => {
  let idp: http.Server;
  let issuer: string;

  beforeAll(async () => {
    idp = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/.well-known/openid-configuration') {
        return void res.end(JSON.stringify({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` }));
      }
      res.statusCode = 404;
      res.end('{}');
    });
    await new Promise<void>((r) => idp.listen(0, '127.0.0.1', r));
    issuer = `http://127.0.0.1:${(idp.address() as any).port}`;
  });
  afterAll(() => new Promise<void>((r) => idp.close(() => r())));

  it('lists the redirect URIs before a connection exists, then never returns the client secret', async () => {
    const a = await as('admin');
    const empty = check('GET /api/v1/admin/sso', await a.get('/api/v1/admin/sso'));
    expect(empty.data).toBeNull();
    expect(empty.redirectUris.length).toBeGreaterThan(0);

    const put = check('PUT /api/v1/admin/sso', await a.put('/api/v1/admin/sso').send({ issuer, clientId: 'lms', clientSecret: CLIENT_SECRET, enabled: true, allowedDomains: ['x.edu'] }));
    expect(keys(put.data)).toEqual(['allowedDomains', 'autoCreateAccounts', 'clientId', 'enabled', 'hasSecret', 'issuer', 'redirectUris']);
    expect(JSON.stringify(put)).not.toContain(CLIENT_SECRET);

    const got = check('GET /api/v1/admin/sso', await a.get('/api/v1/admin/sso'));
    expect(keys(got.data)).toEqual(['allowedDomains', 'autoCreateAccounts', 'clientId', 'enabled', 'hasSecret', 'issuer', 'redirectUris']);
    expect(got.data.hasSecret).toBe(true);
    expect(JSON.stringify(got)).not.toContain(CLIENT_SECRET);
    expect(JSON.stringify((await a.get('/api/v1/admin/audit-logs?limit=100')).body)).not.toContain(CLIENT_SECRET);
    expect((await a.put('/api/v1/admin/sso').send({ issuer: 'http://127.0.0.1:1', clientId: 'lms', enabled: true, allowedDomains: [] })).status).toBe(400);
  });

  it('removes the connection', async () => {
    const a = await as('admin');
    check('DELETE /api/v1/admin/sso', await a.delete('/api/v1/admin/sso'));
    expect((await a.delete('/api/v1/admin/sso')).status).toBe(404);
    expect(check('GET /api/v1/admin/sso', await a.get('/api/v1/admin/sso')).data).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('SAML single sign-on', () => {
  const idpKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const body = (over: object = {}) => ({ entryPoint: 'https://idp.example.org/sso', idpIssuer: 'https://idp.example.org/metadata', idpCert: idpKey.publicKey, emailAttribute: 'email', enabled: true, allowedDomains: [], ...over });

  it('returns the pinned key only as a fingerprint', async () => {
    const a = await as('admin');
    const empty = check('GET /api/v1/admin/saml', await a.get('/api/v1/admin/saml'));
    expect(empty.data).toBeNull();
    expect(keys(empty.sp)).toEqual(['acsUrls', 'entityIds', 'metadataUrls']);

    const put = check('PUT /api/v1/admin/saml', await a.put('/api/v1/admin/saml').send(body()));
    expect(keys(put.data)).toEqual(['allowedDomains', 'autoCreateAccounts', 'emailAttribute', 'enabled', 'entryPoint', 'idpIssuer', 'keyExpires', 'keyFingerprint', 'keyKind']);
    expect(put.data).toMatchObject({ keyKind: 'PUBLIC KEY', keyExpires: null });
    expect(put.data.keyFingerprint).toMatch(/^[0-9a-f]{64}$/);

    const got = check('GET /api/v1/admin/saml', await a.get('/api/v1/admin/saml'));
    for (const text of [JSON.stringify(put), JSON.stringify(got), JSON.stringify((await a.get('/api/v1/admin/audit-logs?limit=100')).body)]) {
      expect(text).not.toMatch(/BEGIN (PUBLIC|PRIVATE)? ?KEY/);
      expect(text).not.toContain(idpKey.publicKey.split('\n')[1]);
    }
    expect((await a.put('/api/v1/admin/saml').send(body({ idpCert: idpKey.privateKey }))).status).toBe(400); // private keys are refused
  });

  it('removes the connection', async () => {
    const a = await as('admin');
    check('DELETE /api/v1/admin/saml', await a.delete('/api/v1/admin/saml'));
    expect((await a.delete('/api/v1/admin/saml')).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe('campuses, departments and compliance', () => {
  it('manages the hierarchy', async () => {
    const a = await as('admin');
    const campus = check('POST /api/v1/admin/campuses', await a.post('/api/v1/admin/campuses').send({ name: 'Main Campus', code: 'main' }));
    expect(campus.data.code).toBe('MAIN');
    expect((await a.post('/api/v1/admin/campuses').send({ name: 'Dup', code: 'MAIN' })).status).toBe(409);
    check('PATCH /api/v1/admin/campuses/:id', await a.patch(`/api/v1/admin/campuses/${campus.data.id}`).send({ name: 'Main Campus 2' }));

    const dept = check('POST /api/v1/admin/campuses/:id/departments', await a.post(`/api/v1/admin/campuses/${campus.data.id}/departments`).send({ name: 'Computing', code: 'cs' }));
    check('PATCH /api/v1/admin/departments/:id', await a.patch(`/api/v1/admin/departments/${dept.data.id}`).send({ name: 'Computer Science' }));
    await admin.course.update({ where: { id: 'c1' }, data: { departmentId: dept.data.id } });

    const list = check('GET /api/v1/admin/campuses', await a.get('/api/v1/admin/campuses'));
    expect(list.data[0]).toMatchObject({ code: 'MAIN', courseCount: 1, departments: [{ code: 'CS', name: 'Computer Science', courseCount: 1 }] });

    expect((await a.delete(`/api/v1/admin/campuses/${campus.data.id}`)).status).toBe(409); // still has departments
    expect((await a.delete(`/api/v1/admin/departments/${dept.data.id}`)).status).toBe(409); // still has a course
    await admin.course.update({ where: { id: 'c1' }, data: { departmentId: null } });
    check('DELETE /api/v1/admin/departments/:id', await a.delete(`/api/v1/admin/departments/${dept.data.id}`));
    check('DELETE /api/v1/admin/campuses/:id', await a.delete(`/api/v1/admin/campuses/${campus.data.id}`));
    expect((await a.delete(`/api/v1/admin/campuses/${campus.data.id}`)).status).toBe(404);
  });

  it('GET /admin/compliance', async () => {
    const body = check('GET /api/v1/admin/compliance', await (await as('admin')).get('/api/v1/admin/compliance'));
    expect(body.data.checks.map((c: any) => c.id)).toContain('tenant-isolation');
    expect(body.data.declarations).toMatchObject({ dataRegion: 'us-east-1' });
  });
});

// ---------------------------------------------------------------------------
describe('live classes', () => {
  let id: string;

  it('schedules, lists and reschedules', async () => {
    const t = await as('teacher');
    const created = check('POST /api/v1/courses/:courseId/live-sessions', await t.post('/api/v1/courses/c1/live-sessions').send({ title: 'Raft consensus', description: 'Leader election', scheduledAt: inFuture(60_000), durationMins: 90 }));
    id = created.data.id;
    expect(created.data).toMatchObject({ status: 'SCHEDULED', startedAt: null, endedAt: null, durationMins: 90 });
    expect(created.data).not.toHaveProperty('roomName');

    const staff = check('GET /api/v1/courses/:courseId/live-sessions', await t.get('/api/v1/courses/c1/live-sessions'));
    expect(staff.configured).toBe(true);
    expect(staff.data.find((s: any) => s.id === id)).toMatchObject({ attendeeCount: 0 });
    const learner = check('GET /api/v1/courses/:courseId/live-sessions', await (await as('s1')).get('/api/v1/courses/c1/live-sessions'));
    expect(learner.data.find((s: any) => s.id === id)).toMatchObject({ attended: false });
    expect(learner.data.find((s: any) => s.id === id)).not.toHaveProperty('attendeeCount');

    const mine = check('GET /api/v1/live-sessions/mine', await (await as('s1')).get('/api/v1/live-sessions/mine'));
    expect(mine.data.find((s: any) => s.id === id).course).toMatchObject({ id: 'c1', code: 'C1' });

    const patched = check('PATCH /api/v1/live-sessions/:id', await t.patch(`/api/v1/live-sessions/${id}`).send({ title: 'Raft, revisited' }));
    expect(patched.data.title).toBe('Raft, revisited');
  });

  it('starts, joins, reports attendance and ends', async () => {
    const t = await as('teacher');
    expect((await (await as('s1')).post(`/api/v1/live-sessions/${id}/join`)).status).toBe(409); // not live yet
    const started = check('POST /api/v1/live-sessions/:id/start', await t.post(`/api/v1/live-sessions/${id}/start`));
    expect(started.data).toMatchObject({ status: 'LIVE' });
    expect(started.data.startedAt).toEqual(expect.any(String));
    check('POST /api/v1/live-sessions/:id/start', await t.post(`/api/v1/live-sessions/${id}/start`)); // idempotent

    const host = check('POST /api/v1/live-sessions/:id/join', await t.post(`/api/v1/live-sessions/${id}/join`));
    expect(host.data).toMatchObject({ url: LK_URL, role: 'HOST', canPublish: true });
    expect(keys(host.data)).toEqual(['canPublish', 'role', 'roomName', 'token', 'url']);
    const learner = check('POST /api/v1/live-sessions/:id/join', await (await as('s1')).post(`/api/v1/live-sessions/${id}/join`));
    expect(learner.data).toMatchObject({ role: 'LEARNER', canPublish: false });
    expect(JSON.stringify(learner)).not.toContain(LK_SECRET); // the token is signed with it, but the secret itself never leaves

    const att = check('GET /api/v1/live-sessions/:id/attendance', await t.get(`/api/v1/live-sessions/${id}/attendance`));
    expect(att.summary.enrolled).toBe(2);
    expect(att.data.find((r: any) => r.userId === 's1')).toMatchObject({ joinCount: 1, inRoomNow: false });
    expect((await (await as('s1')).get(`/api/v1/live-sessions/${id}/attendance`)).status).toBe(403);

    const ended = check('POST /api/v1/live-sessions/:id/end', await t.post(`/api/v1/live-sessions/${id}/end`));
    expect(ended.data).toMatchObject({ status: 'ENDED' });
    expect(ended.data.endedAt).toEqual(expect.any(String));
    expect((await t.post(`/api/v1/live-sessions/${id}/end`)).status).toBe(409);
  });

  it('cancels a class that has not started', async () => {
    const t = await as('teacher');
    const made = await t.post('/api/v1/courses/c1/live-sessions').send({ title: 'Cancel me', scheduledAt: inFuture(3_600_000) });
    const res = check('POST /api/v1/live-sessions/:id/cancel', await t.post(`/api/v1/live-sessions/${made.body.data.id}/cancel`));
    expect(res.data).toEqual({ id: made.body.data.id, status: 'CANCELLED' });
  });
});

// ---------------------------------------------------------------------------
describe('two-factor authentication', () => {
  it('shows the secret and recovery codes once each, and never in the status', async () => {
    const u = await as('mfauser');
    const before = check('GET /api/v1/auth/mfa/status', await u.get('/api/v1/auth/mfa/status'));
    expect(before.data).toEqual({ enabled: false, recoveryCodesRemaining: 0, hasPassword: true });

    const setup = check('POST /api/v1/auth/mfa/setup', await u.post('/api/v1/auth/mfa/setup'));
    expect(keys(setup.data)).toEqual(['otpauthUrl', 'secret']);
    const secret: string = setup.data.secret;
    expect(setup.data.otpauthUrl).toContain(`secret=${secret}`);
    expect(JSON.stringify(await u.get('/api/v1/auth/mfa/status').then((r) => r.body))).not.toContain(secret);

    expect((await u.post('/api/v1/auth/mfa/enable').send({ code: '000000' })).status).toBe(400);
    const enable = check('POST /api/v1/auth/mfa/enable', await u.post('/api/v1/auth/mfa/enable').send({ code: totp(secret) }));
    expect(keys(enable.data)).toEqual(['enabled', 'recoveryCodes']);
    expect(enable.data.recoveryCodes).toHaveLength(8);
    expect(JSON.stringify(enable)).not.toContain(secret);

    const status = check('GET /api/v1/auth/mfa/status', await u.get('/api/v1/auth/mfa/status'));
    expect(status.data).toEqual({ enabled: true, recoveryCodesRemaining: 8, hasPassword: true });
    const me = JSON.stringify((await u.get('/api/v1/auth/me')).body);
    expect(me).not.toContain(secret);
    for (const c of enable.data.recoveryCodes) expect(me).not.toContain(c);
    expect((await u.post('/api/v1/auth/mfa/setup')).status).toBe(409);

    expect((await u.post('/api/v1/auth/mfa/disable').send({ password: 'wrong', code: totp(secret) })).status).toBe(401);
    const off = check('POST /api/v1/auth/mfa/disable', await u.post('/api/v1/auth/mfa/disable').send({ password: pw('harvard'), code: enable.data.recoveryCodes[0] }));
    expect(off.data).toEqual({ enabled: false });
    expect(JSON.stringify((await admin.auditLog.findMany({ where: { userId: 'mfauser' } })))).not.toContain(secret);
  });
});

// ---------------------------------------------------------------------------
describe('organisation registration and the platform operator', () => {
  const ask = (slug: string) => ({
    organizationName: `College ${slug}`, slug, institutionType: 'COLLEGE', contactFirstName: 'Ann', contactLastName: 'Lee', contactEmail: `ann@${slug}.edu`, acceptTerms: true,
  });

  const outbox: { to: string; text: string }[] = [];
  const confirm = async (slug: string) => {
    const mail = outbox.find((m) => m.to === `ann@${slug}.edu`)!;
    const token = decodeURIComponent(mail.text.match(/confirm=([^\s]+)/)![1]);
    return check('POST /api/v1/organizations/requests/confirm', await request(app).post('/api/v1/organizations/requests/confirm').send({ token }));
  };

  it('public: availability, lookup, requests and confirming them', async () => {
    (await import('../src/lib/mailer.js')).setMailer({ async send(m) { outbox.push(m); } });
    const free = check('GET /api/v1/organizations/availability', await request(app).get('/api/v1/organizations/availability?slug=contract-college'));
    expect(free.data).toMatchObject({ slug: 'contract-college', available: true });
    expect(typeof free.data.url).toBe('string');
    // No CAPTCHA configured in tests: the register page is told there is none.
    expect(check('GET /api/v1/organizations/captcha', await request(app).get('/api/v1/organizations/captcha')).data).toEqual({ siteKey: null });
    const found = check('GET /api/v1/organizations/lookup', await request(app).get('/api/v1/organizations/lookup?slug=harvard'));
    expect(found.data).toEqual({ slug: 'harvard', name: 'Harvard U' });
    const sent = check('POST /api/v1/organizations/requests', await request(app).post('/api/v1/organizations/requests').send(ask('contract-college')));
    expect(sent.data).toMatchObject({ status: 'UNVERIFIED', slug: 'contract-college', contactEmail: 'ann@contract-college.edu' });
    check('POST /api/v1/organizations/requests', await request(app).post('/api/v1/organizations/requests').send(ask('contract-other')));
    expect((await confirm('contract-college')).data).toMatchObject({ status: 'PENDING', slug: 'contract-college' });
    await confirm('contract-other');
  });

  it('operator: list, approve, reject, create and suspend', async () => {
    const op = await as('operator', 'ops');
    const pending = check('GET /api/v1/operator/requests', await op.get('/api/v1/operator/requests'));
    expect(pending.pagination).toMatchObject({ page: 1, total: 2 });
    const one = pending.data.find((r: any) => r.slug === 'contract-college');
    const other = pending.data.find((r: any) => r.slug === 'contract-other');
    const approved = check('POST /api/v1/operator/requests/:id/approve', await op.post(`/api/v1/operator/requests/${one.id}/approve`).send({ tier: 'PROFESSIONAL', seatQuota: 20 }));
    expect(approved.data.organization).toMatchObject({ slug: 'contract-college', tier: 'PROFESSIONAL', seatQuota: 20, seatsUsed: 1, status: 'ACTIVE' });
    expect(approved.data.request).toMatchObject({ status: 'APPROVED', createdTenantId: approved.data.organization.id, decidedByEmail: 'operator@x.edu' });
    const rejected = check('POST /api/v1/operator/requests/:id/reject', await op.post(`/api/v1/operator/requests/${other.id}/reject`).send({ reason: 'Not an eligible institution.' }));
    expect(rejected.data).toMatchObject({ status: 'REJECTED', decisionNote: 'Not an eligible institution.' });

    const made = check('POST /api/v1/operator/tenants', await op.post('/api/v1/operator/tenants').send({ name: 'Direct College', slug: 'contract-direct', adminFirstName: 'Bo', adminLastName: 'Ray', adminEmail: 'bo@direct.edu' }), 201);
    expect(made.data.organization).toMatchObject({ slug: 'contract-direct', tier: 'STARTER', seatQuota: 100 });
    const off = check('PATCH /api/v1/operator/tenants/:id/status', await op.patch(`/api/v1/operator/tenants/${made.data.organization.id}/status`).send({ status: 'SUSPENDED' }));
    expect(off.data.status).toBe('SUSPENDED');
    check('PATCH /api/v1/operator/tenants/:id/status', await op.patch(`/api/v1/operator/tenants/${made.data.organization.id}/status`).send({ status: 'ACTIVE' }));
  });
});

describe('custom domains', () => {
  // DNS answers, by record name; the TXT lookup is the whole proof of ownership.
  const txt: Record<string, string[]> = {};
  beforeAll(async () => {
    const notFound = () => Promise.reject(Object.assign(new Error('not found'), { code: 'ENOTFOUND' }));
    (await import('../src/lib/custom-domain.js')).setDnsResolver({
      resolveTxt: (name) => (txt[name] ? Promise.resolve(txt[name].map((v) => [v])) : notFound()),
      resolveCname: notFound,
      resolve4: notFound,
      resolve6: notFound,
    });
  });

  it('administrators: ask, verify and remove', async () => {
    const a = await as('admin');
    expect(check('GET /api/v1/admin/custom-domain', await a.get('/api/v1/admin/custom-domain')).data.pending).toBeNull();
    const asked = check('PUT /api/v1/admin/custom-domain', await a.put('/api/v1/admin/custom-domain').send({ domain: 'learn.contract-harvard.edu' }));
    const { txtName, txtValue } = asked.data.pending;
    const failed = check('POST /api/v1/admin/custom-domain/verify', await a.post('/api/v1/admin/custom-domain/verify'));
    expect(failed.data.check).toMatchObject({ verified: false });
    txt[txtName] = [txtValue];
    const live = check('POST /api/v1/admin/custom-domain/verify', await a.post('/api/v1/admin/custom-domain/verify'));
    expect(live.data).toMatchObject({ customDomain: 'learn.contract-harvard.edu', pending: null, check: { verified: true } });

    const tls = (domain: string) => request(app).get(`/internal/tls/allowed?domain=${domain}`).set('x-tls-ask-secret', 'tls-ask-secret-for-contract-tests');
    check('GET /internal/tls/allowed', await tls('learn.contract-harvard.edu'));
    check('GET /internal/tls/allowed', await tls('unknown.example.org'), 404);

    expect(check('DELETE /api/v1/admin/custom-domain', await a.delete('/api/v1/admin/custom-domain')).data.customDomain).toBeNull();
  });

  it('operator: the same for any organisation', async () => {
    const op = await as('operator', 'ops');
    check('GET /api/v1/operator/tenants/:id/custom-domain', await op.get('/api/v1/operator/tenants/t-h/custom-domain'));
    const asked = check('PUT /api/v1/operator/tenants/:id/custom-domain', await op.put('/api/v1/operator/tenants/t-h/custom-domain').send({ domain: 'lms.contract-harvard.edu' }));
    txt[asked.data.pending.txtName] = [asked.data.pending.txtValue];
    expect(check('POST /api/v1/operator/tenants/:id/custom-domain/verify', await op.post('/api/v1/operator/tenants/t-h/custom-domain/verify')).data.check.verified).toBe(true);
    expect(check('DELETE /api/v1/operator/tenants/:id/custom-domain', await op.delete('/api/v1/operator/tenants/t-h/custom-domain')).data.customDomain).toBeNull();
  });
});

describe('trials', () => {
  it('administrators see where their trial stands; the operator starts, extends, ends and converts it', async () => {
    await admin.tenant.create({ data: { id: 't-trial', slug: 'contract-trial', name: 'Trial College', tier: 'STARTER' } });
    const a = await as('admin');
    expect(check('GET /api/v1/trial', await a.get('/api/v1/trial')).data.state).toBe('NONE');

    const op = await as('operator', 'ops');
    expect(check('GET /api/v1/operator/trial-settings', await op.get('/api/v1/operator/trial-settings')).data).toMatchObject({ defaultDays: 0 });
    expect(check('POST /api/v1/operator/tenants/:id/trial', await op.post('/api/v1/operator/tenants/t-trial/trial').send({ days: 14 })).data.status).toBe('TRIAL');
    check('PATCH /api/v1/operator/tenants/:id/trial', await op.patch('/api/v1/operator/tenants/t-trial/trial').send({ days: 7 }));
    expect(check('POST /api/v1/operator/tenants/:id/trial/end', await op.post('/api/v1/operator/tenants/t-trial/trial/end')).data.trialExpiredAt).toBeTruthy();
    const paid = check('POST /api/v1/operator/tenants/:id/trial/convert', await op.post('/api/v1/operator/tenants/t-trial/trial/convert'));
    expect(paid.data).toMatchObject({ status: 'ACTIVE', trialEndsAt: null, trialExpiredAt: null });
  });
});

describe('coverage', () => {
  it('exercised every operation in the table', () => {
    const missing = Object.keys(RESPONSES).filter((k) => !covered.has(k));
    expect(missing).toEqual([]);
  });
});
