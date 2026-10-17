import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// Contract test: every response described in src/openapi/responses/assessment.ts is parsed against
// what the real API returns, against a real PostgreSQL.

const PASSWORD = 'CorrectHorse1!';
let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;
let R: typeof import('../src/openapi/responses/assessment.js').RESPONSES;
const pw = (slug: string) => `${PASSWORD}-${slug}`;
const covered = new Set<string>();

async function seed() {
  await admin.tenant.create({ data: { id: 't-h', slug: 'harvard', name: 'harvard' } });
  const user = (id: string, role: any) =>
    admin.user.create({ data: { id, tenantId: 't-h', email: `${id}@x.edu`, firstName: id, lastName: 'L', role, passwordHash: bcrypt.hashSync(pw('harvard'), 4), emailVerified: true } });
  await user('admin', 'TENANT_ADMIN');
  await user('teacher', 'INSTRUCTOR');
  await user('s1', 'STUDENT');
  await user('s2', 'STUDENT');
  await admin.course.create({ data: { id: 'c1', tenantId: 't-h', code: 'C1', title: 'Course c1', status: 'PUBLISHED' } });
  await admin.courseInstructor.create({ data: { courseId: 'c1', userId: 'teacher', isPrimary: true } });
  for (const s of ['s1', 's2']) await admin.enrollment.create({ data: { id: `e-${s}`, tenantId: 't-h', courseId: 'c1', userId: s, status: 'IN_PROGRESS', progressPercent: 10 } });
}

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  await seed();
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
  R = (await import('../src/openapi/responses/assessment.js')).RESPONSES;
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

/** Asserts the status and, when the operation documents that status with a schema, that the body matches it. */
function contract(key: string, res: { status: number; body: any }, status: number) {
  expect(res.status, `${key}: ${JSON.stringify(res.body)}`).toBe(status);
  const entry = R[key];
  expect(entry, `${key} is described`).toBeTruthy();
  const doc = [entry.response, ...(entry.otherResponses ?? [])].find((d) => d?.status === status);
  expect(doc, `${key} documents ${status}`).toBeTruthy();
  if (doc!.schema) {
    const result = doc!.schema.safeParse(res.body);
    expect(result.success, `${key} ${status}: ${JSON.stringify(result.success ? res.body : result.error)}`).toBe(true);
  }
  covered.add(key);
  return res.body;
}

const V1 = '/api/v1';
let teacher: request.Agent, s1: request.Agent, s2: request.Agent, adminA: request.Agent;
let quizId: string, mcId: string, essayId: string, optionIds: string[];
let assignId: string, subS1: string, subS2: string, criterionId: string, appealId: string, quizSubId: string;

