import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// Contract test: every response documented in src/openapi/responses/learning.ts is checked against what
// the real API returns (real app, real migrations, unprivileged role, throwaway PostgreSQL).

const PASSWORD = 'CorrectHorse1!';
let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;
let RESPONSES: typeof import('../src/openapi/responses/learning.js').RESPONSES;

const pw = (slug: string) => `${PASSWORD}-${slug}`;

async function seed() {
  for (const [id, slug] of [['t-h', 'harvard'], ['t-m', 'mit']]) {
    await admin.tenant.create({ data: { id, slug, name: `${slug} University` } });
  }
  const user = (id: string, tenantId: string, slug: string, role: any) =>
    admin.user.create({
      data: { id, tenantId, email: `${id}@x.edu`, firstName: id, lastName: 'Lastname', role, passwordHash: bcrypt.hashSync(pw(slug), 4), emailVerified: true },
    });
  await user('admin', 't-h', 'harvard', 'TENANT_ADMIN');
  await user('auditor', 't-h', 'harvard', 'AUDITOR');
  await user('teacher', 't-h', 'harvard', 'INSTRUCTOR');
  for (const s of ['s1', 's2', 's3', 's4', 's5']) await user(s, 't-h', 'harvard', 'STUDENT');

  await admin.course.create({ data: { id: 'c1', tenantId: 't-h', code: 'C1', title: 'Course c1', status: 'PUBLISHED', allowSelfEnroll: true } });
  await admin.courseInstructor.create({ data: { courseId: 'c1', userId: 'teacher', isPrimary: true } });
  for (const [id, userId, progress] of [['e-s1', 's1', 10], ['e-s3', 's3', 20], ['e-s4', 's4', 0]] as const) {
    await admin.enrollment.create({ data: { id, tenantId: 't-h', courseId: 'c1', userId, status: progress ? 'IN_PROGRESS' : 'ENROLLED', progressPercent: progress } });
  }
  await admin.assignment.create({ data: { id: 'a1', tenantId: 't-h', courseId: 'c1', title: 'Essay', instructions: 'Write', dueDate: new Date(Date.now() + 86_400_000) } });
  await admin.quiz.create({ data: { id: 'q1', tenantId: 't-h', courseId: 'c1', title: 'Quiz', maxAttempts: 2 } });
  await admin.quizQuestion.create({ data: { id: 'qq1', quizId: 'q1', questionText: 'Q?', bloomLevel: 'REMEMBER', points: 1 } });
  await admin.quizSubmission.create({
    data: {
      quizId: 'q1', userId: 's1', score: 1, maxScore: 1, passed: true, submittedAt: new Date(),
      answersJson: { grading: { qq1: { awardedPoints: 1, maxPoints: 1 } } },
    },
  });
}

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  await seed();
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
  RESPONSES = (await import('../src/openapi/responses/learning.js')).RESPONSES;
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

/** Asserts the status and that the body satisfies the documented schema of that status. */
function check(key: string, res: { status: number; body: any; text?: string }) {
  const entry = RESPONSES[key];
  expect(entry, `no entry for ${key}`).toBeDefined();
  const doc = [entry.response!, ...(entry.otherResponses ?? [])].find((d) => d.status === res.status);
  expect(doc, `${key}: status ${res.status} is not documented (${JSON.stringify(res.body)})`).toBeDefined();
  if (doc!.schema) {
    const payload = doc!.contentType && doc!.contentType !== 'application/json' ? res.text : res.body;
    const result = doc!.schema.safeParse(payload);
    expect(result.success, `${key}: ${JSON.stringify(result.success ? payload : result.error)}`).toBe(true);
  }
}

const keys = (o: object) => Object.keys(o).sort();

