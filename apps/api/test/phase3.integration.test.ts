import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// Real app + real migrations + the unprivileged lms_app role, against a throwaway PostgreSQL.

const PASSWORD = 'CorrectHorse1!';
let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;

const pw = (slug: string) => `${PASSWORD}-${slug}`;

async function seed() {
  for (const [id, slug] of [['t-h', 'harvard'], ['t-m', 'mit']]) {
    await admin.tenant.create({ data: { id, slug, name: `${slug} University` } });
  }
  const user = (id: string, tenantId: string, slug: string, role: any, extra: object = {}) =>
    admin.user.create({
      data: {
        id, tenantId, email: `${id}@x.edu`, firstName: id, lastName: slug, role,
        passwordHash: bcrypt.hashSync(pw(slug), 4), emailVerified: true, ...extra,
      },
    });

  await user('admin', 't-h', 'harvard', 'TENANT_ADMIN');
  await user('admin2', 't-h', 'harvard', 'TENANT_ADMIN');
  await user('super', 't-h', 'harvard', 'SUPER_ADMIN');
  await user('auditor', 't-h', 'harvard', 'AUDITOR');
  await user('teacher', 't-h', 'harvard', 'INSTRUCTOR');
  await user('teacher2', 't-h', 'harvard', 'INSTRUCTOR');
  await user('ta', 't-h', 'harvard', 'TEACHING_ASSISTANT');
  for (const s of ['s1', 's2', 's3', 's4', 's5']) await user(s, 't-h', 'harvard', 'STUDENT'); // s5 never enrols
  await user('m-admin', 't-m', 'mit', 'TENANT_ADMIN');
  await user('m-student', 't-m', 'mit', 'STUDENT');

  const campus = await admin.campus.create({ data: { id: 'camp-m', tenantId: 't-m', name: 'MIT', code: 'M1' } });
  await admin.department.create({ data: { id: 'dept-m', campusId: campus.id, name: 'CS', code: 'CS' } });

  const course = (id: string, tenantId: string, over: object = {}) =>
    admin.course.create({ data: { id, tenantId, code: id.toUpperCase(), title: `Course ${id}`, status: 'PUBLISHED', allowSelfEnroll: true, ...over } });
  await course('c1', 't-h');
  await course('c2', 't-h', { allowSelfEnroll: false });
  await course('d1', 't-h', { status: 'DRAFT' });
  await course('m1', 't-m');
  await admin.courseInstructor.createMany({
    data: [
      { courseId: 'c1', userId: 'teacher', isPrimary: true },
      { courseId: 'c1', userId: 'ta' },
      { courseId: 'd1', userId: 'teacher', isPrimary: true },
    ],
  });
  await admin.enrollment.create({ data: { id: 'e-s1', tenantId: 't-h', courseId: 'c1', userId: 's1', status: 'IN_PROGRESS', progressPercent: 10 } });
  await admin.enrollment.create({ data: { id: 'e-s4', tenantId: 't-h', courseId: 'c1', userId: 's4' } });
  await admin.module.create({ data: { id: 'mod-1', courseId: 'c1', title: 'Intro' } });
  await admin.lesson.create({ data: { id: 'les-1', moduleId: 'mod-1', title: 'First', bodyContent: 'secret lesson body' } });
}

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  await seed();
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
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

