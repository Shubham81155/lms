import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import os from 'os';
import path from 'path';
import { mkdtemp, rm } from 'fs/promises';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// Academic terms and course copy against a real PostgreSQL (row-level security on): who manages terms,
// courses in a term, and copying a course's material, not its people, into a new term with dates moved.
// Every response is also checked against its documented schema.

const PASSWORD = 'CorrectHorse1!';
const DAY = 86_400_000;
let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;
let RESPONSES: typeof import('../src/openapi/responses/learning.js').RESPONSES;
let dir: string;

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  await admin.tenant.create({ data: { id: 't-h', slug: 'harvard', name: 'harvard' } });
  const user = (id: string, role: any) =>
    admin.user.create({ data: { id, tenantId: 't-h', email: `${id}@x.edu`, firstName: id, lastName: 'L', role, passwordHash: bcrypt.hashSync(PASSWORD, 4), emailVerified: true } });
  await user('dean', 'TENANT_ADMIN');
  await user('teacher', 'INSTRUCTOR');
  await user('co-teacher', 'INSTRUCTOR');
  await user('other-teacher', 'INSTRUCTOR');
  await user('ta', 'TEACHING_ASSISTANT');
  await user('s1', 'STUDENT');

  await admin.term.create({ data: { id: 'fall', tenantId: 't-h', name: 'Fall 2026', startsOn: new Date('2026-09-01T00:00:00Z'), endsOn: new Date('2026-12-20T00:00:00Z') } });
  await admin.term.create({ data: { id: 'spring', tenantId: 't-h', name: 'Spring 2027', startsOn: new Date('2027-01-15T00:00:00Z'), endsOn: new Date('2027-05-10T00:00:00Z') } });

  await admin.course.create({
    data: {
      id: 'c1', tenantId: 't-h', code: 'CS101-F26', title: 'Intro to CS', status: 'PUBLISHED', termId: 'fall', syllabus: 'Week 1: basics',
      passingGradePercent: 60, gradeCurveMethod: 'ADD_POINTS', gradeCurveValue: 3,
    },
  });
  await admin.courseInstructor.create({ data: { courseId: 'c1', userId: 'teacher', isPrimary: true } });
  await admin.courseInstructor.create({ data: { courseId: 'c1', userId: 'co-teacher', isPrimary: false } });
  await admin.courseInstructor.create({ data: { courseId: 'c1', userId: 'ta', isPrimary: false } });
  await admin.enrollment.create({ data: { tenantId: 't-h', courseId: 'c1', userId: 's1', status: 'IN_PROGRESS' } });
  await admin.gradeCategory.create({ data: { id: 'cat-exams', tenantId: 't-h', courseId: 'c1', name: 'Exams', weightPercent: 100 } });
  await admin.module.create({
    data: { id: 'm1', courseId: 'c1', title: 'Week 1', orderIndex: 0, lessons: { create: [{ id: 'l1', title: 'Reading', orderIndex: 0 }, { id: 'l2', title: 'Slides', contentType: 'PDF_DOCUMENT', orderIndex: 1 }] } },
  });
  await admin.quiz.create({
    data: {
      id: 'q1', tenantId: 't-h', courseId: 'c1', title: 'Midterm', gradeCategoryId: 'cat-exams', dueAt: new Date('2026-10-15T12:00:00Z'), availableFrom: new Date('2026-10-14T12:00:00Z'),
      questions: { create: [{ questionText: '2 + 2?', points: 2, optionsJson: [{ id: 'o4', text: '4', isCorrect: true }] }] },
    },
  });
  await admin.assignment.create({
    data: { id: 'a1', tenantId: 't-h', courseId: 'c1', title: 'Essay', instructions: 'Write', maxPoints: 10, dueDate: new Date('2026-11-01T12:00:00Z'), rubricJson: [{ id: 'r1', name: 'Clarity', maxPoints: 10 }] },
  });
  await admin.assignmentSubmission.create({ data: { assignmentId: 'a1', userId: 's1', submissionText: 'mine', grade: 9 } });
  await admin.questionBankItem.create({ data: { tenantId: 't-h', courseId: 'c1', ownerId: 'teacher', questionText: 'Bank question', tags: ['week1'] } });

  dir = await mkdtemp(path.join(os.tmpdir(), 'lms-copy-test-'));
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
  RESPONSES = (await import('../src/openapi/responses/learning.js')).RESPONSES;
  const storage = await import('../src/lib/storage.js');
  storage.setStorageDriver(storage.localDriver(dir));
}, 240_000);

