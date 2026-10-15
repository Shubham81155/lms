import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';
import { applyCurve, computeRawGrade, letterFor, weightsValid, ItemScore } from '../src/lib/gradebook';

// Gradebook (weighted categories, curve, two-person approval), question bank, Bloom analytics and
// signed plagiarism callbacks, against a real PostgreSQL with the real migrations and RLS.

const PASSWORD = 'CorrectHorse1!';
const SECRET = 'plagiarism-secret-'.padEnd(40, 'x');
let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;
let signCallback: typeof import('../src/routes/integrations.routes.js').signCallback;
const pw = (slug: string) => `${PASSWORD}-${slug}`;

async function seed() {
  for (const [id, slug] of [['t-h', 'harvard'], ['t-m', 'mit']]) await admin.tenant.create({ data: { id, slug, name: slug } });
  const user = (id: string, tenantId: string, slug: string, role: any) =>
    admin.user.create({ data: { id, tenantId, email: `${id}@x.edu`, firstName: id, lastName: 'L', role, passwordHash: bcrypt.hashSync(pw(slug), 4), emailVerified: true } });
  await user('admin', 't-h', 'harvard', 'TENANT_ADMIN');
  await user('admin2', 't-h', 'harvard', 'TENANT_ADMIN');
  await user('teacher', 't-h', 'harvard', 'INSTRUCTOR');
  await user('teacher2', 't-h', 'harvard', 'INSTRUCTOR');
  await user('ta', 't-h', 'harvard', 'TEACHING_ASSISTANT');
  for (const s of ['s1', 's2', 's3']) await user(s, 't-h', 'harvard', 'STUDENT');
  await user('m-admin', 't-m', 'mit', 'TENANT_ADMIN');
  await user('m-teacher', 't-m', 'mit', 'INSTRUCTOR');

  await admin.course.create({ data: { id: 'c1', tenantId: 't-h', code: 'C1', title: 'Course c1', status: 'PUBLISHED' } });
  await admin.course.create({ data: { id: 'c2', tenantId: 't-h', code: 'C2', title: 'Course c2', status: 'PUBLISHED' } });
  await admin.course.create({ data: { id: 'm1', tenantId: 't-m', code: 'M1', title: 'MIT', status: 'PUBLISHED' } });
  await admin.courseInstructor.createMany({ data: [{ courseId: 'c1', userId: 'teacher', isPrimary: true }, { courseId: 'c1', userId: 'ta' }, { courseId: 'c2', userId: 'teacher2', isPrimary: true }, { courseId: 'm1', userId: 'm-teacher' }] });
  for (const s of ['s1', 's2', 's3']) await admin.enrollment.create({ data: { id: `e-${s}`, tenantId: 't-h', courseId: 'c1', userId: s, status: 'IN_PROGRESS', progressPercent: 50 } });

  const q = (id: string, bloomLevel?: string) => ({ id, questionText: `Q ${id}`, questionType: 'MULTIPLE_CHOICE' as const, points: 1, bloomLevel: bloomLevel ?? null, optionsJson: [{ id: 'a', text: 'x', isCorrect: true }, { id: 'b', text: 'y', isCorrect: false }] });
  await admin.quiz.create({ data: { id: 'q1', tenantId: 't-h', courseId: 'c1', title: 'Quiz 1', questions: { create: [q('q1a', 'APPLY')] } } });
  await admin.quiz.create({ data: { id: 'q-c2', tenantId: 't-h', courseId: 'c2', title: 'Other course quiz' } });
  await admin.assignment.create({ data: { id: 'a1', tenantId: 't-h', courseId: 'c1', title: 'Essay', instructions: 'Write', maxPoints: 100 } });
  await admin.assignment.create({ data: { id: 'a-m', tenantId: 't-m', courseId: 'm1', title: 'MIT essay', instructions: 'Write', maxPoints: 100 } });

  const sub = (id: string, userId: string, score: number) =>
    admin.quizSubmission.create({ data: { id, quizId: 'q1', userId, maxScore: 1, score, passed: score === 1, submittedAt: new Date(), answersJson: { pendingManual: [], grading: { q1a: { awardedPoints: score, maxPoints: 1, needsManualGrading: false, isCorrect: score === 1 } } } } });
  await sub('qs-1', 's1', 1);
  await sub('qs-2', 's2', 0);
  await admin.assignmentSubmission.create({ data: { id: 'as-1', assignmentId: 'a1', userId: 's1', submissionText: 'x', grade: 90, gradedAt: new Date() } });
  await admin.assignmentSubmission.create({ data: { id: 'as-2', assignmentId: 'a1', userId: 's2', submissionText: 'x', grade: 50, gradedAt: new Date() } });
  await admin.assignmentSubmission.create({ data: { id: 'as-3', assignmentId: 'a1', userId: 's3', submissionText: 'x' } }); // not graded yet
  await admin.assignmentSubmission.create({ data: { id: 'as-m', assignmentId: 'a-m', userId: 'm-teacher', submissionText: 'x' } });
}

