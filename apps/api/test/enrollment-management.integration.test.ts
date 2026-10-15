import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// Staff enrolling people (by account or by email address) and withdrawing them, plus a learner
// leaving a course, against a real PostgreSQL with the real migrations and row-level security.

const PASSWORD = 'CorrectHorse1!';
let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  for (const [id, slug] of [['t-h', 'harvard'], ['t-m', 'mit']]) await admin.tenant.create({ data: { id, slug, name: slug } });
  const user = (id: string, tenantId: string, role: any, extra: object = {}) =>
    admin.user.create({ data: { id, tenantId, email: `${id}@x.edu`, firstName: id, lastName: 'Lovelace', role, passwordHash: bcrypt.hashSync(`${PASSWORD}-${tenantId}`, 4), emailVerified: true, ...extra } });
  await user('admin', 't-h', 'TENANT_ADMIN');
  await user('teacher', 't-h', 'INSTRUCTOR');
  await user('teacher2', 't-h', 'INSTRUCTOR');
  await user('ta', 't-h', 'TEACHING_ASSISTANT');
  for (const s of ['s1', 's2', 's3', 's4', 's5']) await user(s, 't-h', 'STUDENT');
  await user('pending', 't-h', 'STUDENT', { status: 'INVITED' });
  await user('m-student', 't-m', 'STUDENT');

  await admin.course.create({ data: { id: 'c1', tenantId: 't-h', code: 'C1', title: 'Course c1', status: 'PUBLISHED' } });
  await admin.course.create({ data: { id: 'c2', tenantId: 't-h', code: 'C2', title: 'Course c2', status: 'PUBLISHED' } });
  await admin.courseInstructor.createMany({ data: [{ courseId: 'c1', userId: 'teacher', isPrimary: true }, { courseId: 'c1', userId: 'ta' }, { courseId: 'c2', userId: 'teacher2', isPrimary: true }] });
  await admin.module.create({ data: { id: 'mod1', courseId: 'c1', title: 'M1' } });
  await admin.lesson.create({ data: { id: 'les1', moduleId: 'mod1', title: 'L1' } });
  await admin.lesson.create({ data: { id: 'les2', moduleId: 'mod1', title: 'L2', orderIndex: 1 } });
  const enrol = (id: string, userId: string, status: any = 'IN_PROGRESS', progress = 50) =>
    admin.enrollment.create({ data: { id, tenantId: 't-h', courseId: 'c1', userId, status, progressPercent: progress } });
  await enrol('e-s1', 's1');
  await enrol('e-s2', 's2');
  await enrol('e-s3', 's3', 'COMPLETED', 100);
  await admin.lessonProgress.create({ data: { tenantId: 't-h', courseId: 'c1', userId: 's1', lessonId: 'les1' } });
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
}, 240_000);

afterAll(async () => {
  await admin?.$disconnect();
  await db?.stop();
}, 60_000);

async function as(who: string, tenant: 'harvard' | 'mit' = 'harvard') {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').set('x-tenant-id', tenant).send({ email: `${who}@x.edu`, password: `${PASSWORD}-${tenant === 'harvard' ? 't-h' : 't-m'}` });
  expect(res.status, `login as ${who}`).toBe(200);
  return agent;
}

describe('enrolling someone else', () => {
  it('lets the course instructor enroll a person by email address, in any letter case', async () => {
    const res = await (await as('teacher')).post('/api/v1/enrollments').send({ courseId: 'c1', email: 'S4@X.edu' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ userId: 's4', status: 'ENROLLED', progressPercent: 0 });
  });

  it('also accepts an account id, but not both, and not a stranger', async () => {
    const t = await as('teacher');
    expect((await t.post('/api/v1/enrollments').send({ courseId: 'c1', userId: 's5' })).status).toBe(201);
    expect((await t.post('/api/v1/enrollments').send({ courseId: 'c1', userId: 's5', email: 's5@x.edu' })).status).toBe(400);
    const unknown = await t.post('/api/v1/enrollments').send({ courseId: 'c1', email: 'nobody@x.edu' });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toMatch(/email address/);
    expect((await t.post('/api/v1/enrollments').send({ courseId: 'c1', email: 'm-student@x.edu' })).status).toBe(404); // another organisation
  });

  it('refuses people who are already enrolled or have not joined yet', async () => {
    const t = await as('teacher');
    expect((await t.post('/api/v1/enrollments').send({ courseId: 'c1', email: 's1@x.edu' })).status).toBe(409);
    expect((await t.post('/api/v1/enrollments').send({ courseId: 'c1', email: 'pending@x.edu' })).status).toBe(400);
  });

  it('is for administrators and the assigned instructor only', async () => {
    expect((await (await as('ta')).post('/api/v1/enrollments').send({ courseId: 'c1', email: 's4@x.edu' })).status).toBe(403);
    expect((await (await as('teacher2')).post('/api/v1/enrollments').send({ courseId: 'c1', email: 's4@x.edu' })).status).toBe(403);
    expect((await (await as('s2')).post('/api/v1/enrollments').send({ courseId: 'c1', email: 's4@x.edu' })).status).toBe(403);
    const byAdmin = await (await as('admin')).post('/api/v1/enrollments').send({ courseId: 'c2', email: 's2@x.edu' });
    expect(byAdmin.status).toBe(201);
  });
});