describe('quizzes', () => {
  it('creates, edits and lists quizzes and questions', async () => {
    teacher = await as('teacher');
    s1 = await as('s1');
    s2 = await as('s2');
    adminA = await as('admin');

    const created = contract('POST /api/v1/courses/:courseId/quizzes', await teacher.post(`${V1}/courses/c1/quizzes`).send({ title: 'Quiz A', maxAttempts: 3, requireProctoring: true, passingPercent: 50 }), 201);
    quizId = created.data.id;

    let r = await teacher.post(`${V1}/quizzes/${quizId}/questions`).send({
      questionText: 'Pick the right one',
      questionType: 'MULTIPLE_CHOICE',
      points: 2,
      explanation: 'Because',
      bloomLevel: 'APPLY',
      optionsJson: [{ text: 'right', isCorrect: true }, { text: 'wrong', isCorrect: false }],
    });
    mcId = contract('POST /api/v1/quizzes/:id/questions', r, 201).data.id;
    r = await teacher.post(`${V1}/quizzes/${quizId}/questions`).send({ questionText: 'Discuss', questionType: 'ESSAY', points: 4 });
    essayId = contract('POST /api/v1/quizzes/:id/questions', r, 201).data.id;
    const extra = await teacher.post(`${V1}/quizzes/${quizId}/questions`).send({ questionText: 'Temp', questionType: 'SHORT_ANSWER', correctAnswer: 'x' });

    contract('PATCH /api/v1/quizzes/:id/questions/:questionId', await teacher.patch(`${V1}/quizzes/${quizId}/questions/${essayId}`).send({ points: 3 }), 200);
    contract('DELETE /api/v1/quizzes/:id/questions/:questionId', await teacher.delete(`${V1}/quizzes/${quizId}/questions/${extra.body.data.id}`), 200);
    contract('PATCH /api/v1/quizzes/:id', await teacher.patch(`${V1}/quizzes/${quizId}`).send({ title: 'Quiz A2', timeLimitMins: 30 }), 200);
    contract('GET /api/v1/courses/:courseId/quizzes', await teacher.get(`${V1}/courses/c1/quizzes`), 200);
    contract('GET /api/v1/courses/:courseId/quizzes', await s1.get(`${V1}/courses/c1/quizzes`), 200);

    const scratch = await teacher.post(`${V1}/courses/c1/quizzes`).send({ title: 'Scratch' });
    contract('DELETE /api/v1/quizzes/:id', await teacher.delete(`${V1}/quizzes/${scratch.body.data.id}`), 200);
  });

  it('shows staff the answer key and learners none of it', async () => {
    const staff = await teacher.get(`${V1}/quizzes/${quizId}`);
    contract('GET /api/v1/quizzes/:id', staff, 200);
    expect(JSON.stringify(staff.body)).toContain('isCorrect');
    optionIds = staff.body.data.questions.find((q: any) => q.id === mcId).optionsJson.map((o: any) => o.id);

    const learner = await s1.get(`${V1}/quizzes/${quizId}`);
    contract('GET /api/v1/quizzes/:id', learner, 200);
    const text = JSON.stringify(learner.body);
    for (const leak of ['isCorrect', 'correctAnswer', 'explanation', 'bloomLevel']) expect(text, `learner view leaks ${leak}`).not.toContain(leak);
    expect(learner.body.data.questions.length).toBe(2);
  });

  it('runs an attempt: proctoring events, submit, submissions, manual grade', async () => {
    const start = await s1.post(`${V1}/quizzes/${quizId}/start`);
    expect(start.status).toBe(201);
    const attempt = start.body.data.submissionId;

    const ev = await s1.post(`${V1}/proctoring/events`).send({ submissionId: attempt, eventType: 'TAB_SWITCH', severity: 'HIGH' });
    contract('POST /api/v1/proctoring/events', ev, 201);

    const submit = await s1.post(`${V1}/quizzes/${quizId}/submit`).send({ answers: { [mcId]: optionIds[0], [essayId]: 'my essay' } });
    expect(submit.status).toBe(201);
    quizSubId = submit.body.data.submissionId;

    const own = await s1.get(`${V1}/quizzes/${quizId}/submissions`);
    contract('GET /api/v1/quizzes/:id/submissions', own, 200);
    expect(JSON.stringify(own.body)).not.toContain('answersJson');
    expect(own.body.data[0].pendingManualGrading).toBe(true);

    const staff = await teacher.get(`${V1}/quizzes/${quizId}/submissions`);
    contract('GET /api/v1/quizzes/:id/submissions', staff, 200);
    expect(staff.body.data[0].answersJson).toBeTruthy();
    expect(staff.body.data[0].user.email).toBe('s1@x.edu');

    contract('PATCH /api/v1/quizzes/:id/submissions/:subId/grade', await teacher.patch(`${V1}/quizzes/${quizId}/submissions/${quizSubId}/grade`).send({ grades: { [essayId]: 3 } }), 200);

    contract('GET /api/v1/quizzes/:quizId/proctoring', await teacher.get(`${V1}/quizzes/${quizId}/proctoring`), 200);
    contract('GET /api/v1/analytics/proctoring', await teacher.get(`${V1}/analytics/proctoring`), 200);

    // Refused once there are submissions (documented 409s).
    expect((await teacher.delete(`${V1}/quizzes/${quizId}`)).status).toBe(409);
    expect((await teacher.delete(`${V1}/quizzes/${quizId}/questions/${mcId}`)).status).toBe(409);
  });
});