describe('contract: courses', () => {
  let teacherCourse: string;
  let moduleA: string;
  let moduleB: string;
  let lesson: string;

  it('POST /courses (instructor becomes primary instructor; admin gets none)', async () => {
    const t = await (await as('teacher')).post('/api/v1/courses').send({ code: 'T-1', title: 'Teacher course', description: 'd' });
    expect(t.status).toBe(201);
    check('POST /api/v1/courses', t);
    expect(t.body.data.instructors).toHaveLength(1);
    teacherCourse = t.body.data.id;

    const a = await (await as('admin')).post('/api/v1/courses').send({ code: 'A-1', title: 'Admin course' });
    expect(a.status).toBe(201);
    check('POST /api/v1/courses', a);
    expect(a.body.data.instructors).toEqual([]);

    const dup = await (await as('admin')).post('/api/v1/courses').send({ code: 'A-1', title: 'Admin course' });
    expect(dup.status).toBe(409);
  });

  it('GET /courses/:id (enrolled learner sees modules; outsider gets them locked)', async () => {
    await admin.module.create({ data: { id: 'mod-seed', courseId: 'c1', title: 'Seed module' } });
    await admin.lesson.create({ data: { id: 'les-seed', moduleId: 'mod-seed', title: 'Seed lesson' } });
    const enrolled = await (await as('s1')).get('/api/v1/courses/c1');
    expect(enrolled.status).toBe(200);
    check('GET /api/v1/courses/:id', enrolled);
    expect(enrolled.body.data.modules[0].lessons).toHaveLength(1);
    expect(enrolled.body.data.instructors[0].user.email).toBeUndefined();

    const outsider = await (await as('s2')).get('/api/v1/courses/c1');
    check('GET /api/v1/courses/:id', outsider);
    expect(outsider.body.data.contentLocked).toBe(true);
    expect(outsider.body.data.modules).toEqual([]);

    const staff = await (await as('teacher')).get('/api/v1/courses/c1');
    check('GET /api/v1/courses/:id', staff);
    expect(staff.body.data.instructors[0].user.email).toBe('teacher@x.edu');
    expect((await (await as('s2')).get('/api/v1/courses/nope')).status).toBe(404);
  });

  it('announcements: staff post and learners are notified and can read them', async () => {
    const teacher = await as('teacher');
    const posted = await teacher.post('/api/v1/courses/c1/announcements').send({ title: 'Week 2', body: 'Read chapter 3 before Monday.', pinned: true });
    expect(posted.status).toBe(201);
    check('POST /api/v1/courses/:courseId/announcements', posted);
    expect(posted.body.notified).toBe(3); // s1, s3 and s4 are enrolled in c1
    expect(await admin.notification.count({ where: { userId: 's1', title: 'C1: Week 2' } })).toBe(1);
    const quiet = await teacher.post('/api/v1/courses/c1/announcements').send({ title: 'Typo fixed', body: 'No action needed.', notify: false });
    expect(quiet.body.notified).toBe(0);

    const s1 = await as('s1');
    const list = await s1.get('/api/v1/courses/c1/announcements');
    check('GET /api/v1/courses/:courseId/announcements', list);
    expect(list.body.data.map((a: any) => a.title)).toEqual(['Week 2', 'Typo fixed']); // pinned first
    const recent = await s1.get('/api/v1/announcements/recent');
    check('GET /api/v1/announcements/recent', recent);
    expect(recent.body.data[0].course.code).toBe('C1');

    // Learners cannot post or change; outsiders cannot read.
    expect((await s1.post('/api/v1/courses/c1/announcements').send({ title: 'x', body: 'y' })).status).toBe(403);
    expect((await s1.patch(`/api/v1/announcements/${posted.body.data.id}`).send({ pinned: false })).status).toBe(403);
    expect((await (await as('s2')).get('/api/v1/courses/c1/announcements')).status).toBe(403);
    expect((await teacher.post('/api/v1/courses/c1/announcements').send({ title: '', body: 'y' })).status).toBe(400);

    const unpinned = await teacher.patch(`/api/v1/announcements/${posted.body.data.id}`).send({ pinned: false });
    check('PATCH /api/v1/announcements/:id', unpinned);
    expect(unpinned.body.data.pinned).toBe(false);
    const del = await teacher.delete(`/api/v1/announcements/${quiet.body.data.id}`);
    check('DELETE /api/v1/announcements/:id', del);
    expect(await admin.auditLog.count({ where: { action: { in: ['ANNOUNCEMENT_POSTED', 'ANNOUNCEMENT_DELETED'] } } })).toBe(3);
  });

  it('GET /enrollments/grades shows a learner their own results', async () => {
    await admin.assignmentSubmission.create({ data: { assignmentId: 'a1', userId: 's3', submissionText: 'x', grade: 80, feedback: 'Good', gradedAt: new Date() } });
    const res = await (await as('s3')).get('/api/v1/enrollments/grades');
    expect(res.status).toBe(200);
    check('GET /api/v1/enrollments/grades', res);
    const c1 = res.body.data.find((c: any) => c.course.id === 'c1');
    expect(c1.courseGrade).toBeNull();
    expect(c1.assignments[0]).toMatchObject({ id: 'a1', grade: 80, feedback: 'Good', late: false });
    expect(c1.quizzes[0]).toMatchObject({ id: 'q1', attemptsUsed: 0, bestPercent: null });

    const s1 = (await (await as('s1')).get('/api/v1/enrollments/grades')).body.data.find((c: any) => c.course.id === 'c1');
    expect(s1.quizzes[0]).toMatchObject({ attemptsUsed: 1, bestPercent: 100, passed: true });
    expect(s1.assignments[0]).toMatchObject({ submittedAt: null, grade: null });
    expect((await request(app).get('/api/v1/enrollments/grades')).status).toBe(401);
  });

  it('POST /users/import (dry run)', async () => {
    const res = await (await as('admin')).post('/api/v1/users/import').send({ csv: 'email,first_name,last_name\nnew@x.edu,New,Person\ns1@x.edu,S,One\n' });
    expect(res.status).toBe(200);
    check('POST /api/v1/users/import', res);
    expect(res.body.data.summary).toMatchObject({ rows: 2, toCreate: 1, existing: 1, created: 0 });
  });

  it('GET /courses/departments lists departments for staff only', async () => {
    const campus = await admin.campus.create({ data: { tenantId: 't-h', name: 'Main', code: 'MAIN' } });
    await admin.department.create({ data: { id: 'd-bio', campusId: campus.id, name: 'Biology', code: 'BIO' } });
    const res = await (await as('teacher')).get('/api/v1/courses/departments');
    expect(res.status).toBe(200);
    check('GET /api/v1/courses/departments', res);
    expect(res.body.data).toEqual([{ id: 'd-bio', name: 'Biology', code: 'BIO', campus: 'Main' }]);
    expect((await (await as('s1')).get('/api/v1/courses/departments')).status).toBe(403);
  });

  it('PUT /courses/:id', async () => {
    const res = await (await as('teacher')).put('/api/v1/courses/c1').send({ description: 'Updated' });
    expect(res.status).toBe(200);
    check('PUT /api/v1/courses/:id', res);
  });

  it('modules and lessons', async () => {
    const t = await as('teacher');
    const m1 = await t.post(`/api/v1/courses/${teacherCourse}/modules`).send({ title: 'One' });
    expect(m1.status).toBe(201);
    check('POST /api/v1/courses/:id/modules', m1);
    moduleA = m1.body.data.id;
    const m2 = await t.post(`/api/v1/courses/${teacherCourse}/modules`).send({ title: 'Two' });
    moduleB = m2.body.data.id;

    const l = await t.post(`/api/v1/courses/${teacherCourse}/modules/${moduleA}/lessons`).send({ title: 'Lesson', bodyContent: 'text', mediaUrl: 'https://example.com/v.mp4' });
    expect(l.status).toBe(201);
    check('POST /api/v1/courses/:id/modules/:moduleId/lessons', l);
    lesson = l.body.data.id;

    const list = await t.get(`/api/v1/courses/${teacherCourse}/modules`);
    expect(list.status).toBe(200);
    check('GET /api/v1/courses/:id/modules', list);
    expect(list.body.data).toHaveLength(2);

    const order = await t.put(`/api/v1/courses/${teacherCourse}/modules-order`).send({ moduleIds: [moduleB, moduleA] });
    expect(order.status).toBe(200);
    check('PUT /api/v1/courses/:id/modules-order', order);
    expect(order.body.data.map((m: any) => m.id)).toEqual([moduleB, moduleA]);

    const pm = await t.patch(`/api/v1/courses/${teacherCourse}/modules/${moduleA}`).send({ title: 'One renamed', isLocked: true });
    expect(pm.status).toBe(200);
    check('PATCH /api/v1/courses/:id/modules/:moduleId', pm);

    const pl = await t.patch(`/api/v1/courses/${teacherCourse}/lessons/${lesson}`).send({ title: 'Lesson renamed', bodyContent: null });
    expect(pl.status).toBe(200);
    check('PATCH /api/v1/courses/:id/lessons/:lessonId', pl);

    const dl = await t.delete(`/api/v1/courses/${teacherCourse}/lessons/${lesson}`);
    expect(dl.status).toBe(200);
    check('DELETE /api/v1/courses/:id/lessons/:lessonId', dl);

    const dm = await t.delete(`/api/v1/courses/${teacherCourse}/modules/${moduleB}`);
    expect(dm.status).toBe(200);
    check('DELETE /api/v1/courses/:id/modules/:moduleId', dm);
  });

  it('DELETE /courses/:id archives', async () => {
    const res = await (await as('admin')).delete(`/api/v1/courses/${teacherCourse}`);
    expect(res.status).toBe(200);
    check('DELETE /api/v1/courses/:id', res);
    expect(res.body.status).toBe('ARCHIVED');
  });
});