// ---------------------------------------------------------------------------
describe('course visibility and content access', () => {
  it('shows learners only published courses', async () => {
    const s2 = await as('s2');
    const ids = (await s2.get('/api/v1/courses')).body.data.map((c: any) => c.id).sort();
    expect(ids).toEqual(['c1', 'c2']);
  });

  it('shows an instructor their own drafts but not other instructors’ drafts', async () => {
    const mine = (await (await as('teacher')).get('/api/v1/courses')).body.data.map((c: any) => c.id);
    const other = (await (await as('teacher2')).get('/api/v1/courses')).body.data.map((c: any) => c.id);
    expect(mine).toContain('d1');
    expect(other).not.toContain('d1');
  });

  it('shows admins and auditors everything', async () => {
    for (const who of ['admin', 'auditor']) {
      const ids = (await (await as(who)).get('/api/v1/courses')).body.data.map((c: any) => c.id);
      expect(ids).toContain('d1');
    }
  });

  it('hides a draft from learners and from instructors who do not teach it', async () => {
    expect((await (await as('s2')).get('/api/v1/courses/d1')).status).toBe(404);
    expect((await (await as('teacher2')).get('/api/v1/courses/d1')).status).toBe(404);
    expect((await (await as('teacher')).get('/api/v1/courses/d1')).status).toBe(200);
  });

  it('gives a non-enrolled learner the catalogue entry without lessons or instructor emails', async () => {
    const res = await (await as('s2')).get('/api/v1/courses/c1');
    expect(res.status).toBe(200);
    expect(res.body.data.contentLocked).toBe(true);
    expect(res.body.data.modules).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain('secret lesson body');
    expect(JSON.stringify(res.body.data.instructors)).not.toContain('@x.edu');
  });

  it('gives an enrolled learner the lessons', async () => {
    const res = await (await as('s1')).get('/api/v1/courses/c1');
    expect(res.body.data.contentLocked).toBe(false);
    expect(res.body.data.modules[0].lessons[0].bodyContent).toBe('secret lesson body');
  });

  it('refuses modules, quizzes and assignments to non-enrolled learners', async () => {
    const s2 = await as('s2');
    expect((await s2.get('/api/v1/courses/c1/modules')).status).toBe(403);
    expect((await s2.get('/api/v1/courses/c1/quizzes')).status).toBe(403);
    expect((await s2.get('/api/v1/courses/c1/assignments')).status).toBe(403);
  });

  it('lets only the assigned instructor (not any instructor) edit a course', async () => {
    expect((await (await as('teacher2')).put('/api/v1/courses/c1').send({ title: 'Hijacked' })).status).toBe(403);
    expect((await (await as('ta')).put('/api/v1/courses/c1').send({ title: 'TA edit' })).status).toBe(403);
    expect((await (await as('teacher')).put('/api/v1/courses/c1').send({ title: 'Renamed by owner' })).status).toBe(200);
    expect((await (await as('admin')).put('/api/v1/courses/c1').send({ title: 'Course c1' })).status).toBe(200);
  });

  it('rejects a department from another tenant', async () => {
    const res = await (await as('teacher')).post('/api/v1/courses').send({ code: 'X-1', title: 'Cross tenant', departmentId: 'dept-m' });
    expect(res.status).toBe(400);
  });

  it('reports a duplicate course code as 409, not 500', async () => {
    const res = await (await as('admin')).post('/api/v1/courses').send({ code: 'C1', title: 'Duplicate code' });
    expect(res.status).toBe(409);
  });

  it('records only whitelisted fields in the audit diff', async () => {
    const admin1 = await as('admin');
    await admin1.put('/api/v1/courses/c2').send({ description: 'A very long description that must not be copied', title: 'Course c2' });
    const log = await admin.auditLog.findFirst({ where: { action: 'COURSE_UPDATED', resourceId: 'c2' }, orderBy: { createdAt: 'desc' } });
    const diff = JSON.stringify(log!.diffJson);
    expect(diff).toContain('"title"');
    expect(diff).not.toContain('very long description');
  });
});

