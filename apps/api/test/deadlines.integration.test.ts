import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// Deadlines against a real PostgreSQL: quiz windows, late assignments and the late-work cutoff, per-learner
// extensions, the to-do list, and what learners may see when reviewing an attempt.

const PASSWORD = 'CorrectHorse1!';
const DAY = 86_400_000;
const at = (offsetMs: number) => new Date(Date.now() + offsetMs);
let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  await admin.tenant.create({ data: { id: 't-h', slug: 'harvard', name: 'harvard' } });
  const user = (id: string, role: any) =>
    admin.user.create({
      data: {
        id,
        tenantId: 't-h',
        email: `${id}@x.edu`,
        firstName: id,
        lastName: 'L',
        role,
        passwordHash: bcrypt.hashSync(PASSWORD, 4),
        emailVerified: true,
      },
    });
  await user('teacher', 'INSTRUCTOR');
  await user('other-teacher', 'INSTRUCTOR');
  for (const s of ['s1', 's2', 's3', 'outsider']) await user(s, 'STUDENT');
  await admin.course.create({ data: { id: 'c1', tenantId: 't-h', code: 'C1', title: 'Course', status: 'PUBLISHED' } });
  await admin.courseInstructor.create({ data: { courseId: 'c1', userId: 'teacher', isPrimary: true } });
  for (const s of ['s1', 's2', 's3'])
    await admin.enrollment.create({ data: { tenantId: 't-h', courseId: 'c1', userId: s, status: 'IN_PROGRESS' } });

  const mc = (quizId: string) => ({
    quizId,
    questionText: '2 + 2?',
    questionType: 'MULTIPLE_CHOICE' as const,
    points: 1,
    explanation: 'Arithmetic.',
    optionsJson: [
      { id: 'o4', text: '4', isCorrect: true },
      { id: 'o5', text: '5', isCorrect: false },
    ],
  });
  await admin.quiz.create({
    data: {
      id: 'q-later',
      tenantId: 't-h',
      courseId: 'c1',
      title: 'Not yet open',
      availableFrom: at(DAY),
      questions: { create: [mc('q-later')].map(({ quizId, ...q }) => q) },
    },
  });
  await admin.quiz.create({
    data: {
      id: 'q-closed',
      tenantId: 't-h',
      courseId: 'c1',
      title: 'Closed',
      dueAt: at(-DAY),
      maxAttempts: 2,
      questions: { create: [mc('q-closed')].map(({ quizId, ...q }) => q) },
    },
  });
  await admin.quiz.create({
    data: {
      id: 'q-answers',
      tenantId: 't-h',
      courseId: 'c1',
      title: 'Reveal',
      reviewPolicy: 'ANSWERS',
      maxAttempts: 2,
      questions: { create: [mc('q-answers')].map(({ quizId, ...q }) => q) },
    },
  });
  await admin.quiz.create({
    data: {
      id: 'q-score',
      tenantId: 't-h',
      courseId: 'c1',
      title: 'Score only',
      reviewPolicy: 'SCORE_ONLY',
      questions: { create: [mc('q-score')].map(({ quizId, ...q }) => q) },
    },
  });

  await admin.assignment.create({
    data: { id: 'a-late', tenantId: 't-h', courseId: 'c1', title: 'Past due', instructions: 'Write', dueDate: at(-DAY) },
  });
  await admin.assignment.create({
    data: {
      id: 'a-cutoff',
      tenantId: 't-h',
      courseId: 'c1',
      title: 'Hard cutoff',
      instructions: 'Write',
      dueDate: at(-2 * DAY),
      acceptLateUntil: at(-DAY),
    },
  });

  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
}, 240_000);

afterAll(async () => {
  await admin?.$disconnect();
  await db?.stop();
}, 60_000);

async function as(who: string) {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/v1/auth/login')
    .set('x-tenant-id', 'harvard')
    .send({ email: `${who}@x.edu`, password: PASSWORD });
  expect(res.status, `login as ${who}`).toBe(200);
  return agent;
}

const extend = (who: string, body: object) => as(who).then((a) => a.put('/api/v1/extensions').send(body));