describe('contract: enrollments, users, certificates', () => {
  let certNumber: string;

  it('GET /enrollments/stats and /enrollments/todo', async () => {
    const s4 = await as('s4');
    const stats = await s4.get('/api/v1/enrollments/stats');
    expect(stats.status).toBe(200);
    check('GET /api/v1/enrollments/stats', stats);
    expect(stats.body.data.total).toBe(1);

    const todo = await s4.get('/api/v1/enrollments/todo');
    expect(todo.status).toBe(200);
    check('GET /api/v1/enrollments/todo', todo);
    expect(todo.body.data.map((i: any) => i.type).sort()).toEqual(['ASSIGNMENT', 'QUIZ']);

    const empty = await (await as('s5')).get('/api/v1/enrollments/todo');
    check('GET /api/v1/enrollments/todo', empty);
    expect(empty.body.data).toEqual([]);
  });

  it('PATCH /enrollments/:id/progress (learner, then staff completing with a certificate)', async () => {
    const learner = await (await as('s1')).patch('/api/v1/enrollments/e-s1/progress').send({ progressPercent: 50 });
    expect(learner.status).toBe(200);
    check('PATCH /api/v1/enrollments/:id/progress', learner);
    expect(learner.body.data.certificate).toBeNull();

    const done = await (await as('teacher')).patch('/api/v1/enrollments/e-s3/progress').send({ progressPercent: 100, finalGrade: 90 });
    expect(done.status).toBe(200);
    check('PATCH /api/v1/enrollments/:id/progress', done);
    expect(done.body.data.status).toBe('COMPLETED');
    expect(done.body.data.certificate).not.toBeNull();
    certNumber = done.body.data.certificate.certificateNumber;
  });

  it('GET /certificates/verify/:number is public and reveals only the documented fields', async () => {
    const res = await request(app).get(`/api/v1/certificates/verify/${certNumber}`).query({ tenant: 'harvard' });
    expect(res.status).toBe(200);
    check('GET /api/v1/certificates/verify/:number', res);
    expect(keys(res.body)).toEqual(['certificateNumber', 'course', 'expiresAt', 'institution', 'issuedAt', 'issuedTo', 'valid']);
    expect(keys(res.body.course)).toEqual(['code', 'title']);
    expect(JSON.stringify(res.body)).not.toContain('@x.edu');
    expect(res.body.valid).toBe(true);
  });

  it('GET /users never exposes secrets', async () => {
    const a = await as('admin');
    const list = await a.get('/api/v1/users').query({ limit: 5 });
    expect(list.status).toBe(200);
    check('GET /api/v1/users', list);
    for (const u of list.body.data) {
      expect(keys(u)).toEqual(
        ['_count', 'avatarUrl', 'createdAt', 'email', 'emailVerified', 'enrollmentCount', 'firstName', 'id', 'idpProvider', 'lastLoginAt', 'lastName', 'mfaEnabled', 'role', 'status', 'teachingCourseCount', 'tenantId', 'updatedAt'].sort()
      );
    }
    expect(JSON.stringify(list.body)).not.toMatch(/passwordHash|tokenVersion|mfaSecret/i);

    const one = await a.get('/api/v1/users/s1');
    expect(one.status).toBe(200);
    check('GET /api/v1/users/:id', one);
    expect(keys(one.body.data)).toEqual(['_count', 'avatarUrl', 'createdAt', 'email', 'emailVerified', 'firstName', 'id', 'idpProvider', 'lastLoginAt', 'lastName', 'mfaEnabled', 'role', 'status', 'tenantId', 'updatedAt']);

    const own = await (await as('s1')).get('/api/v1/users/s1');
    check('GET /api/v1/users/:id', own);

    const patched = await a.patch('/api/v1/users/s5').send({ firstName: 'Five', avatarUrl: 'https://example.com/a.png' });
    expect(patched.status).toBe(200);
    check('PATCH /api/v1/users/:id', patched);
    expect(keys(patched.body.data)).toEqual(['avatarUrl', 'createdAt', 'email', 'emailVerified', 'firstName', 'id', 'idpProvider', 'lastLoginAt', 'lastName', 'mfaEnabled', 'role', 'status', 'tenantId', 'updatedAt']);
  });

  it('GET /users/:id/enrollments', async () => {
    const own = await (await as('s3')).get('/api/v1/users/s3/enrollments');
    expect(own.status).toBe(200);
    check('GET /api/v1/users/:id/enrollments', own);
    expect(own.body.data[0].certificate).not.toBeNull();
    expect(keys(own.body.user)).toEqual(['email', 'firstName', 'id', 'lastName']);

    const staff = await (await as('teacher')).get('/api/v1/users/s1/enrollments');
    check('GET /api/v1/users/:id/enrollments', staff);
    expect(staff.body.data[0].certificate).toBeNull();
  });
});