beforeAll(async () => {
  process.env.PLAGIARISM_WEBHOOK_SECRET = SECRET;
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  await seed();
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
  ({ signCallback } = await import('../src/routes/integrations.routes.js'));
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
describe('grade arithmetic', () => {
  const cats = [{ id: 'q', name: 'Quizzes', weightPercent: 40 }, { id: 'a', name: 'Assignments', weightPercent: 60 }];
  const item = (categoryId: string, percent: number | null, over: Partial<ItemScore> = {}): ItemScore => ({ itemId: Math.random().toString(), type: 'QUIZ', title: 't', categoryId, percent, pending: percent === null, missing: false, ...over });

  it('weights category averages', () => {
    const r = computeRawGrade(cats, [item('q', 100), item('q', 50), item('a', 80)]);
    expect(r.rawPercent).toBe(0.4 * 75 + 0.6 * 80);
    expect(r.incomplete).toBe(false);
  });

  it('renormalises over categories that have scored work', () => {
    expect(computeRawGrade(cats, [item('q', 80)]).rawPercent).toBe(80); // no assignments yet
    expect(computeRawGrade(cats, []).rawPercent).toBe(0);
  });

  it('excludes ungraded work and flags the grade incomplete', () => {
    const r = computeRawGrade(cats, [item('q', 100), item('a', null)]);
    expect(r.rawPercent).toBe(100);
    expect(r.incomplete).toBe(true);
    expect(r.categories.find((c) => c.categoryId === 'a')).toMatchObject({ averagePercent: null, pendingItems: 1 });
  });

  it('ignores uncategorised items', () => {
    expect(computeRawGrade(cats, [item('q', 50), { ...item('q', 0), categoryId: null }]).rawPercent).toBe(50);
  });

  it('curves: add points (capped), scale to max (never lowers)', () => {
    expect(applyCurve([40, 98], 'ADD_POINTS', 5)).toEqual([45, 100]);
    expect(applyCurve([40, 80], 'SCALE_TO_MAX', 0)).toEqual([50, 100]);
    expect(applyCurve([100, 50], 'SCALE_TO_MAX', 0)).toEqual([100, 50]);
    expect(applyCurve([0, 0], 'SCALE_TO_MAX', 0)).toEqual([0, 0]);
    expect(applyCurve([61.234], 'NONE', 0)).toEqual([61.23]);
  });

  it('maps letters and validates weights', () => {
    expect([95, 90, 89.99, 70, 59.9].map((p) => letterFor(p))).toEqual(['A', 'A', 'B', 'C', 'F']);
    expect(weightsValid([40, 60])).toBe(true);
    expect(weightsValid([33.33, 33.33, 33.34])).toBe(true);
    expect(weightsValid([50, 49])).toBe(false);
    expect(weightsValid([])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('gradebook workflow', () => {
  const G = '/api/v1/courses/c1/gradebook';
  let teacher: Awaited<ReturnType<typeof as>>;
  let ids: Record<string, string> = {};

  beforeAll(async () => {
    teacher = await as('teacher');
  });

  it('keeps configuration to course staff and editors', async () => {
    expect((await (await as('s1')).get(`${G}/config`)).status).toBe(403);
    expect((await (await as('teacher2')).get(`${G}/config`)).status).toBe(403); // not assigned
    expect((await (await as('ta')).get(`${G}/config`)).status).toBe(200);
    expect((await (await as('ta')).put(`${G}/categories`).send({ categories: [{ name: 'All', weightPercent: 100 }] })).status).toBe(403); // TAs cannot edit
    expect((await (await as('m-admin', 'mit')).get(`${G}/config`)).status).toBe(404); // other tenant
    expect((await request(app).get(`${G}/config`)).status).toBe(401);
  });

  it('refuses to calculate before categories exist', async () => {
    expect((await teacher.post(`${G}/calculate`)).status).toBe(409);
  });

  it('validates categories and item assignments', async () => {
    const put = (categories: unknown) => teacher.put(`${G}/categories`).send({ categories });
    expect((await put([{ name: 'Quizzes', weightPercent: 40 }, { name: 'Assignments', weightPercent: 50 }])).status).toBe(400); // 90
    expect((await put([{ name: 'Quizzes', weightPercent: 50 }, { name: 'quizzes', weightPercent: 50 }])).status).toBe(400); // duplicate
    expect((await put([])).status).toBe(400);
    const ok = await put([{ name: 'Quizzes', weightPercent: 40 }, { name: 'Assignments', weightPercent: 60 }]);
    expect(ok.status).toBe(200);
    ids = Object.fromEntries(ok.body.data.map((c: any) => [c.name, c.id]));

    const items = (arr: unknown) => teacher.put(`${G}/items`).send({ items: arr });
    expect((await items([{ type: 'QUIZ', id: 'q-c2', categoryId: ids.Quizzes }])).status).toBe(400); // quiz of another course
    expect((await items([{ type: 'QUIZ', id: 'q1', categoryId: 'nope' }])).status).toBe(400);
    expect((await items([{ type: 'QUIZ', id: 'q1', categoryId: ids.Quizzes }, { type: 'ASSIGNMENT', id: 'a1', categoryId: ids.Assignments }])).status).toBe(200);
    const cfg = (await teacher.get(`${G}/config`)).body.data;
    expect(cfg.items.find((i: any) => i.id === 'q1').gradeCategoryId).toBe(ids.Quizzes);
  });

  it('keeps assigned items when categories are re-saved by name', async () => {
    await teacher.put(`${G}/categories`).send({ categories: [{ name: 'quizzes', weightPercent: 30 }, { name: 'Assignments', weightPercent: 70 }] });
    const cfg = (await teacher.get(`${G}/config`)).body.data;
    expect(cfg.categories.map((c: any) => c.weightPercent).sort()).toEqual([30, 70]);
    expect(cfg.items.find((i: any) => i.id === 'q1').gradeCategoryId).toBe(ids.Quizzes);
    await teacher.put(`${G}/categories`).send({ categories: [{ name: 'Quizzes', weightPercent: 40 }, { name: 'Assignments', weightPercent: 60 }] });
  });

  it('validates the curve', async () => {
    expect((await teacher.put(`${G}/curve`).send({ method: 'ADD_POINTS', value: 0 })).status).toBe(400);
    expect((await teacher.put(`${G}/curve`).send({ method: 'MAGIC' })).status).toBe(400);
    expect((await teacher.put(`${G}/curve`).send({ method: 'ADD_POINTS', value: 5 })).status).toBe(200);
  });

  it('calculates weighted, curved draft grades and flags incomplete work', async () => {
    const calc = await teacher.post(`${G}/calculate`);
    expect(calc.body.data).toMatchObject({ learners: 3, calculated: 3, skippedApproved: 0 });

    const book = await teacher.get(G);
    const by = Object.fromEntries(book.body.data.map((r: any) => [r.userId, r]));
    expect(by.s1).toMatchObject({ rawPercent: 94, curvedPercent: 99, letter: 'A', status: 'DRAFT', incomplete: false });
    expect(by.s2).toMatchObject({ rawPercent: 30, curvedPercent: 35, letter: 'F' });
    expect(by.s3.incomplete).toBe(true); // assignment still waiting for a grader
    expect(by.s3.rawPercent).toBe(0); // quiz missing counts 0; ungraded assignment is left out
    expect(by.s1.breakdown.categories).toHaveLength(2);
    expect(book.body.summary).toMatchObject({ total: 3, draft: 3, incomplete: 1 });
  });

  it('hides unapproved grades from learners', async () => {
    const mine = await (await as('s1')).get(G);
    expect(mine.body).toMatchObject({ data: null, published: false });
    expect((await (await as('s1')).post(`${G}/calculate`)).status).toBe(403);
    expect((await (await as('s1')).post(`${G}/approve`)).status).toBe(403);
  });

  it('blocks submitting incomplete grades unless acknowledged', async () => {
    const blocked = await teacher.post(`${G}/submit`).send({});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/waiting for a grader/);
  });

  it('enforces the two-person rule on approval', async () => {
    const admin1 = await as('admin');
    expect((await admin1.post(`${G}/submit`).send({ allowIncomplete: true })).body.data.submitted).toBe(3);

    expect((await teacher.post(`${G}/approve`)).status).toBe(403); // instructors cannot approve
    expect((await admin1.post(`${G}/approve`)).status).toBe(403); // submitter cannot approve their own
    expect((await admin1.post(`${G}/approve`)).body.error).toMatch(/different administrator/);

    const admin2 = await as('admin2');
    expect((await admin2.post(`${G}/approve`)).body.data.approved).toBe(3);

    // Final grade reached the enrolment and learners were told.
    expect((await admin.enrollment.findUnique({ where: { id: 'e-s1' } }))?.finalGrade).toBe(99);
    expect((await admin.enrollment.findUnique({ where: { id: 'e-s2' } }))?.finalGrade).toBe(35);
    const notes = (await (await as('s1')).get('/api/v1/notifications?category=GRADE')).body.data;
    expect(notes.some((n: any) => n.title === 'Your final grade is available')).toBe(true);
  });

  it('shows learners only their own approved grade', async () => {
    const s1 = await (await as('s1')).get(G);
    expect(s1.body.published).toBe(true);
    expect(s1.body.data).toMatchObject({ curvedPercent: 99, letter: 'A' });
    expect(JSON.stringify(s1.body)).not.toContain('s2@x.edu');
    expect((await (await as('s2')).get(G)).body.data.curvedPercent).toBe(35);
    expect((await (await as('m-admin', 'mit')).get(G)).status).toBe(404);
  });

  it('never overwrites approved grades until an administrator reopens them', async () => {
    await admin.assignmentSubmission.update({ where: { id: 'as-3' }, data: { grade: 100, gradedAt: new Date() } });
    const again = await teacher.post(`${G}/calculate`);
    expect(again.body.data).toMatchObject({ calculated: 0, skippedApproved: 3 });
    expect((await admin.courseGrade.findFirst({ where: { userId: 's3' } }))?.status).toBe('APPROVED');

    expect((await teacher.post(`${G}/reopen`)).status).toBe(403);
    expect((await (await as('admin')).post(`${G}/reopen`)).body.data.reopened).toBe(3);

    const recalculated = await teacher.post(`${G}/calculate`);
    expect(recalculated.body.data.calculated).toBe(3);
    const s3 = (await teacher.get(G)).body.data.find((r: any) => r.userId === 's3');
    expect(s3).toMatchObject({ incomplete: false, status: 'DRAFT', rawPercent: 60 }); // quiz 0*.4 + assignment 100*.6
    expect((await (await as('s1')).get(G)).body.published).toBe(false); // withdrawn until re-approved
  });

  it('lets an administrator send submitted grades back with a reason', async () => {
    expect((await teacher.post(`${G}/submit`).send({})).body.data.submitted).toBe(3);
    const admin1 = await as('admin');
    expect((await admin1.post(`${G}/reject`).send({})).status).toBe(400); // note required
    expect((await admin1.post(`${G}/reject`).send({ note: 'Curve too generous' })).body.data.returned).toBe(3);
    const row = (await teacher.get(G)).body.data[0];
    expect(row).toMatchObject({ status: 'DRAFT', decisionNote: 'Curve too generous' });
    const told = (await teacher.get('/api/v1/notifications?category=GRADE')).body.data;
    expect(told.some((n: any) => n.body === 'Curve too generous')).toBe(true);
    expect((await admin1.post(`${G}/reject`).send({ note: 'again' })).status).toBe(409); // nothing submitted
  });

  it('audits every state change', async () => {
    const actions = (await admin.auditLog.findMany({ where: { tenantId: 't-h', resourceType: 'GRADEBOOK' } })).map((a) => a.action);
    for (const a of ['GRADEBOOK_CATEGORIES_UPDATED', 'GRADEBOOK_CALCULATED', 'GRADEBOOK_SUBMITTED', 'GRADEBOOK_APPROVED', 'GRADEBOOK_REOPENED', 'GRADEBOOK_REJECTED']) {
      expect(actions, a).toContain(a);
    }
  });
});

// ---------------------------------------------------------------------------
describe('question bank', () => {
  const mc = (over: object = {}) => ({
    questionText: 'What does Raft elect?', questionType: 'MULTIPLE_CHOICE', points: 2,
    optionsJson: [{ text: 'A leader', isCorrect: true }, { text: 'A follower', isCorrect: false }],
    tags: ['Raft', 'consensus', 'raft'], bloomLevel: 'UNDERSTAND', ...over,
  });
  let itemId: string;
  let courseItemId: string;

  it('is limited to instructors and administrators', async () => {
    for (const who of ['s1', 'ta']) {
      expect((await (await as(who)).get('/api/v1/question-bank')).status, who).toBe(403);
      expect((await (await as(who)).post('/api/v1/question-bank').send(mc())).status, who).toBe(403);
    }
    expect((await request(app).get('/api/v1/question-bank')).status).toBe(401);
  });

  it('creates validated, de-duplicated, lower-cased items', async () => {
    const teacher = await as('teacher');
    const res = await teacher.post('/api/v1/question-bank').send(mc());
    expect(res.status).toBe(201);
    itemId = res.body.data.id;
    expect(res.body.data.tags.sort()).toEqual(['consensus', 'raft']);
    expect(res.body.data.optionsJson.every((o: any) => o.id)).toBe(true);

    const bad = (over: object) => teacher.post('/api/v1/question-bank').send(mc(over));
    expect((await bad({ optionsJson: [{ text: 'a', isCorrect: true }, { text: 'b', isCorrect: true }] })).status).toBe(400);
    expect((await bad({ bloomLevel: 'SPLEEN' })).status).toBe(400);
    expect((await bad({ questionType: 'SHORT_ANSWER', optionsJson: null })).status).toBe(400); // needs a key
    expect((await bad({ courseId: 'c2' })).status).toBe(403); // teacher cannot edit c2
    const withCourse = await bad({ courseId: 'c1', questionText: 'Course-shared question' });
    expect(withCourse.status).toBe(201);
    courseItemId = withCourse.body.data.id;
  });

  it('scopes visibility to the author, the course staff and administrators', async () => {
    expect((await (await as('teacher2')).get(`/api/v1/question-bank/${itemId}`)).status).toBe(404);
    expect((await (await as('teacher2')).get(`/api/v1/question-bank/${courseItemId}`)).status).toBe(404); // not on c1
    expect((await (await as('admin')).get(`/api/v1/question-bank/${itemId}`)).status).toBe(200);
    expect((await (await as('m-admin', 'mit')).get(`/api/v1/question-bank/${itemId}`)).status).toBe(404);
    const list = (await (await as('teacher2')).get('/api/v1/question-bank')).body.data;
    expect(list.map((i: any) => i.id)).not.toContain(itemId);
  });

  it('filters by text, tag, type and Bloom level', async () => {
    const t = await as('teacher');
    const get = async (qs: string) => (await t.get(`/api/v1/question-bank?${qs}`)).body.data.map((i: any) => i.id);
    expect(await get('q=raft')).toContain(itemId);
    expect(await get('tag=consensus')).toContain(itemId);
    expect(await get('tag=nothing')).toEqual([]);
    expect(await get('bloomLevel=UNDERSTAND')).toContain(itemId);
    expect(await get('type=ESSAY')).toEqual([]);
    expect((await t.get('/api/v1/question-bank?type=BOGUS')).status).toBe(400);
  });

  it('lets only the author or an administrator change an item', async () => {
    const teacher = await as('teacher');
    expect((await teacher.patch(`/api/v1/question-bank/${itemId}`).send({ points: 3, tags: ['x'] })).body.data).toMatchObject({ points: 3, tags: ['x'] });
    expect((await teacher.patch(`/api/v1/question-bank/${itemId}`).send({ optionsJson: [{ text: 'a', isCorrect: false }, { text: 'b', isCorrect: false }] })).status).toBe(400);
    // Shared with course c1: the TA cannot (not an author role), another teacher cannot see it.
    expect((await (await as('teacher2')).patch(`/api/v1/question-bank/${itemId}`).send({ points: 9 })).status).toBe(404);
    expect((await (await as('admin')).patch(`/api/v1/question-bank/${itemId}`).send({ points: 4 })).status).toBe(200);
  });

  it('copies items into a quiz as independent questions', async () => {
    const teacher = await as('teacher');
    const url = '/api/v1/quizzes/q1/questions/from-bank';
    const res = await teacher.post(url).send({ itemIds: [courseItemId, itemId, itemId] });
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveLength(2); // duplicate id collapsed
    expect(res.body.data[0].questionText).toBe('Course-shared question');
    expect(res.body.data[1].bloomLevel).toBe('UNDERSTAND');
    const orders = res.body.data.map((q: any) => q.orderIndex);
    expect(orders[1]).toBe(orders[0] + 1);

    const bank = (await teacher.get(`/api/v1/question-bank/${itemId}`)).body.data;
    expect(res.body.data[1].optionsJson[0].id).not.toBe(bank.optionsJson[0].id); // fresh option ids

    // Editing the bank afterwards does not change the quiz copy.
    await teacher.patch(`/api/v1/question-bank/${itemId}`).send({ questionText: 'Edited in the bank' });
    const copy = await admin.quizQuestion.findUnique({ where: { id: res.body.data[1].id } });
    expect(copy?.questionText).toBe('What does Raft elect?');

    expect((await teacher.post(url).send({ itemIds: ['missing'] })).status).toBe(404);
    expect((await teacher.post(url).send({ itemIds: [] })).status).toBe(400);
    expect((await (await as('teacher2')).post(url).send({ itemIds: [itemId] })).status).toBe(403); // not an editor of this quiz's course
    expect((await (await as('ta')).post(url).send({ itemIds: [itemId] })).status).toBe(403);
  });

  it('deletes only what the caller may modify', async () => {
    expect((await (await as('teacher2')).delete(`/api/v1/question-bank/${itemId}`)).status).toBe(404);
    expect((await (await as('teacher')).delete(`/api/v1/question-bank/${itemId}`)).status).toBe(204);
    expect((await (await as('teacher')).get(`/api/v1/question-bank/${itemId}`)).status).toBe(404);
  });

  it('tags questions on quizzes and reports Bloom mastery from graded answers', async () => {
    const res = await (await as('teacher')).get('/api/v1/analytics/cohort');
    const apply = res.body.bloomsMastery.find((b: any) => b.level === 'APPLY');
    expect(apply).toBeTruthy();
    expect(apply.score).toBe(50); // one of the two graded answers to the APPLY question was right
    expect(res.body.bloomsMastery.map((b: any) => b.level)).toEqual(['APPLY']); // only levels with data

    const created = await (await as('teacher')).post('/api/v1/quizzes/q1/questions').send({
      questionText: 'Tagged directly', questionType: 'TRUE_FALSE', correctAnswer: 'true', bloomLevel: 'CREATE',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.bloomLevel).toBe('CREATE');
    expect((await (await as('teacher')).patch(`/api/v1/quizzes/q1/questions/${created.body.data.id}`).send({ bloomLevel: 'EVALUATE' })).body.data.bloomLevel).toBe('EVALUATE');
  });
});

// ---------------------------------------------------------------------------
describe('learner Bloom mastery', () => {
  it('reports only the caller’s own graded, tagged answers', async () => {
    expect((await (await as('s1')).get('/api/v1/gamification/mastery')).body.data).toEqual([{ level: 'APPLY', score: 100 }]);
    expect((await (await as('s2')).get('/api/v1/gamification/mastery')).body.data).toEqual([{ level: 'APPLY', score: 0 }]);
    expect((await (await as('s3')).get('/api/v1/gamification/mastery')).body.data).toEqual([]); // nothing submitted
    expect((await request(app).get('/api/v1/gamification/mastery')).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe('plagiarism provider callbacks', () => {
  const URL = (slug = 'harvard') => `/api/v1/integrations/plagiarism/${slug}`;
  const post = (body: unknown, opts: { slug?: string; ts?: string; secret?: string; tamper?: string } = {}) => {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    const ts = opts.ts ?? String(Math.floor(Date.now() / 1000));
    const sig = signCallback(opts.secret ?? SECRET, ts, raw);
    return request(app)
      .post(URL(opts.slug))
      .set('content-type', 'application/json')
      .set('x-lms-timestamp', ts)
      .set('x-lms-signature', `sha256=${sig}`)
      .send(opts.tamper ?? raw);
  };

  it('records a signed result without a login', async () => {
    const res = await post({ submissionId: 'as-1', score: 12.5, reportUrl: 'https://turnitin.example/r/1' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'recorded', alerted: 0 });
    const row = await admin.assignmentSubmission.findUnique({ where: { id: 'as-1' } });
    expect(row).toMatchObject({ plagiarismScore: 12.5, plagiarismReportUrl: 'https://turnitin.example/r/1' });
  });

  it('alerts the course staff on high similarity', async () => {
    const res = await post({ submissionId: 'as-2', score: 61 });
    expect(res.body.alerted).toBe(2); // teacher and TA of c1
    const notes = (await (await as('teacher')).get('/api/v1/notifications?category=GRADE')).body.data;
    expect(notes.some((n: any) => n.title.includes('High similarity'))).toBe(true);
    expect((await admin.auditLog.count({ where: { action: 'PLAGIARISM_RESULT_RECORDED' } }))).toBeGreaterThanOrEqual(2);
  });

  it('feeds the early-warning radar', async () => {
    const risk = (await (await as('teacher')).get('/api/v1/analytics/at-risk?courseId=c1')).body.data;
    const s2 = risk.find((l: any) => l.id === 's2');
    expect(s2.reasons.some((r: string) => r.includes('Plagiarism match 61%'))).toBe(true);
  });

  it('rejects bad signatures, tampering, stale timestamps and the wrong secret', async () => {
    const body = { submissionId: 'as-1', score: 99 };
    expect((await post(body, { secret: 'x'.repeat(40) })).status).toBe(401);
    expect((await post(body, { tamper: JSON.stringify({ submissionId: 'as-1', score: 1 }) })).status).toBe(401);
    expect((await post(body, { ts: String(Math.floor(Date.now() / 1000) - 3600) })).status).toBe(401);
    expect((await post(body, { ts: 'abc' })).status).toBe(401);
    expect((await request(app).post(URL()).set('content-type', 'application/json').send(body)).status).toBe(401);
    expect((await admin.assignmentSubmission.findUnique({ where: { id: 'as-1' } }))?.plagiarismScore).toBe(12.5); // unchanged
  });

  it('validates the payload and never crosses tenants', async () => {
    expect((await post({ submissionId: 'as-1', score: 101 })).status).toBe(400);
    expect((await post({ submissionId: 'as-1', score: 5, reportUrl: 'http://insecure.example/r' })).status).toBe(400);
    expect((await post('not json')).status).toBe(400);
    expect((await post({ submissionId: 'missing', score: 5 })).status).toBe(404);
    expect((await post({ submissionId: 'as-m', score: 5 })).status).toBe(404); // MIT's submission via Harvard's slug
    expect((await post({ submissionId: 'as-1', score: 5 }, { slug: 'nowhere' })).status).toBe(404);
    expect((await admin.assignmentSubmission.findUnique({ where: { id: 'as-m' } }))?.plagiarismScore).toBeNull();
  });

  it('does not break normal JSON endpoints that share the API root', async () => {
    const login = await request(app).post('/api/v1/auth/login').set('x-tenant-id', 'harvard').send({ email: 's1@x.edu', password: pw('harvard') });
    expect(login.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe('pending submissions feed', () => {
  it('lists ungraded work oldest first, scoped to the caller’s courses', async () => {
    await admin.assignment.create({ data: { id: 'a2', tenantId: 't-h', courseId: 'c1', title: 'Lab 2', instructions: 'x', maxPoints: 10 } });
    await admin.assignmentSubmission.create({ data: { id: 'p-1', assignmentId: 'a2', userId: 's1', submissionText: 'x', submittedAt: new Date(Date.now() - 7_200_000), plagiarismScore: 42 } });
    await admin.assignmentSubmission.create({ data: { id: 'p-2', assignmentId: 'a2', userId: 's2', submissionText: 'x', submittedAt: new Date(Date.now() - 3_600_000) } });
    await admin.assignment.create({ data: { id: 'a3', tenantId: 't-h', courseId: 'c2', title: 'Other course', instructions: 'x' } });
    await admin.assignmentSubmission.create({ data: { id: 'p-3', assignmentId: 'a3', userId: 's3', submissionText: 'x' } });

    const feed = await (await as('teacher')).get('/api/v1/analytics/pending-grading');
    expect(feed.status).toBe(200);
    expect(feed.body.total).toBe(2); // c1 only; graded work and c2 excluded
    expect(feed.body.data.map((r: any) => r.id)).toEqual(['p-1', 'p-2']);
    expect(feed.body.data[0]).toMatchObject({ student: 's1 L', assignment: 'Lab 2', course: 'C1', plagiarismScore: 42 });
    expect((await (await as('teacher')).get('/api/v1/analytics/pending-grading?limit=1')).body.data).toHaveLength(1);

    expect((await (await as('teacher2')).get('/api/v1/analytics/pending-grading')).body.data.map((r: any) => r.id)).toEqual(['p-3']);
    expect((await (await as('admin')).get('/api/v1/analytics/pending-grading')).body.total).toBe(3);
    expect((await (await as('m-admin', 'mit')).get('/api/v1/analytics/pending-grading')).body.data.map((r: any) => r.id)).toEqual(['as-m']);
    expect((await (await as('s1')).get('/api/v1/analytics/pending-grading')).status).toBe(403);
    expect((await request(app).get('/api/v1/analytics/pending-grading')).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe('row-level security on gradebook tables', () => {
  it('hides every row from a connection with no tenant context', async () => {
    const app_ = new PrismaClient({ datasourceUrl: db.appUrl });
    try {
      for (const t of ['gradeCategory', 'courseGrade', 'questionBankItem'] as const) {
        expect(await (admin as any)[t].count(), `${t} has rows`).toBeGreaterThan(0);
        expect(await (app_ as any)[t].count(), t).toBe(0);
      }
    } finally {
      await app_.$disconnect();
    }
  });
});

// ---------------------------------------------------------------------------
describe('gradebook responses match the API description', () => {
  it('config, calculate and both views of the gradebook have the documented shapes', async () => {
    const docs = await import('../src/openapi/docs.js');
    const { z } = await import('zod');
    const G = '/api/v1/courses/c1/gradebook';
    const teacher = await as('teacher');

    // Make sure there is something to read: categories exist from the workflow tests, but set them
    // here too so this test stands on its own.
    const cats = await teacher.put(`${G}/categories`).send({ categories: [{ name: 'Quizzes', weightPercent: 40 }, { name: 'Assignments', weightPercent: 60 }] });
    expect(z.object({ data: z.array(docs.GradebookCategory) }).safeParse(cats.body).success, JSON.stringify(cats.body)).toBe(true);

    const config = await teacher.get(`${G}/config`);
    expect(z.object({ data: docs.GradebookConfig }).safeParse(config.body).success, JSON.stringify(config.body)).toBe(true);

    const calc = await teacher.post(`${G}/calculate`);
    expect(calc.status).toBe(200);
    expect(z.object({ data: z.object({ learners: z.number(), calculated: z.number(), skippedApproved: z.number() }) }).safeParse(calc.body).success).toBe(true);

    const staff = await teacher.get(G);
    const parsedStaff = docs.GradebookStaffView.safeParse(staff.body);
    expect(parsedStaff.success, JSON.stringify(parsedStaff)).toBe(true);
    expect(staff.body.data.length).toBeGreaterThan(0);

    // A learner never sees a grade that has not been approved.
    const learner = await (await as('s1')).get(G);
    const parsedLearner = docs.GradebookLearnerView.safeParse(learner.body);
    expect(parsedLearner.success, JSON.stringify(learner.body)).toBe(true);
  });
});
