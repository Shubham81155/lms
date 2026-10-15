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
  // An audit row whose acting user no longer exists.
  await admin.auditLog.create({ data: { tenantId: 't-h', userId: null, action: 'SEEDED_ORPHAN', resourceType: 'TENANT', diffJson: { a: 1 } } });
}

beforeAll(async () => {
  process.env.LIVEKIT_URL = LK_URL;
  process.env.LIVEKIT_API_KEY = 'APIkeyForTests';
  process.env.LIVEKIT_API_SECRET = LK_SECRET;
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

async function as(who: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').set('x-tenant-id', 'harvard').send({ email: `${who}@x.edu`, password: pw('harvard') });
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
  it('GET/PUT /admin/features', async () => {
    const a = await as('admin');
    const got = check('GET /api/v1/admin/features', await a.get('/api/v1/admin/features'));
    expect(got.data).toMatchObject({ sso: true, webhooks: true, scim: true });
    expect(keys(got.data)).toEqual(['aiProctoring', 'lti13', 'scim', 'scorm', 'sso', 'webhooks', 'xapi']);
    const put = check('PUT /api/v1/admin/features', await a.put('/api/v1/admin/features').send({ aiProctoring: false }));
    expect(put.data.aiProctoring).toBe(false);
    expect((await a.put('/api/v1/admin/features').send({})).status).toBe(400);
  });

  it('GET /admin/usage and PUT /admin/usage/quota', async () => {
    const a = await as('admin');
    const usage = check('GET /api/v1/admin/usage', await a.get('/api/v1/admin/usage'));
    expect(usage.data).toMatchObject({ tier: 'ENTERPRISE', seats: { used: 7, quota: null, remaining: null }, totals: { courses: 1, enrollments: 2, certificates: 1 } });
    const set = check('PUT /api/v1/admin/usage/quota', await a.put('/api/v1/admin/usage/quota').send({ seatQuota: 50 }));
    expect(set.data).toEqual({ seatQuota: 50 });
    expect((await a.get('/api/v1/admin/usage')).body.data.seats).toMatchObject({ quota: 50, remaining: 43 });
    expect((await a.put('/api/v1/admin/usage/quota').send({ seatQuota: 1 })).status).toBe(409);
    expect((await a.put('/api/v1/admin/usage/quota').send({ seatQuota: null })).body.data).toEqual({ seatQuota: null });
  });

  it('GET /admin/export contains the documented sections and no credentials', async () => {
    const res = await (await as('admin')).get('/api/v1/admin/export');
    const body = check('GET /api/v1/admin/export', res);
    expect(res.headers['content-disposition']).toContain('tenant-export-harvard.json');
    expect(keys(body)).toEqual(['campuses', 'certificates', 'courses', 'enrollments', 'exportedAt', 'tenant', 'users']);
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
    expect(keys(put.data)).toEqual(['allowedDomains', 'clientId', 'enabled', 'hasSecret', 'issuer', 'redirectUris']);
    expect(JSON.stringify(put)).not.toContain(CLIENT_SECRET);

    const got = check('GET /api/v1/admin/sso', await a.get('/api/v1/admin/sso'));
    expect(keys(got.data)).toEqual(['allowedDomains', 'clientId', 'enabled', 'hasSecret', 'issuer', 'redirectUris']);
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
    expect(keys(put.data)).toEqual(['allowedDomains', 'emailAttribute', 'enabled', 'entryPoint', 'idpIssuer', 'keyExpires', 'keyFingerprint', 'keyKind']);
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
    expect(before.data).toEqual({ enabled: false, recoveryCodesRemaining: 0 });

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
    expect(status.data).toEqual({ enabled: true, recoveryCodesRemaining: 8 });
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
describe('coverage', () => {
  it('exercised every operation in the table', () => {
    const missing = Object.keys(RESPONSES).filter((k) => !covered.has(k));
    expect(missing).toEqual([]);
  });
});