afterAll(async () => {
  await admin?.$disconnect();
  await db?.stop();
  if (dir) await rm(dir, { recursive: true, force: true });
}, 60_000);

async function as(who: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').set('x-tenant-id', 'harvard').send({ email: `${who}@x.edu`, password: PASSWORD });
  expect(res.status, `login as ${who}`).toBe(200);
  return agent;
}

/** Asserts the status, and that the body satisfies the documented schema of that status. */
function check(key: string, res: { status: number; body: any }, status: number) {
  expect(res.status, `${key}: ${JSON.stringify(res.body)}`).toBe(status);
  const entry = RESPONSES[key];
  expect(entry, `no entry for ${key}`).toBeDefined();
  const doc = [entry.response!, ...(entry.otherResponses ?? [])].find((d) => d.status === status);
  expect(doc, `${key}: status ${status} is not documented`).toBeDefined();
  if (doc!.schema) {
    const r = doc!.schema.safeParse(res.body);
    expect(r.success, `${key}: ${JSON.stringify(r.success ? res.body : r.error)}`).toBe(true);
  }
  return res.body;
}

describe('terms', () => {
  it('are listed for everyone and managed by administrators', async () => {
    const list = check('GET /api/v1/terms', await (await as('s1')).get('/api/v1/terms'), 200);
    expect(list.data.map((t: any) => [t.name, t.courseCount])).toEqual([['Spring 2027', 0], ['Fall 2026', 1]]);

    const body = { name: 'Summer 2027', startsOn: '2027-06-01', endsOn: '2027-08-15' };
    expect((await (await as('teacher')).post('/api/v1/terms').send(body)).status).toBe(403);
    const dean = await as('dean');
    const created = check('POST /api/v1/terms', await dean.post('/api/v1/terms').send(body), 201);
    expect((await dean.post('/api/v1/terms').send(body)).status).toBe(409);
    expect((await dean.post('/api/v1/terms').send({ ...body, name: 'Backwards', endsOn: '2027-05-01' })).status).toBe(400);
    check('PATCH /api/v1/terms/:id', await dean.patch(`/api/v1/terms/${created.data.id}`).send({ name: 'Summer session 2027' }), 200);
    expect((await dean.patch(`/api/v1/terms/${created.data.id}`).send({ endsOn: '2027-05-01' })).status).toBe(400);
    check('DELETE /api/v1/terms/:id', await dean.delete(`/api/v1/terms/${created.data.id}`), 204);
    expect((await dean.delete('/api/v1/terms/fall')).status).toBe(409); // a course belongs to it
  });

  it('group courses, and the course list filters by them', async () => {
    const t = await as('teacher');
    expect((await t.put('/api/v1/courses/c1').send({ termId: 'nope' })).status).toBe(400);
    const byTerm = await t.get('/api/v1/courses').query({ termId: 'fall' });
    expect(byTerm.body.data.map((c: any) => [c.code, c.term?.name])).toEqual([['CS101-F26', 'Fall 2026']]);
    expect((await t.get('/api/v1/courses').query({ termId: 'spring' })).body.data).toEqual([]);
  });
});

