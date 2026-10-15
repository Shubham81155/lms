import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// Personal-data export, FERPA directory opt-out and erasure, against a real PostgreSQL with the
// real migrations and row-level security.

const PASSWORD = 'CorrectHorse1!';
let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;
let R: typeof import('../src/openapi/responses/identity.js');
const pw = (slug: string) => `${PASSWORD}-${slug}`;

async function seed() {
  for (const [id, slug] of [['t-h', 'harvard'], ['t-m', 'mit']]) await admin.tenant.create({ data: { id, slug, name: slug } });
  const user = (id: string, tenantId: string, slug: string, role: any) =>
    admin.user.create({ data: { id, tenantId, email: `${id}@x.edu`, firstName: id, lastName: 'Lovelace', role, passwordHash: bcrypt.hashSync(pw(slug), 4), emailVerified: true } });
  await user('admin', 't-h', 'harvard', 'TENANT_ADMIN');
  await user('admin2', 't-h', 'harvard', 'TENANT_ADMIN');
  await user('teacher', 't-h', 'harvard', 'INSTRUCTOR');
  for (const s of ['s1', 's2', 's3']) await user(s, 't-h', 'harvard', 'STUDENT');
  await user('m-admin', 't-m', 'mit', 'TENANT_ADMIN');
  await user('m-student', 't-m', 'mit', 'STUDENT');

  await admin.course.create({ data: { id: 'c1', tenantId: 't-h', code: 'C1', title: 'Course c1', status: 'PUBLISHED' } });
  await admin.courseInstructor.create({ data: { courseId: 'c1', userId: 'teacher', isPrimary: true } });
  for (const s of ['s1', 's2', 's3']) {
    await admin.enrollment.create({ data: { id: `e-${s}`, tenantId: 't-h', courseId: 'c1', userId: s, status: 'IN_PROGRESS', progressPercent: 50 } });
    await admin.userGamification.create({ data: { tenantId: 't-h', userId: s, xp: 100 } });
  }
  await admin.assignment.create({ data: { id: 'a1', tenantId: 't-h', courseId: 'c1', title: 'Essay', instructions: 'Write', maxPoints: 100 } });
  await admin.assignmentSubmission.create({ data: { id: 'as-1', assignmentId: 'a1', userId: 's1', submissionText: 'my private essay', fileUrl: 'https://files.example/s1.pdf', grade: 88, gradedAt: new Date() } });
  await admin.notification.create({ data: { tenantId: 't-h', userId: 's1', category: 'GRADE', title: 'Graded', body: 'You got 88' } });
  await admin.xapiStatement.create({
    data: { id: 'x-1', tenantId: 't-h', actorUserId: 's1', verbId: 'http://adlnet.gov/expapi/verbs/completed', objectId: 'urn:course:c1', timestamp: new Date(), statementJson: { actor: { name: 's1 Lovelace', mbox: 'mailto:s1@x.edu' }, verb: { id: 'completed' }, object: { id: 'urn:course:c1' } } },
  });
  await admin.forumThread.create({ data: { id: 'ft-1', tenantId: 't-h', courseId: 'c1', authorId: 's1', title: 'Help with my address 12 Elm St', body: 'Call me on 555-0100' } });
}

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  await seed();
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
  R = await import('../src/openapi/responses/identity.js');
}, 240_000);

afterAll(async () => {
  await admin?.$disconnect();
  await db?.stop();
}, 60_000);

async function as(who: string, tenant: 'harvard' | 'mit' = 'harvard') {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').set('x-tenant-id', tenant).send({ email: `${who}@x.edu`, password: pw(tenant) });
  expect(res.status, `login as ${who}`).toBe(200);
  return agent;
}

const matches = (key: string, body: unknown) => {
  const doc = R.RESPONSES[key].response!;
  const parsed = doc.schema!.safeParse(body);
  expect(parsed.success, `${key}: ${JSON.stringify(parsed.success ? null : parsed.error)}`).toBe(true);
};

describe('personal data export', () => {
  it('gives a learner everything held about them, as a download', async () => {
    const s1 = await as('s1');
    const res = await s1.get('/api/v1/privacy/me/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    matches('GET /api/v1/privacy/me/export', res.body);
    expect(res.body.profile).toMatchObject({ id: 's1', email: 's1@x.edu' });
    expect(res.body.assignmentSubmissions[0]).toMatchObject({ submissionText: 'my private essay', grade: 88 });
    expect(res.body.notifications).toHaveLength(1);
    expect(res.body.forum.threads[0].title).toContain('Elm St');
    expect(res.body.learningActivity).toHaveLength(1);
    expect(res.body.accountActivity.some((a: any) => a.action === 'USER_LOGIN' || a.action === 'PERSONAL_DATA_EXPORTED')).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|mfaSecret|\$2[aby]\$/);
  });

  it("never exposes someone else's data, and only administrators can export other people", async () => {
    expect((await (await as('s2')).get('/api/v1/privacy/users/s1/export')).status).toBe(403);
    expect((await (await as('teacher')).get('/api/v1/privacy/users/s1/export')).status).toBe(403);
    const res = await (await as('admin')).get('/api/v1/privacy/users/s1/export');
    expect(res.status).toBe(200);
    expect(res.body.profile.id).toBe('s1');
    expect((await (await as('m-admin', 'mit')).get('/api/v1/privacy/users/s1/export')).status).toBe(404); // other tenant
    expect((await request(app).get('/api/v1/privacy/me/export')).status).toBe(401);
  });
});