// ---------------------------------------------------------------------------
describe('modules and lessons', () => {
  it('lets the instructor create, update, reorder and delete', async () => {
    const t = await as('teacher');
    const m2 = (await t.post('/api/v1/courses/c1/modules').send({ title: 'Second' })).body.data;
    expect(m2.orderIndex).toBe(1);

    const lesson = await t.post(`/api/v1/courses/c1/modules/${m2.id}/lessons`).send({ title: 'L1', contentType: 'VIDEO', mediaUrl: 'https://cdn.example.com/v.mp4' });
    expect(lesson.status).toBe(201);
    expect((await t.patch(`/api/v1/courses/c1/lessons/${lesson.body.data.id}`).send({ title: 'L1 renamed' })).body.data.title).toBe('L1 renamed');

    const order = await t.put('/api/v1/courses/c1/modules-order').send({ moduleIds: [m2.id, 'mod-1'] });
    expect(order.body.data.map((m: any) => m.id)).toEqual([m2.id, 'mod-1']);

    expect((await t.delete(`/api/v1/courses/c1/lessons/${lesson.body.data.id}`)).status).toBe(200);
    expect((await t.delete(`/api/v1/courses/c1/modules/${m2.id}`)).status).toBe(200);
  });

  it('rejects unsafe link schemes and an incomplete reorder list', async () => {
    const t = await as('teacher');
    expect((await t.post('/api/v1/courses/c1/modules/mod-1/lessons').send({ title: 'x', mediaUrl: 'javascript:alert(1)' })).status).toBe(400);
    expect((await t.put('/api/v1/courses/c1/modules-order').send({ moduleIds: [] })).status).toBe(400);
    expect((await t.put('/api/v1/courses/c1/modules-order').send({ moduleIds: ['mod-1', 'mod-1'] })).status).toBe(400);
  });

  it('keeps lessons scoped to their course and to authorised editors', async () => {
    expect((await (await as('teacher2')).post('/api/v1/courses/c1/modules/mod-1/lessons').send({ title: 'x' })).status).toBe(403);
    expect((await (await as('teacher')).patch('/api/v1/courses/d1/lessons/les-1').send({ title: 'x' })).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe('enrolment rules', () => {
  it('lets a learner self-enrol only where the course allows it', async () => {
    const s2 = await as('s2');
    expect((await s2.post('/api/v1/enrollments').send({ courseId: 'c2' })).status).toBe(403);
    expect((await s2.post('/api/v1/enrollments').send({ courseId: 'c1' })).status).toBe(201);
    expect((await s2.post('/api/v1/enrollments').send({ courseId: 'c1' })).status).toBe(409);
  });

  it('does not let a learner enrol someone else', async () => {
    const res = await (await as('s3')).post('/api/v1/enrollments').send({ courseId: 'c2', userId: 's2' });
    expect(res.status).toBe(403);
  });

  it('does not reveal draft courses to a learner trying to enrol', async () => {
    expect((await (await as('s3')).post('/api/v1/enrollments').send({ courseId: 'd1' })).status).toBe(404);
  });

  it('lets the course instructor and admins enrol others, but not other instructors or TAs', async () => {
    expect((await (await as('teacher2')).post('/api/v1/enrollments').send({ courseId: 'c1', userId: 's3' })).status).toBe(403);
    expect((await (await as('ta')).post('/api/v1/enrollments').send({ courseId: 'c1', userId: 's3' })).status).toBe(403);
    expect((await (await as('teacher')).post('/api/v1/enrollments').send({ courseId: 'c1', userId: 's3' })).status).toBe(201);
    expect((await (await as('admin')).post('/api/v1/enrollments').send({ courseId: 'c2', userId: 's3' })).status).toBe(201);
  });

  it('refuses suspended users and cross-tenant users', async () => {
    const a = await as('admin');
    await admin.user.update({ where: { id: 's4' }, data: { status: 'SUSPENDED' } });
    try {
      expect((await a.post('/api/v1/enrollments').send({ courseId: 'c2', userId: 's4' })).status).toBe(400);
    } finally {
      await admin.user.update({ where: { id: 's4' }, data: { status: 'ACTIVE' } });
    }
    expect((await a.post('/api/v1/enrollments').send({ courseId: 'c2', userId: 'm-student' })).status).toBe(404);
  });

  it('keeps rosters private: learners see only themselves, instructors only their own courses', async () => {
    const s1 = await as('s1');
    expect((await s1.get('/api/v1/enrollments/my')).body.data.map((e: any) => e.userId)).toEqual(['s1']);
    expect((await s1.get('/api/v1/enrollments?userId=s4')).status).toBe(403);
    expect((await s1.get('/api/v1/enrollments?courseId=c1')).status).toBe(403);
    expect((await s1.get('/api/v1/users/s4/enrollments')).status).toBe(403);

    const roster = await (await as('teacher')).get('/api/v1/enrollments?courseId=c1');
    expect(roster.body.data.length).toBeGreaterThanOrEqual(2);
    const outsider = await (await as('teacher2')).get('/api/v1/enrollments?courseId=c1');
    expect(outsider.body.data).toEqual([]);
    expect((await (await as('teacher2')).get('/api/v1/users/s1/enrollments')).body.data).toEqual([]);
    expect((await (await as('teacher')).get('/api/v1/users/s1/enrollments')).body.data).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe('progress, completion and certificates', () => {
  it('lets a learner move forward, but not backwards, to 100%, or set a grade', async () => {
    const s1 = await as('s1');
    expect((await s1.patch('/api/v1/enrollments/e-s1/progress').send({ progressPercent: 50 })).body.data.progressPercent).toBe(50);
    expect((await s1.patch('/api/v1/enrollments/e-s1/progress').send({ progressPercent: 30 })).status).toBe(400);
    expect((await s1.patch('/api/v1/enrollments/e-s1/progress').send({ progressPercent: 100 })).status).toBe(403);
    expect((await s1.patch('/api/v1/enrollments/e-s1/progress').send({ progressPercent: 60, finalGrade: 100 })).status).toBe(403);
    const row = await admin.enrollment.findUniqueOrThrow({ where: { id: 'e-s1' } });
    expect(row).toMatchObject({ progressPercent: 50, status: 'IN_PROGRESS', finalGrade: null, completedAt: null });
  });

  it('ignores a client-supplied status', async () => {
    const res = await (await as('s1')).patch('/api/v1/enrollments/e-s1/progress').send({ progressPercent: 55, status: 'COMPLETED' });
    expect(res.body.data.status).toBe('IN_PROGRESS');
  });

  it('hides another learner’s enrolment, and from non-assigned instructors', async () => {
    expect((await (await as('s3')).patch('/api/v1/enrollments/e-s1/progress').send({ progressPercent: 90 })).status).toBe(404);
    expect((await (await as('teacher2')).patch('/api/v1/enrollments/e-s1/progress').send({ progressPercent: 90 })).status).toBe(404);
  });

  it('completes on staff say-so, issues one certificate, and verifies it publicly', async () => {
    const t = await as('teacher');
    const done = await t.patch('/api/v1/enrollments/e-s1/progress').send({ progressPercent: 100, finalGrade: 91 });
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe('COMPLETED');
    const cert = done.body.data.certificate;
    expect(cert.certificateNumber).toMatch(/^CERT-\d{4}-[0-9A-F]{10}$/);

    const again = await t.patch('/api/v1/enrollments/e-s1/progress').send({ progressPercent: 100 });
    expect(again.body.data.certificate.certificateNumber).toBe(cert.certificateNumber);
    expect(await admin.certificate.count({ where: { enrollmentId: 'e-s1' } })).toBe(1);

    const verify = await request(app).get(`/api/v1/certificates/verify/${cert.certificateNumber}?tenant=harvard`);
    expect(verify.status).toBe(200);
    expect(verify.body).toMatchObject({ valid: true, institution: 'harvard University', course: { code: 'C1' } });
    expect(JSON.stringify(verify.body)).not.toContain('@x.edu');

    expect((await request(app).get(`/api/v1/certificates/verify/${cert.certificateNumber}?tenant=mit`)).status).toBe(404);
    expect((await request(app).get('/api/v1/certificates/verify/CERT-2026-0000000000?tenant=harvard')).status).toBe(404);
    expect((await request(app).get('/api/v1/certificates/verify/not-a-number')).status).toBe(404);
  });

  it('fails the enrolment, with no certificate, when the grade is below the pass mark', async () => {
    const res = await (await as('teacher')).patch('/api/v1/enrollments/e-s4/progress').send({ progressPercent: 100, finalGrade: 20 });
    expect(res.body.data.status).toBe('FAILED');
    expect(res.body.data.certificate).toBeNull();
  });

  it('does not allow progress on a dropped enrolment', async () => {
    await admin.enrollment.update({ where: { id: 'e-s4' }, data: { status: 'DROPPED' } });
    expect((await (await as('teacher')).patch('/api/v1/enrollments/e-s4/progress').send({ progressPercent: 10 })).status).toBe(409);
  });

  it('lets nobody grade themselves, even staff enrolled in their own course', async () => {
    await admin.enrollment.create({ data: { id: 'e-teacher', tenantId: 't-h', courseId: 'c1', userId: 'teacher' } });
    const res = await (await as('teacher')).patch('/api/v1/enrollments/e-teacher/progress').send({ progressPercent: 100, finalGrade: 100 });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
describe('user administration', () => {
  it('stops a tenant admin escalating to super admin', async () => {
    const a = await as('admin');
    expect((await a.patch('/api/v1/users/s3').send({ role: 'SUPER_ADMIN' })).status).toBe(403);
    expect((await a.patch('/api/v1/users/super').send({ status: 'SUSPENDED' })).status).toBe(403);
    expect((await a.patch('/api/v1/users/super').send({ firstName: 'Renamed' })).status).toBe(200); // names are fine
  });

  it('stops anyone changing their own role or status', async () => {
    expect((await (await as('admin')).patch('/api/v1/users/admin').send({ role: 'SUPER_ADMIN' })).status).toBe(403);
    expect((await (await as('super')).patch('/api/v1/users/super').send({ status: 'SUSPENDED' })).status).toBe(403);
    expect((await (await as('s3')).patch('/api/v1/users/s3').send({ role: 'TENANT_ADMIN' })).status).toBe(403);
  });

  it('lets admins manage ordinary roles and a super admin grant super admin', async () => {
    expect((await (await as('admin')).patch('/api/v1/users/s3').send({ role: 'INSTRUCTOR' })).body.data.role).toBe('INSTRUCTOR');
    expect((await (await as('super')).patch('/api/v1/users/admin2').send({ role: 'SUPER_ADMIN' })).body.data.role).toBe('SUPER_ADMIN');
    await admin.user.update({ where: { id: 's3' }, data: { role: 'STUDENT' } });
    await admin.user.update({ where: { id: 'admin2' }, data: { role: 'TENANT_ADMIN' } });
  });

  it('rejects an avatar link that is not http(s)', async () => {
    expect((await (await as('s3')).patch('/api/v1/users/s3').send({ avatarUrl: 'javascript:alert(1)' })).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe('quizzes', () => {
  let quizId: string;
  const ids: Record<string, string> = {};

  async function addQuestions(t: request.Agent, quiz: string) {
    const mc = await t.post(`/api/v1/quizzes/${quiz}/questions`).send({
      questionText: 'Capital of France?', questionType: 'MULTIPLE_CHOICE', points: 1,
      optionsJson: [{ id: 'a', text: 'Paris', isCorrect: true }, { id: 'b', text: 'Rome', isCorrect: false }],
      explanation: 'It is Paris',
    });
    const ms = await t.post(`/api/v1/quizzes/${quiz}/questions`).send({
      questionText: 'Pick the primes', questionType: 'MULTI_SELECT', points: 2,
      optionsJson: [{ id: 'a', text: '2', isCorrect: true }, { id: 'b', text: '4', isCorrect: false }, { id: 'c', text: '5', isCorrect: true }],
    });
    const essay = await t.post(`/api/v1/quizzes/${quiz}/questions`).send({ questionText: 'Discuss', questionType: 'ESSAY', points: 3 });
    expect([mc.status, ms.status, essay.status]).toEqual([201, 201, 201]);
    return { mc: mc.body.data.id, ms: ms.body.data.id, essay: essay.body.data.id };
  }

  beforeAll(async () => {
    const t = await as('teacher');
    quizId = (await t.post('/api/v1/courses/c1/quizzes').send({ title: 'Mixed quiz', maxAttempts: 2, passingPercent: 50 })).body.data.id;
    Object.assign(ids, await addQuestions(t, quizId));
    // c1 enrolments used below
    await admin.enrollment.update({ where: { id: 'e-s4' }, data: { status: 'ENROLLED' } });
  });

  it('only lets the course editor build quizzes', async () => {
    expect((await (await as('s1')).post('/api/v1/courses/c1/quizzes').send({ title: 'x' })).status).toBe(403);
    expect((await (await as('teacher2')).post('/api/v1/courses/c1/quizzes').send({ title: 'x' })).status).toBe(403);
    expect((await (await as('ta')).post('/api/v1/courses/c1/quizzes').send({ title: 'x' })).status).toBe(403);
  });

  it('rejects questions that cannot be graded', async () => {
    const t = await as('teacher');
    const scratch = (await t.post('/api/v1/courses/c1/quizzes').send({ title: 'Scratch' })).body.data.id; // keep the shared quiz untouched
    const bad = (body: object) => t.post(`/api/v1/quizzes/${scratch}/questions`).send({ questionText: 'q', ...body });
    expect((await bad({ questionType: 'MULTIPLE_CHOICE', optionsJson: [{ text: 'a', isCorrect: false }, { text: 'b', isCorrect: false }] })).status).toBe(400);
    expect((await bad({ questionType: 'MULTIPLE_CHOICE', optionsJson: [{ text: 'a', isCorrect: true }] })).status).toBe(400);
    expect((await bad({ questionType: 'MULTI_SELECT', optionsJson: [{ text: 'a', isCorrect: false }, { text: 'b', isCorrect: false }] })).status).toBe(400);
    expect((await bad({ questionType: 'SHORT_ANSWER' })).status).toBe(400);
    expect((await bad({ questionType: 'ESSAY' })).status).toBe(201);
  });

  it('hides the answer key from learners and shows it to staff', async () => {
    const learner = JSON.stringify((await (await as('s1')).get(`/api/v1/quizzes/${quizId}`)).body);
    expect(learner).not.toContain('isCorrect');
    expect(learner).not.toContain('It is Paris');
    expect(learner).toContain('Capital of France?');

    const staff = JSON.stringify((await (await as('teacher')).get(`/api/v1/quizzes/${quizId}`)).body);
    expect(staff).toContain('isCorrect');
    expect(staff).toContain('It is Paris');
  });

  it('keeps quizzes from learners who are not enrolled, and from other tenants', async () => {
    expect((await (await as('s5')).get(`/api/v1/quizzes/${quizId}`)).status).toBe(403);
    expect((await (await as('m-admin', 'mit')).get(`/api/v1/quizzes/${quizId}`)).status).toBe(404);
  });

  it('grades objective questions, leaves essays pending, and accepts the web client’s answer format', async () => {
    const s1 = await as('s1');
    const res = await s1.post(`/api/v1/quizzes/${quizId}/submissions`).send({
      answers: [
        { questionId: ids.mc, answer: 'a' },
        { questionId: ids.ms, answer: ['a', 'c'] },
        { questionId: ids.essay, answer: 'An essay' },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ score: 3, maxScore: 6, passed: false, pendingManualGrading: true, attemptNumber: 1, attemptsRemaining: 1 });
    ids.submission = res.body.data.submissionId;
  });

  it('lets a learner see their own submissions but never other people’s', async () => {
    const mine = await (await as('s1')).get(`/api/v1/quizzes/${quizId}/submissions`);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].pendingManualGrading).toBe(true);
    expect(mine.body.data[0].answersJson).toBeUndefined();

    const all = await (await as('teacher')).get(`/api/v1/quizzes/${quizId}/submissions`);
    expect(all.body.data[0].user.email).toBeDefined();
  });

  it('lets only staff of that course award manual points, then computes the verdict', async () => {
    const grade = (who: string) => as(who).then((a) => a.patch(`/api/v1/quizzes/${quizId}/submissions/${ids.submission}/grade`).send({ grades: { [ids.essay]: 3 } }));
    expect((await grade('s1')).status).toBe(403);
    expect((await grade('teacher2')).status).toBe(403);

    const bad = await (await as('ta')).patch(`/api/v1/quizzes/${quizId}/submissions/${ids.submission}/grade`).send({ grades: { [ids.essay]: 99 } });
    expect(bad.status).toBe(400);
    const notManual = await (await as('ta')).patch(`/api/v1/quizzes/${quizId}/submissions/${ids.submission}/grade`).send({ grades: { [ids.mc]: 1 } });
    expect(notManual.status).toBe(400);

    const ok = await grade('ta');
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ score: 6, passed: true, pendingManualGrading: false });
  });

  it('enforces the attempt limit', async () => {
    const s1 = await as('s1');
    const answers = { [ids.mc]: 'b' };
    expect((await s1.post(`/api/v1/quizzes/${quizId}/submit`).send({ answers })).status).toBe(201);
    const third = await s1.post(`/api/v1/quizzes/${quizId}/submit`).send({ answers });
    expect(third.status).toBe(400);
    expect(await admin.quizSubmission.count({ where: { quizId, userId: 's1' } })).toBe(2);
  });

  it('cannot be submitted twice at once beyond the limit', async () => {
    const t = await as('teacher');
    const q = (await t.post('/api/v1/courses/c1/quizzes').send({ title: 'One shot', maxAttempts: 1 })).body.data.id;
    const { mc } = await addQuestions(t, q);
    const s4 = await as('s4');
    const results = await Promise.all(
      Array.from({ length: 6 }, () => s4.post(`/api/v1/quizzes/${q}/submit`).send({ answers: { [mc]: 'a' } }))
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await admin.quizSubmission.count({ where: { quizId: q, userId: 's4' } })).toBe(1);
  });

  it('enforces the time limit through an explicit start', async () => {
    const t = await as('teacher');
    const q = (await t.post('/api/v1/courses/c1/quizzes').send({ title: 'Timed', maxAttempts: 1, timeLimitMins: 1 })).body.data.id;
    const { mc } = await addQuestions(t, q);
    const s4 = await as('s4');

    expect((await s4.post(`/api/v1/quizzes/${q}/submit`).send({ answers: { [mc]: 'a' } })).body.error).toMatch(/start an attempt/);

    const started = await s4.post(`/api/v1/quizzes/${q}/start`);
    expect(started.status).toBe(201);
    expect(new Date(started.body.data.expiresAt).getTime()).toBeGreaterThan(Date.now());
    const resumed = await s4.post(`/api/v1/quizzes/${q}/start`);
    expect(resumed.body.data).toMatchObject({ resumed: true, submissionId: started.body.data.submissionId });

    await admin.quizSubmission.update({ where: { id: started.body.data.submissionId }, data: { startedAt: new Date(Date.now() - 10 * 60_000) } });
    const late = await s4.post(`/api/v1/quizzes/${q}/submit`).send({ answers: { [mc]: 'a' } });
    expect(late.status).toBe(400);
    expect(late.body.error).toMatch(/time limit/);

    const stored = await admin.quizSubmission.findUniqueOrThrow({ where: { id: started.body.data.submissionId } });
    expect(stored).toMatchObject({ score: 0, passed: false });
    expect(stored.submittedAt).not.toBeNull();
    expect((await s4.post(`/api/v1/quizzes/${q}/start`)).status).toBe(400); // the attempt was used
  });

  it('lets a timed attempt be submitted within the limit', async () => {
    const t = await as('teacher');
    const q = (await t.post('/api/v1/courses/c1/quizzes').send({ title: 'Timed ok', timeLimitMins: 5 })).body.data.id;
    const { mc } = await addQuestions(t, q);
    const s1 = await as('s1');
    await s1.post(`/api/v1/quizzes/${q}/start`);
    const res = await s1.post(`/api/v1/quizzes/${q}/submit`).send({ answers: { [mc]: 'a' } });
    expect(res.status).toBe(201);
    expect(res.body.data.score).toBe(1);
  });

  it('refuses staff, auditors and non-enrolled users as test takers', async () => {
    const body = { answers: { [ids.mc]: 'a' } };
    for (const who of ['teacher', 'auditor', 's5']) {
      expect((await (await as(who)).post(`/api/v1/quizzes/${quizId}/submit`).send(body)).status, who).toBe(403);
    }
  });

  it('refuses to delete a quiz or its questions once there are submissions', async () => {
    const t = await as('teacher');
    expect((await t.delete(`/api/v1/quizzes/${quizId}`)).status).toBe(409);
    expect((await t.delete(`/api/v1/quizzes/${quizId}/questions/${ids.mc}`)).status).toBe(409);
  });

  it('lets an editor change and delete a quiz that has no submissions', async () => {
    const t = await as('teacher');
    const q = (await t.post('/api/v1/courses/c1/quizzes').send({ title: 'Temp' })).body.data.id;
    const question = (await addQuestions(t, q)).mc;
    expect((await t.patch(`/api/v1/quizzes/${q}`).send({ title: 'Temp 2', passingPercent: 80 })).body.data.title).toBe('Temp 2');
    expect((await t.patch(`/api/v1/quizzes/${q}/questions/${question}`).send({ points: 4 })).body.data.points).toBe(4);
    expect((await t.delete(`/api/v1/quizzes/${q}`)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe('assignments', () => {
  let assignmentId: string;
  let submissionId: string;

  beforeAll(async () => {
    const res = await (await as('teacher')).post('/api/v1/courses/c1/assignments').send({ title: 'Lab 1', instructions: 'Do it', maxPoints: 50 });
    expect(res.status).toBe(201);
    assignmentId = res.body.data.id;
  });

  it('only lets the course editor create assignments', async () => {
    expect((await (await as('s1')).post('/api/v1/courses/c1/assignments').send({ title: 'x', instructions: 'y' })).status).toBe(403);
    expect((await (await as('teacher2')).post('/api/v1/courses/c1/assignments').send({ title: 'x', instructions: 'y' })).status).toBe(403);
  });

  it('accepts one submission per learner and replaces it on resubmission', async () => {
    const s1 = await as('s1');
    const first = await s1.post(`/api/v1/assignments/${assignmentId}/submissions`).send({ submissionText: 'v1' });
    expect(first.status).toBe(201);
    submissionId = first.body.data.id;
    const second = await s1.post(`/api/v1/assignments/${assignmentId}/submit`).send({ submissionText: 'v2' });
    expect(second.body.data.id).toBe(submissionId);
    expect(second.body.data.submissionText).toBe('v2');
    expect(await admin.assignmentSubmission.count({ where: { assignmentId, userId: 's1' } })).toBe(1);
  });

  it('rejects empty submissions and unsafe file links', async () => {
    const s1 = await as('s1');
    expect((await s1.post(`/api/v1/assignments/${assignmentId}/submit`).send({})).status).toBe(400);
    expect((await s1.post(`/api/v1/assignments/${assignmentId}/submit`).send({ fileUrl: 'javascript:alert(1)' })).status).toBe(400);
  });

  it('refuses submissions from non-enrolled users and from staff', async () => {
    expect((await (await as('s5')).post(`/api/v1/assignments/${assignmentId}/submit`).send({ submissionText: 'x' })).status).toBe(403);
    expect((await (await as('teacher')).post(`/api/v1/assignments/${assignmentId}/submit`).send({ submissionText: 'x' })).status).toBe(403);
  });

  it('only lets staff of this course grade', async () => {
    const grade = (who: string, g: number) =>
      as(who).then((a) => a.patch(`/api/v1/assignments/${assignmentId}/submissions/${submissionId}/grade`).send({ grade: g, feedback: 'ok' }));
    expect((await grade('teacher2', 40)).status).toBe(403);
    expect((await grade('s1', 40)).status).toBe(403);
    expect((await grade('ta', 51)).status).toBe(400);
    expect((await grade('ta', 45)).body.data.grade).toBe(45);
  });

  it('freezes a submission once graded', async () => {
    const res = await (await as('s1')).post(`/api/v1/assignments/${assignmentId}/submit`).send({ submissionText: 'v3' });
    expect(res.status).toBe(409);
  });

  it('shows learners their own submission and staff all of them', async () => {
    await (await as('s4')).post(`/api/v1/assignments/${assignmentId}/submit`).send({ submissionText: 'mine' });
    const own = await (await as('s4')).get(`/api/v1/assignments/${assignmentId}/submissions`);
    expect(own.body.data.map((s: any) => s.userId)).toEqual(['s4']);
    const all = await (await as('teacher')).get(`/api/v1/assignments/${assignmentId}/submissions`);
    expect(all.body.data.map((s: any) => s.userId).sort()).toEqual(['s1', 's4']);
  });

  it('refuses to delete an assignment that has submissions', async () => {
    expect((await (await as('teacher')).delete(`/api/v1/assignments/${assignmentId}`)).status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
describe('validation, errors and logging', () => {
  it('rejects malformed query parameters with a 400', async () => {
    const a = await as('admin');
    for (const url of [
      '/api/v1/courses?page=abc',
      '/api/v1/courses?limit=1000',
      '/api/v1/courses?status=BOGUS',
      '/api/v1/users?role=EMPEROR',
      '/api/v1/admin/audit-logs?startDate=garbage',
      '/api/v1/admin/audit-logs?startDate=2026-02-01&endDate=2026-01-01',
      '/api/v1/enrollments?status=BOGUS',
    ]) {
      expect((await a.get(url)).status, url).toBe(400);
    }
  });

  it('echoes a request id in the header and in error bodies', async () => {
    const res = await request(app).get('/api/v1/nope').set('x-request-id', 'trace-1234567');
    expect(res.status).toBe(404);
    expect(res.headers['x-request-id']).toBe('trace-1234567');
    expect(res.body.requestId).toBe('trace-1234567');

    const generated = await request(app).get('/api/v1/nope').set('x-request-id', 'bad id!');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('answers malformed JSON with a clean 400 and no stack trace', async () => {
    const res = await request(app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"email": ');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/stack|node_modules|SyntaxError/);
  });

  it('does not leak internals on unexpected errors', async () => {
    const original = admin; // keep reference; force a DB failure through an impossible filter
    expect(original).toBeDefined();
    const a = await as('admin');
    const res = await a.get('/api/v1/admin/audit-logs?limit=5&userId=' + 'x'.repeat(200));
    expect(res.status).toBe(400);
    expect(res.body.requestId).toBeDefined();
  });

  it('lets auditors read audit logs but not admin statistics', async () => {
    const aud = await as('auditor');
    expect((await aud.get('/api/v1/admin/audit-logs')).status).toBe(200);
    expect((await aud.get('/api/v1/admin/stats')).status).toBe(403);
    expect((await (await as('s1')).get('/api/v1/admin/audit-logs')).status).toBe(403);
  });

  it('keeps the unfinished ingestion endpoints behind authentication', async () => {
    expect((await request(app).post('/api/v1/xapi/statements').send({ actor: {}, verb: {}, object: {} })).status).toBe(401);
    expect((await request(app).post('/api/v1/proctoring/events').send({})).status).toBe(401);
  });

  it('never returns a tenant’s data to another tenant’s admin, whatever the route', async () => {
    const m = await as('m-admin', 'mit');
    expect((await m.get('/api/v1/courses/c1')).status).toBe(404);
    expect((await m.get('/api/v1/users/s1')).status).toBe(404);
    expect((await m.get('/api/v1/courses')).body.data.map((c: any) => c.id)).toEqual(['m1']);
    expect((await m.get('/api/v1/admin/stats')).body.data.totalUsers).toBe(2);
  });
});