describe('course copy', () => {
  let lessonFileUrl: string;
  let copyId: string;

  it('is for the course’s editors only', async () => {
    const body = { code: 'NOPE' };
    expect((await (await as('other-teacher')).post('/api/v1/courses/c1/copy').send(body)).status).toBe(403);
    expect((await (await as('ta')).post('/api/v1/courses/c1/copy').send(body)).status).toBe(403);
    expect((await (await as('s1')).post('/api/v1/courses/c1/copy').send(body)).status).toBe(403);
    expect((await (await as('teacher')).post('/api/v1/courses/c1/copy').send({ code: 'CS101-F26' })).status).toBe(409);
  });

  it('copies the material into a draft in the new term, dates moved by the gap between terms', async () => {
    const t = await as('teacher');
    const up = await t.post('/api/v1/files').query({ purpose: 'LESSON_MEDIA', courseId: 'c1', filename: 'slides.pdf' }).set('content-type', 'application/pdf').send(Buffer.from('%PDF-1.4 slides'));
    expect(up.status).toBe(201);
    lessonFileUrl = up.body.data.url;
    expect((await t.patch('/api/v1/courses/c1/lessons/l2').send({ mediaUrl: lessonFileUrl })).status).toBe(200);

    const res = check('POST /api/v1/courses/:id/copy', await t.post('/api/v1/courses/c1/copy').send({ code: 'CS101-S27', termId: 'spring' }), 201);
    const shift = Math.round((Date.parse('2027-01-15T00:00:00Z') - Date.parse('2026-09-01T00:00:00Z')) / DAY);
    expect(res.data.shiftDays).toBe(shift);
    expect(res.data.copied).toEqual({ modules: 1, lessons: 2, quizzes: 1, questions: 1, assignments: 1, gradeCategories: 1, questionBankItems: 1, files: 1 });
    expect(res.data.course).toMatchObject({ code: 'CS101-S27', title: 'Intro to CS', status: 'DRAFT', termId: 'spring' });
    copyId = res.data.course.id;

    const copy = await admin.course.findUniqueOrThrow({
      where: { id: copyId },
      include: { instructors: true, enrollments: true, gradeCategories: true, quizzes: { include: { questions: true } }, assignments: { include: { submissions: true } }, modules: { include: { lessons: true } } },
    });
    expect(copy).toMatchObject({ syllabus: 'Week 1: basics', passingGradePercent: 60, gradeCurveMethod: 'ADD_POINTS', gradeCurveValue: 3 });
    expect(copy.instructors.map((i) => [i.userId, i.isPrimary]).sort()).toEqual([['co-teacher', false], ['ta', false], ['teacher', true]]);
    expect(copy.enrollments).toEqual([]);
    expect(copy.assignments[0].submissions).toEqual([]);
    expect(copy.assignments[0].dueDate!.getTime()).toBe(Date.parse('2026-11-01T12:00:00Z') + shift * DAY);
    expect(copy.assignments[0].rubricJson).toEqual([{ id: 'r1', name: 'Clarity', maxPoints: 10 }]);
    expect(copy.quizzes[0].dueAt!.getTime()).toBe(Date.parse('2026-10-15T12:00:00Z') + shift * DAY);
    expect(copy.quizzes[0].questions[0]).toMatchObject({ questionText: '2 + 2?', points: 2 });
    // The quiz counts toward the new course's own category, not the old one.
    expect(copy.quizzes[0].gradeCategoryId).toBe(copy.gradeCategories[0].id);
    expect(copy.gradeCategories[0].id).not.toBe('cat-exams');
    expect(await admin.questionBankItem.count({ where: { courseId: copyId, tags: { has: 'week1' } } })).toBe(1);
  });

  it('gives the copy its own copy of uploaded lesson files', async () => {
    const lessons = (await admin.lesson.findMany({ where: { module: { courseId: copyId } }, orderBy: { orderIndex: 'asc' } }));
    const newUrl = lessons[1].mediaUrl!;
    expect(newUrl).toMatch(/^\/api\/v1\/files\//);
    expect(newUrl).not.toBe(lessonFileUrl);
    const file = await admin.storedFile.findUniqueOrThrow({ where: { id: newUrl.split('/').pop()! } });
    expect(file).toMatchObject({ courseId: copyId, purpose: 'LESSON_MEDIA', filename: 'slides.pdf' });

    const download = await (await as('teacher')).get(newUrl).buffer(true);
    expect(download.status).toBe(200);
    expect(download.body.toString()).toBe('%PDF-1.4 slides');
    // The original is untouched.
    expect((await (await as('teacher')).get(lessonFileUrl)).status).toBe(200);
  });

  it('takes an explicit date shift and a new title, and stays in the term when none is given', async () => {
    const res = check('POST /api/v1/courses/:id/copy', await (await as('dean')).post('/api/v1/courses/c1/copy').send({ code: 'CS101-F26B', title: 'Intro to CS (section B)', shiftDays: 0 }), 201);
    expect(res.data).toMatchObject({ shiftDays: 0, course: { title: 'Intro to CS (section B)', termId: 'fall' } });
    const a = await admin.assignment.findFirstOrThrow({ where: { courseId: res.data.course.id } });
    expect(a.dueDate!.toISOString()).toBe('2026-11-01T12:00:00.000Z');
    // An administrator's copy keeps the original teaching team.
    const team = await admin.courseInstructor.findMany({ where: { courseId: res.data.course.id }, orderBy: { userId: 'asc' } });
    expect(team.map((i) => [i.userId, i.isPrimary])).toEqual([['co-teacher', false], ['ta', false], ['teacher', true]]);
    expect(await admin.auditLog.count({ where: { action: 'COURSE_COPIED' } })).toBe(2);
  });
});