describe('quiz availability', () => {
  it('refuses to start before the quiz opens or after it closes', async () => {
    const s1 = await as('s1');
    const early = await s1.post('/api/v1/quizzes/q-later/start');
    expect(early.status).toBe(403);
    expect(early.body.error).toMatch(/opens/);
    expect((await s1.post('/api/v1/quizzes/q-later/submit').send({ answers: {} })).status).toBe(403);
    const late = await s1.post('/api/v1/quizzes/q-closed/start');
    expect(late.status).toBe(403);
    expect(late.body.error).toMatch(/closed/);
  });

  it('lets a learner with an extension in, and only them', async () => {
    const r = await extend('teacher', {
      itemType: 'QUIZ',
      itemId: 'q-closed',
      userId: 's2',
      dueAt: at(DAY).toISOString(),
      reason: 'Medical',
    });
    expect(r.status).toBe(200);
    expect((await (await as('s2')).post('/api/v1/quizzes/q-closed/start')).status).toBe(201);
    expect((await (await as('s1')).post('/api/v1/quizzes/q-closed/start')).status).toBe(403);
    // The learner was told about it.
    expect(await admin.notification.count({ where: { userId: 's2', title: { contains: 'Extension' } } })).toBe(1);
    expect(await admin.auditLog.count({ where: { action: 'DEADLINE_EXTENDED' } })).toBe(1);
  });

  it('still accepts an attempt that was started before the quiz closed', async () => {
    await admin.quiz.update({ where: { id: 'q-answers' }, data: { dueAt: null } });
    const s3 = await as('s3');
    expect((await s3.post('/api/v1/quizzes/q-answers/start')).status).toBe(201);
    await admin.quiz.update({ where: { id: 'q-answers' }, data: { dueAt: at(-60_000) } });
    const done = await s3
      .post('/api/v1/quizzes/q-answers/submit')
      .send({ answers: { [(await admin.quizQuestion.findFirstOrThrow({ where: { quizId: 'q-answers' } })).id]: 'o5' } });
    expect(done.status).toBe(201);
    await admin.quiz.update({ where: { id: 'q-answers' }, data: { dueAt: null } });
  });
});