describe('withdrawing', () => {
  it('lets a learner leave their own course, keeping the record', async () => {
    const res = await (await as('s2')).delete('/api/v1/enrollments/e-s2');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: 'e-s2', status: 'DROPPED' });
    expect(await admin.enrollment.findUnique({ where: { id: 'e-s2' } })).toMatchObject({ status: 'DROPPED', progressPercent: 50 });
    expect(await admin.auditLog.count({ where: { action: 'USER_UNENROLLED' } })).toBeGreaterThan(0);
  });

  it('takes away access to the course content', async () => {
    expect((await (await as('s2')).get('/api/v1/courses/c1/modules')).status).toBe(403);
    expect((await (await as('s1')).get('/api/v1/courses/c1/modules')).status).toBe(200);
  });

  it('is repeatable only once, and never for finished enrollments', async () => {
    expect((await (await as('s2')).delete('/api/v1/enrollments/e-s2')).status).toBe(409);
    const done = await (await as('s3')).delete('/api/v1/enrollments/e-s3');
    expect(done.status).toBe(409);
    expect(done.body.error).toMatch(/record/);
  });

  it("does not let people remove each other, except an administrator or the course's instructor", async () => {
    expect((await (await as('s1')).delete('/api/v1/enrollments/e-s4-nope')).status).toBe(404);
    const s4 = await admin.enrollment.findFirst({ where: { userId: 's4', courseId: 'c1' } });
    expect((await (await as('s1')).delete(`/api/v1/enrollments/${s4!.id}`)).status).toBe(404); // another learner's
    expect((await (await as('ta')).delete(`/api/v1/enrollments/${s4!.id}`)).status).toBe(404); // assistants cannot
    expect((await (await as('teacher2')).delete(`/api/v1/enrollments/${s4!.id}`)).status).toBe(404); // not their course
    expect((await (await as('m-student', 'mit')).delete(`/api/v1/enrollments/${s4!.id}`)).status).toBe(404); // other organisation
    expect((await (await as('teacher')).delete(`/api/v1/enrollments/${s4!.id}`)).status).toBe(200);
    expect((await request(app).delete(`/api/v1/enrollments/${s4!.id}`)).status).toBe(401);
  });
});

describe('enrolling again after withdrawing', () => {
  it('picks up where the person left off: progress and finished lessons are kept', async () => {
    expect(await admin.lessonProgress.count({ where: { userId: 's1', courseId: 'c1' } })).toBe(1);
    expect((await (await as('s1')).delete('/api/v1/enrollments/e-s1')).status).toBe(200);
    expect((await (await as('s1')).get('/api/v1/courses/c1/progress')).status).toBe(403); // no access while withdrawn

    // The course grows while they are away, so the percentage is re-derived when they return.
    await admin.lesson.create({ data: { id: 'les3', moduleId: 'mod1', title: 'L3', orderIndex: 2 } });
    const again = await (await as('teacher')).post('/api/v1/enrollments').send({ courseId: 'c1', email: 's1@x.edu' });
    expect(again.status).toBe(201);
    expect(again.body.data).toMatchObject({ id: 'e-s1', status: 'IN_PROGRESS', progressPercent: 33 }); // 1 of 3 lessons
    expect(await admin.lessonProgress.count({ where: { userId: 's1', courseId: 'c1' } })).toBe(1);
    expect((await (await as('s1')).get('/api/v1/courses/c1/progress')).body.data).toMatchObject({ completedLessonIds: ['les1'], progressPercent: 33 });
  });

  it('puts someone who had not started back to enrolled, not in progress', async () => {
    const s4 = await admin.enrollment.findFirst({ where: { userId: 's4', courseId: 'c1' } });
    expect(s4).toMatchObject({ status: 'DROPPED', progressPercent: 0 }); // removed earlier in this file
    const again = await (await as('teacher')).post('/api/v1/enrollments').send({ courseId: 'c1', email: 's4@x.edu' });
    expect(again.status).toBe(201);
    expect(again.body.data).toMatchObject({ status: 'ENROLLED', progressPercent: 0 });
  });
});