describe('assignments, rubrics and appeals', () => {
  it('creates an assignment with a rubric and takes submissions', async () => {
    const created = contract('POST /api/v1/courses/:courseId/assignments', await teacher.post(`${V1}/courses/c1/assignments`).send({ title: 'Essay', instructions: 'Write', maxPoints: 100 }), 201);
    assignId = created.data.id;
    contract('PATCH /api/v1/assignments/:id', await teacher.patch(`${V1}/assignments/${assignId}`).send({ dueDate: '2099-01-01T00:00:00.000Z' }), 200);

    const rubric = contract('PUT /api/v1/assignments/:id/rubric', await teacher.put(`${V1}/assignments/${assignId}/rubric`).send({ criteria: [{ name: 'Clarity', maxPoints: 5 }, { name: 'Depth', maxPoints: 5 }] }), 200);
    expect(rubric.data.maxPoints).toBe(10);
    criterionId = rubric.data.rubric[0].id;
    const second = rubric.data.rubric[1].id;
    (globalThis as any).__second = second;

    const staffList = await teacher.get(`${V1}/courses/c1/assignments`);
    contract('GET /api/v1/courses/:courseId/assignments', staffList, 200);
    expect(staffList.body.data[0]._count.submissions).toBe(0);
    const learnerList = await s1.get(`${V1}/courses/c1/assignments`);
    contract('GET /api/v1/courses/:courseId/assignments', learnerList, 200);
    expect(learnerList.body.data[0]._count).toBeUndefined();

    const a = await s1.post(`${V1}/assignments/${assignId}/submit`).send({ submissionText: 'mine' });
    subS1 = contract('POST /api/v1/assignments/:id/submit', a, 201).data.id;
    const b = await s2.post(`${V1}/assignments/${assignId}/submissions`).send({ submissionText: 'theirs' });
    subS2 = contract('POST /api/v1/assignments/:id/submissions', b, 201).data.id;

    const own = await s1.get(`${V1}/assignments/${assignId}/submissions`);
    contract('GET /api/v1/assignments/:id/submissions', own, 200);
    expect(own.body.data.length).toBe(1);
    expect(own.body.data[0].user).toBeUndefined();
    const all = await teacher.get(`${V1}/assignments/${assignId}/submissions`);
    contract('GET /api/v1/assignments/:id/submissions', all, 200);
    expect(all.body.data.length).toBe(2);
    expect(all.body.data[0].user.email).toBeTruthy();

    const history = await teacher.get(`${V1}/assignments/${assignId}/submissions/${subS1}/versions`);
    contract('GET /api/v1/assignments/:id/submissions/:subId/versions', history, 200);
    expect(history.body.data).toHaveLength(1);

    const pending = await teacher.get(`${V1}/analytics/pending-grading`);
    contract('GET /api/v1/analytics/pending-grading', pending, 200);
    expect(pending.body.total).toBe(2);
  });

  it('grades, appeals and resolves', async () => {
    const second = (globalThis as any).__second;
    const g = await teacher.patch(`${V1}/assignments/${assignId}/submissions/${subS1}/grade`).send({ criteria: { [criterionId]: 2, [second]: 2 }, feedback: 'ok' });
    const graded = contract('PATCH /api/v1/assignments/:id/submissions/:subId/grade', g, 200);
    expect(graded.data.grade).toBe(4);

    const ap = await s1.post(`${V1}/assignments/${assignId}/submissions/${subS1}/appeal`).send({ reason: 'I think this deserves more' });
    appealId = contract('POST /api/v1/assignments/:id/submissions/:subId/appeal', ap, 201).data.id;

    const staffAppeals = await teacher.get(`${V1}/courses/c1/appeals`);
    contract('GET /api/v1/courses/:courseId/appeals', staffAppeals, 200);
    expect(staffAppeals.body.data[0].student).toBeTruthy();
    const own = await s1.get(`${V1}/courses/c1/appeals`);
    contract('GET /api/v1/courses/:courseId/appeals', own, 200);
    expect(own.body.data[0].student).toBeUndefined();
    expect(own.body.data[0].submission.text).toBeUndefined();

    const res = await teacher.post(`${V1}/appeals/${appealId}/resolve`).send({ decision: 'UPHELD', response: 'Fair point', criteria: { [criterionId]: 4, [second]: 4 } });
    const resolved = contract('POST /api/v1/appeals/:id/resolve', res, 200);
    expect(resolved.data.status).toBe('UPHELD');
    contract('GET /api/v1/courses/:courseId/appeals', await teacher.get(`${V1}/courses/c1/appeals`), 200);

    const scratch = await teacher.post(`${V1}/courses/c1/assignments`).send({ title: 'Scratch', instructions: 'x' });
    contract('DELETE /api/v1/assignments/:id', await teacher.delete(`${V1}/assignments/${scratch.body.data.id}`), 200);
    expect((await teacher.delete(`${V1}/assignments/${assignId}`)).status).toBe(409);
  });
});