describe('contract: calendar', () => {
  let tenantEvent: string;
  let courseEvent: string;

  it('POST, GET, PATCH, export and DELETE events', async () => {
    const t = await as('teacher');
    const a = await as('admin');
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    const later = new Date(Date.now() + 7_200_000).toISOString();

    const c = await t.post('/api/v1/calendar/events').send({ title: 'Exam, part 1', description: 'Line;1', category: 'EXAM', startsAt: soon, endsAt: later, courseId: 'c1', timezone: 'Asia/Kolkata' });
    expect(c.status).toBe(201);
    check('POST /api/v1/calendar/events', c);
    courseEvent = c.body.data.id;
    const w = await a.post('/api/v1/calendar/events').send({ title: 'Holiday', category: 'LECTURE', startsAt: soon, endsAt: later });
    expect(w.status).toBe(201);
    check('POST /api/v1/calendar/events', w);
    expect(w.body.data.courseId).toBeNull();
    tenantEvent = w.body.data.id;

    const list = await (await as('s1')).get('/api/v1/calendar/events');
    expect(list.status).toBe(200);
    check('GET /api/v1/calendar/events', list);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.nextDeadline.id).toBe(courseEvent);
    const none = await (await as('s5')).get('/api/v1/calendar/events').query({ from: '2000-01-01', to: '2000-01-02' });
    check('GET /api/v1/calendar/events', none);
    expect(none.body.nextDeadline).toBeNull();

    const p = await t.patch(`/api/v1/calendar/events/${courseEvent}`).send({ title: 'Exam moved' });
    expect(p.status).toBe(200);
    check('PATCH /api/v1/calendar/events/:id', p);

    const ics = await (await as('s1')).get('/api/v1/calendar/export.ics');
    expect(ics.status).toBe(200);
    expect(ics.headers['content-type']).toContain('text/calendar');
    check('GET /api/v1/calendar/export.ics', ics);
    expect(ics.text).toContain('BEGIN:VCALENDAR');

    const d = await t.delete(`/api/v1/calendar/events/${courseEvent}`);
    expect(d.status).toBe(204);
    check('DELETE /api/v1/calendar/events/:id', d);
    expect((await a.delete(`/api/v1/calendar/events/${tenantEvent}`)).status).toBe(204);
  });
});