describe('assignments', () => {
  it('stores a late flag, and refuses work after the cutoff', async () => {
    const s1 = await as('s1');
    const late = await s1.post('/api/v1/assignments/a-late/submit').send({ submissionText: 'mine' });
    expect(late.status).toBe(201);
    expect(late.body.data.isLate).toBe(true);
    expect((await admin.assignmentSubmission.findFirstOrThrow({ where: { assignmentId: 'a-late', userId: 's1' } })).isLate).toBe(true);
    const shut = await s1.post('/api/v1/assignments/a-cutoff/submit').send({ submissionText: 'mine' });
    expect(shut.status).toBe(403);
    expect(shut.body.error).toMatch(/no longer accepts/);
  });

  it('an extension moves both the due date and the cutoff for that learner', async () => {
    expect(
      (await extend('teacher', { itemType: 'ASSIGNMENT', itemId: 'a-cutoff', userId: 's2', dueAt: at(DAY).toISOString() })).status
    ).toBe(200);
    const ok = await (await as('s2')).post('/api/v1/assignments/a-cutoff/submit').send({ submissionText: 'on time now' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.isLate).toBe(false);

    const mine = (await (await as('s2')).get('/api/v1/courses/c1/assignments')).body.data.find((x: any) => x.id === 'a-cutoff');
    expect(mine).toMatchObject({ extended: true });
    expect(new Date(mine.myDueAt).getTime()).toBeGreaterThan(Date.now());
    expect(mine._count).toBeUndefined();

    const grades = (await (await as('s1')).get('/api/v1/enrollments/grades')).body.data[0];
    expect(grades.assignments.find((a: any) => a.id === 'a-late').late).toBe(true);
  });

  it('shows the learner their own deadlines in the to-do list', async () => {
    const todo = (await (await as('s2')).get('/api/v1/enrollments/todo')).body.data;
    const closed = todo.find((i: any) => i.id === 'q-closed');
    expect(closed).toMatchObject({ extended: true });
    expect(new Date(closed.dueAt).getTime()).toBeGreaterThan(Date.now());
    expect(todo.find((i: any) => i.id === 'q-later').opensAt).toBeTruthy();
    // Without an extension a closed quiz is not on the list.
    const s1todo = (await (await as('s1')).get('/api/v1/enrollments/todo')).body.data;
    expect(s1todo.some((i: any) => i.id === 'q-closed')).toBe(false);
  });
});

describe('granting extensions', () => {
  it('is for the course staff, for enrolled learners, and only later than the due date', async () => {
    const body = { itemType: 'ASSIGNMENT', itemId: 'a-late', userId: 's3', dueAt: at(DAY).toISOString() };
    expect((await extend('s1', body)).status).toBe(403);
    expect((await extend('other-teacher', body)).status).toBe(403);
    expect((await extend('teacher', { ...body, userId: 'outsider' })).status).toBe(400);
    expect((await extend('teacher', { ...body, dueAt: at(-1000).toISOString() })).status).toBe(400);
    expect((await extend('teacher', { ...body, itemId: 'nope' })).status).toBe(404);
    expect((await extend('teacher', { ...body, itemType: 'ESSAY' })).status).toBe(400);

    const granted = await extend('teacher', body);
    const again = await extend('teacher', { ...body, dueAt: at(2 * DAY).toISOString() });
    expect(again.body.data.id).toBe(granted.body.data.id); // one per learner, updated in place
    const t = await as('teacher');
    expect((await t.get('/api/v1/extensions?itemType=ASSIGNMENT&itemId=a-late')).body.data).toHaveLength(1);
    expect((await (await as('s3')).get('/api/v1/extensions?itemType=ASSIGNMENT&itemId=a-late')).status).toBe(403);
    expect((await t.delete(`/api/v1/extensions/${granted.body.data.id}`)).status).toBe(204);
    expect((await t.delete(`/api/v1/extensions/${granted.body.data.id}`)).status).toBe(404);
  });
});

describe('reviewing an attempt', () => {
  const finish = async (who: string, quizId: string, answer: string) => {
    const question = await admin.quizQuestion.findFirstOrThrow({ where: { quizId } });
    const r = await (await as(who)).post(`/api/v1/quizzes/${quizId}/submit`).send({ answers: { [question.id]: answer } });
    expect(r.status).toBe(201);
    return r.body.data.submissionId as string;
  };

  it('shows only the score under SCORE_ONLY', async () => {
    const id = await finish('s1', 'q-score', 'o4');
    const r = await (await as('s1')).get(`/api/v1/quizzes/q-score/submissions/${id}/review`);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ reviewPolicy: 'SCORE_ONLY', questions: [], score: 1 });
  });

  it('reveals correct answers under ANSWERS only once no attempts are left', async () => {
    const first = await finish('s1', 'q-answers', 'o5');
    const s1 = await as('s1');
    let r = await s1.get(`/api/v1/quizzes/q-answers/submissions/${first}/review`);
    expect(r.body.data.answersRevealed).toBe(false);
    expect(r.body.data.questions[0]).toMatchObject({ yourAnswer: 'o5', isCorrect: false });
    expect(r.body.data.questions[0].correctOptionIds).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toContain('Arithmetic');

    await finish('s1', 'q-answers', 'o4'); // last attempt
    r = await s1.get(`/api/v1/quizzes/q-answers/submissions/${first}/review`);
    expect(r.body.data.answersRevealed).toBe(true);
    expect(r.body.data.questions[0]).toMatchObject({ correctOptionIds: ['o4'], explanation: 'Arithmetic.' });
  });

  it('keeps attempts private to their owner and the course staff', async () => {
    const sub = await admin.quizSubmission.findFirstOrThrow({ where: { quizId: 'q-score', userId: 's1' } });
    expect((await (await as('s2')).get(`/api/v1/quizzes/q-score/submissions/${sub.id}/review`)).status).toBe(404);
    const staff = await (await as('teacher')).get(`/api/v1/quizzes/q-score/submissions/${sub.id}/review`);
    expect(staff.body.data.questions[0].correctOptionIds).toEqual(['o4']);
  });
});