describe('question bank', () => {
  it('creates, lists, edits, copies into a quiz and deletes', async () => {
    const c = await teacher.post(`${V1}/question-bank`).send({
      questionText: 'Bank question',
      questionType: 'MULTIPLE_CHOICE',
      tags: ['Math', 'math'],
      bloomLevel: 'REMEMBER',
      courseId: 'c1',
      optionsJson: [{ text: 'a', isCorrect: true }, { text: 'b', isCorrect: false }],
    });
    const id = contract('POST /api/v1/question-bank', c, 201).data.id;
    contract('GET /api/v1/question-bank', await teacher.get(`${V1}/question-bank?tag=math`), 200);
    contract('GET /api/v1/question-bank/:id', await teacher.get(`${V1}/question-bank/${id}`), 200);
    contract('PATCH /api/v1/question-bank/:id', await teacher.patch(`${V1}/question-bank/${id}`).send({ points: 5, tags: ['x'] }), 200);

    const quiz = await teacher.post(`${V1}/courses/c1/quizzes`).send({ title: 'From bank' });
    const copied = await teacher.post(`${V1}/quizzes/${quiz.body.data.id}/questions/from-bank`).send({ itemIds: [id] });
    contract('POST /api/v1/quizzes/:quizId/questions/from-bank', copied, 201);
    expect(copied.body.data[0].points).toBe(5);

    const del = await teacher.delete(`${V1}/question-bank/${id}`);
    contract('DELETE /api/v1/question-bank/:id', del, 204);
  });
});

describe('intelligence and analytics', () => {
  it('records and streams xAPI statements', async () => {
    const stmt = (n: number) => ({ actor: { mbox: 'mailto:s1@x.edu' }, verb: { id: 'http://adlnet.gov/expapi/verbs/experienced' }, object: { id: `https://example.com/a/${n}` } });
    contract('POST /api/v1/xapi/statements', await s1.post(`${V1}/xapi/statements`).send(stmt(1)), 201);
    contract('POST /api/v1/xapi/statements', await s1.post(`${V1}/xapi/statements`).send([stmt(2), stmt(3)]), 200);
    const staff = await teacher.get(`${V1}/analytics/xapi/stream?limit=5`);
    contract('GET /api/v1/analytics/xapi/stream', staff, 200);
    expect(staff.body.statements.length).toBeGreaterThan(0);
    contract('GET /api/v1/analytics/xapi/stream', await s1.get(`${V1}/analytics/xapi/stream`), 200);
  });

  it('computes at-risk learners, nudges, cohort analytics and tutor drills', async () => {
    await admin.user.update({ where: { id: 's2' }, data: { lastLoginAt: new Date(Date.now() - 30 * 86_400_000) } });
    const risk = await teacher.get(`${V1}/analytics/at-risk?courseId=c1`);
    contract('GET /api/v1/analytics/at-risk', risk, 200);
    expect(risk.body.total).toBeGreaterThan(0);
    contract('POST /api/v1/analytics/at-risk/nudge', await teacher.post(`${V1}/analytics/at-risk/nudge`).send({ courseId: 'c1', userId: 's2', message: 'hi' }), 201);

    const cohort = await teacher.get(`${V1}/analytics/cohort`);
    contract('GET /api/v1/analytics/cohort', cohort, 200);
    expect(cohort.body.itemAnalysis.length).toBeGreaterThan(0);
    expect(cohort.body.bloomsMastery.length).toBeGreaterThan(0);
    contract('GET /api/v1/analytics/cohort', await adminA.get(`${V1}/analytics/cohort`), 200);

  });

  it('deadlines: extensions and attempt review', async () => {
    const review = contract('GET /api/v1/quizzes/:id/submissions/:subId/review', await s1.get(`${V1}/quizzes/${quizId}/submissions/${quizSubId}/review`), 200);
    expect(review.data.reviewPolicy).toBe('RESPONSES');
    expect(review.data.questions[0].correctOptionIds).toBeUndefined();
    const staffView = contract('GET /api/v1/quizzes/:id/submissions/:subId/review', await teacher.get(`${V1}/quizzes/${quizId}/submissions/${quizSubId}/review`), 200);
    expect(staffView.data.answersRevealed).toBe(true);

    const dueAt = '2100-01-01T00:00:00.000Z'; // after the assignment's 2099 due date
    const ext = contract('PUT /api/v1/extensions', await teacher.put(`${V1}/extensions`).send({ itemType: 'ASSIGNMENT', itemId: assignId, userId: 's2', dueAt, reason: 'Illness' }), 200);
    expect(ext.data).toMatchObject({ userId: 's2', reason: 'Illness' });
    const list = contract('GET /api/v1/extensions', await teacher.get(`${V1}/extensions?itemType=ASSIGNMENT&itemId=${assignId}`), 200);
    expect(list.data).toHaveLength(1);
    contract('DELETE /api/v1/extensions/:id', await teacher.delete(`${V1}/extensions/${ext.data.id}`), 204);
  });

  it('describes every operation that was assigned', () => {
    const missing = Object.keys(R).filter((k) => !covered.has(k));
    expect(missing, 'described but not exercised').toEqual([]);
  });
});