describe('contract: mastery', () => {
  it("returns the caller's own Bloom's profile", async () => {
    const mastery = await (await as('s1')).get('/api/v1/analytics/mastery');
    expect(mastery.status).toBe(200);
    check('GET /api/v1/analytics/mastery', mastery);
    expect(mastery.body.data).toEqual([{ level: 'REMEMBER', score: 100 }]);
  });
});

describe('contract: forum moderation', () => {
  it('flags, resolve, endorse, moderate', async () => {
    const s1 = await as('s1');
    const s3 = await as('s3');
    const teacher = await as('teacher');

    const thread = (await s1.post('/api/v1/courses/c1/threads').send({ title: 'Question', body: 'Why?' })).body.data;
    const post = (await s3.post(`/api/v1/threads/${thread.id}/posts`).send({ body: 'Because.' })).body.data;
    expect((await s3.post('/api/v1/flags').send({ targetType: 'THREAD', targetId: thread.id, reason: 'spam spam' })).status).toBe(201);

    const queue = await teacher.get('/api/v1/courses/c1/flags');
    expect(queue.status).toBe(200);
    check('GET /api/v1/courses/:courseId/flags', queue);
    expect(queue.body.data).toHaveLength(1);

    const resolved = await teacher.post(`/api/v1/flags/${queue.body.data[0].id}/resolve`);
    expect(resolved.status).toBe(200);
    check('POST /api/v1/flags/:id/resolve', resolved);

    const endorsed = await teacher.post(`/api/v1/posts/${post.id}/endorse`);
    expect(endorsed.status).toBe(200);
    check('POST /api/v1/posts/:id/endorse', endorsed);
    expect(endorsed.body.data.endorsed).toBe(true);

    const pm = await teacher.patch(`/api/v1/posts/${post.id}/moderate`).send({ hidden: true });
    expect(pm.status).toBe(200);
    check('PATCH /api/v1/posts/:id/moderate', pm);

    const tm = await teacher.patch(`/api/v1/threads/${thread.id}/moderate`).send({ pinned: true, locked: true });
    expect(tm.status).toBe(200);
    check('PATCH /api/v1/threads/:id/moderate', tm);
    expect(tm.body.data.pinned).toBe(true);
  });
});