describe('FERPA directory opt-out', () => {
  const board = async (who: string) => {
    const res = await (await as(who)).get('/api/v1/gamification/leaderboard?courseId=c1');
    expect(res.status).toBe(200);
    return Object.fromEntries(res.body.data.map((r: any) => [r.userId, r.name]));
  };

  it('hides the name from classmates but not from staff or the person', async () => {
    const s2 = await as('s2');
    expect((await s2.get('/api/v1/privacy/me/directory')).body.data.optOut).toBe(false);
    const put = await s2.put('/api/v1/privacy/me/directory').send({ optOut: true });
    expect(put.status).toBe(200);
    matches('PUT /api/v1/privacy/me/directory', put.body);
    expect((await s2.get('/api/v1/privacy/me/directory')).body.data.optOut).toBe(true);

    expect((await board('s3')).s2).toBe('Anonymous learner');
    expect((await board('s3')).s1).toBe('s1 L.');
    expect((await board('s2')).s2).toBe('s2 L.');
    expect((await board('teacher')).s2).toBe('s2 L.');
  });

  it('validates the body', async () => {
    expect((await (await as('s3')).put('/api/v1/privacy/me/directory').send({ optOut: 'yes' })).status).toBe(400);
  });
});

describe('erasure', () => {
  it('needs the password and the e-mail address', async () => {
    const s1 = await as('s1');
    expect((await s1.post('/api/v1/privacy/me/erase').send({ confirmEmail: 's1@x.edu' })).status).toBe(403);
    expect((await s1.post('/api/v1/privacy/me/erase').send({ confirmEmail: 's1@x.edu', password: 'wrong' })).status).toBe(403);
    expect((await s1.post('/api/v1/privacy/me/erase').send({ confirmEmail: 'other@x.edu', password: pw('harvard') })).status).toBe(400);
    expect((await admin.user.findUniqueOrThrow({ where: { id: 's1' } })).erasedAt).toBeNull();
  });

  it('anonymises the person, keeps the grade and ends every session', async () => {
    const s1 = await as('s1');
    const res = await s1.post('/api/v1/privacy/me/erase').send({ confirmEmail: 'S1@x.edu', password: pw('harvard') });
    expect(res.status).toBe(200);
    matches('POST /api/v1/privacy/me/erase', res.body);

    const u = await admin.user.findUniqueOrThrow({ where: { id: 's1' } });
    expect(u).toMatchObject({ email: 'erased-s1@erased.invalid', firstName: 'Erased', passwordHash: null, status: 'SUSPENDED' });
    expect(u.erasedAt).not.toBeNull();

    const sub = await admin.assignmentSubmission.findUniqueOrThrow({ where: { id: 'as-1' } });
    expect(sub).toMatchObject({ grade: 88, submissionText: null, fileUrl: null });
    expect(await admin.notification.count({ where: { userId: 's1' } })).toBe(0);
    const thread = await admin.forumThread.findUniqueOrThrow({ where: { id: 'ft-1' } });
    expect(thread).toMatchObject({ title: '[removed]', body: '[removed]', hidden: true });
    const stmt = await admin.xapiStatement.findUniqueOrThrow({ where: { id: 'x-1' } });
    expect(JSON.stringify(stmt.statementJson)).not.toContain('s1@x.edu');
    expect((stmt.statementJson as any).verb.id).toBe('completed');

    // The existing token and a fresh login both stop working.
    expect((await s1.get('/api/v1/auth/me')).status).toBe(401);
    const login = await request(app).post('/api/v1/auth/login').set('x-tenant-id', 'harvard').send({ email: 's1@x.edu', password: pw('harvard') });
    expect(login.status).toBe(401);

    const audit = await admin.auditLog.findFirst({ where: { action: 'USER_ERASED', resourceId: 's1' } });
    expect(audit).toBeTruthy();
    // Erased people vanish from classmates' view of the leaderboard names too.
    const board = await (await as('s3')).get('/api/v1/gamification/leaderboard?courseId=c1');
    expect(board.body.data.find((r: any) => r.userId === 's1').name).toBe('Anonymous learner');
  });

  it('lets an administrator erase someone on request, with guard rails', async () => {
    const a = await as('admin');
    expect((await a.post('/api/v1/privacy/users/admin/erase').send({})).status).toBe(400); // own account: use /me/erase
    expect((await a.post('/api/v1/privacy/users/nobody/erase').send({})).status).toBe(404);
    expect((await a.post('/api/v1/privacy/users/m-student/erase').send({})).status).toBe(404); // other tenant
    expect((await (await as('teacher')).post('/api/v1/privacy/users/s3/erase').send({})).status).toBe(403);

    const res = await a.post('/api/v1/privacy/users/s3/erase').send({});
    expect(res.status).toBe(200);
    matches('POST /api/v1/privacy/users/:id/erase', res.body);
    expect((await admin.user.findUniqueOrThrow({ where: { id: 's3' } })).erasedAt).not.toBeNull();
    expect((await admin.auditLog.findFirst({ where: { action: 'USER_ERASED', resourceId: 's3' } }))?.userId).toBe('admin');
  });

  it('refuses to erase the only active administrator', async () => {
    const res = await (await as('m-admin', 'mit')).post('/api/v1/privacy/me/erase').send({ confirmEmail: 'm-admin@x.edu', password: pw('mit') });
    expect(res.status).toBe(409);
    expect((await admin.user.findUniqueOrThrow({ where: { id: 'm-admin' } })).erasedAt).toBeNull();
  });
});
