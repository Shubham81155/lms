import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';
import { normaliseCriteria, scoreFromCriteria, rubricTotal, RubricError } from '../src/lib/rubric';

// Assignment rubrics and grade appeals against a real PostgreSQL with the real migrations.

const PASSWORD = 'CorrectHorse1!';
let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;
const pw = (slug: string) => `${PASSWORD}-${slug}`;

async function seed() {
  for (const [id, slug] of [
    ['t-h', 'harvard'],
    ['t-m', 'mit'],
  ])
    await admin.tenant.create({ data: { id, slug, name: slug } });
  const user = (id: string, tenantId: string, slug: string, role: any) =>
    admin.user.create({
      data: {
        id,
        tenantId,
        email: `${id}@x.edu`,
        firstName: id,
        lastName: 'L',
        role,
        passwordHash: bcrypt.hashSync(pw(slug), 4),
        emailVerified: true,
      },
    });
  await user('admin', 't-h', 'harvard', 'TENANT_ADMIN');
  await user('teacher', 't-h', 'harvard', 'INSTRUCTOR');
  await user('teacher2', 't-h', 'harvard', 'INSTRUCTOR');
  await user('ta', 't-h', 'harvard', 'TEACHING_ASSISTANT');
  for (const s of ['s1', 's2', 's3']) await user(s, 't-h', 'harvard', 'STUDENT');
  await user('m-admin', 't-m', 'mit', 'TENANT_ADMIN');

  await admin.course.create({ data: { id: 'c1', tenantId: 't-h', code: 'C1', title: 'C1', status: 'PUBLISHED' } });
  await admin.course.create({ data: { id: 'c2', tenantId: 't-h', code: 'C2', title: 'C2', status: 'PUBLISHED' } });
  await admin.courseInstructor.createMany({
    data: [
      { courseId: 'c1', userId: 'teacher', isPrimary: true },
      { courseId: 'c1', userId: 'ta' },
      { courseId: 'c2', userId: 'teacher2', isPrimary: true },
    ],
  });
  for (const s of ['s1', 's2'])
    await admin.enrollment.create({ data: { id: `e-${s}`, tenantId: 't-h', courseId: 'c1', userId: s, status: 'IN_PROGRESS' } });

  const asg = (id: string, title: string, maxPoints = 100) =>
    admin.assignment.create({ data: { id, tenantId: 't-h', courseId: 'c1', title, instructions: 'x', maxPoints } });
  await asg('a-plain', 'Plain essay');
  await asg('a-rub', 'Rubric essay');
  await asg('a-free', 'Unused rubric');
  for (const a of ['a-plain', 'a-rub'])
    for (const s of ['s1', 's2'])
      await admin.assignmentSubmission.create({ data: { id: `${a}-${s}`, assignmentId: a, userId: s, submissionText: 'my work' } });
  // An approved course grade for s1, to prove a changed grade reopens it.
  await admin.courseGrade.create({
    data: {
      tenantId: 't-h',
      courseId: 'c1',
      userId: 's1',
      rawPercent: 90,
      curvedPercent: 90,
      letter: 'A',
      breakdownJson: {},
      status: 'APPROVED',
      approvedById: 'admin',
      approvedAt: new Date(),
    },
  });
  await admin.courseGrade.create({
    data: {
      tenantId: 't-h',
      courseId: 'c1',
      userId: 's2',
      rawPercent: 70,
      curvedPercent: 70,
      letter: 'C',
      breakdownJson: {},
      status: 'APPROVED',
      approvedById: 'admin',
      approvedAt: new Date(),
    },
  });

  await admin.course.create({ data: { id: 'm1', tenantId: 't-m', code: 'M1', title: 'M1', status: 'PUBLISHED' } });
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
  const res = await agent
    .post('/api/v1/auth/login')
    .set('x-tenant-id', tenant)
    .send({ email: `${who}@x.edu`, password: pw(tenant) });
  expect(res.status, `login as ${who}`).toBe(200);
  return agent;
}

// ---------------------------------------------------------------------------
describe('rubric arithmetic', () => {
  it('normalises criteria: ids, trimmed names, uniqueness', () => {
    const c = normaliseCriteria([
      { name: ' Thesis ', maxPoints: 10 },
      { name: 'Evidence', description: ' sources ', maxPoints: 15.555 },
    ]);
    expect(c[0]).toMatchObject({ name: 'Thesis', maxPoints: 10 });
    expect(c[0].id).toBeTruthy();
    expect(c[1]).toMatchObject({ description: 'sources', maxPoints: 15.56 });
    expect(rubricTotal(c)).toBe(25.56);
    expect(() => normaliseCriteria([])).toThrow(RubricError);
    expect(() =>
      normaliseCriteria([
        { name: 'A', maxPoints: 1 },
        { name: ' a ', maxPoints: 1 },
      ])
    ).toThrow(/unique/);
    expect(() => normaliseCriteria([{ name: '  ', maxPoints: 1 }])).toThrow(/name/);
    expect(() =>
      normaliseCriteria([
        { id: 'x', name: 'A', maxPoints: 1 },
        { id: 'x', name: 'B', maxPoints: 1 },
      ])
    ).toThrow(/ids/);
  });

  it('scores strictly: every criterion, within range, no unknowns', () => {
    const c = [
      { id: 'a', name: 'Thesis', maxPoints: 10 },
      { id: 'b', name: 'Evidence', maxPoints: 20 },
    ];
    expect(scoreFromCriteria(c, { a: 7.5, b: 20 })).toEqual({ total: 27.5, scores: { a: 7.5, b: 20 } });
    expect(() => scoreFromCriteria(c, { a: 7 })).toThrow(/Evidence/); // missing
    expect(() => scoreFromCriteria(c, { a: 11, b: 1 })).toThrow(/between 0 and 10/);
    expect(() => scoreFromCriteria(c, { a: -1, b: 1 })).toThrow(/between/);
    expect(() => scoreFromCriteria(c, { a: 1, b: 1, zzz: 3 })).toThrow(/Unknown criterion/);
    expect(() => scoreFromCriteria(c, { a: NaN, b: 1 })).toThrow(/Thesis/);
  });
});

// ---------------------------------------------------------------------------
describe('assignment rubrics', () => {
  const R = (id: string) => `/api/v1/assignments/${id}/rubric`;
  const crit = [
    { name: 'Thesis', description: 'Clear claim', maxPoints: 10 },
    { name: 'Evidence', maxPoints: 15 },
    { name: 'Style', maxPoints: 25 },
  ];

  it('is limited to course editors', async () => {
    for (const who of ['s1', 'ta', 'teacher2'])
      expect((await (await as(who)).put(R('a-rub')).send({ criteria: crit })).status, who).toBe(403);
    expect((await request(app).put(R('a-rub')).send({ criteria: crit })).status).toBe(401);
    expect((await (await as('m-admin', 'mit')).put(R('a-rub')).send({ criteria: crit })).status).toBe(404);
  });

  it('validates the rubric', async () => {
    const t = await as('teacher');
    for (const bad of [
      [],
      [{ name: 'A', maxPoints: 0 }],
      [
        { name: 'A', maxPoints: 5 },
        { name: 'a', maxPoints: 5 },
      ],
      [{ name: '', maxPoints: 5 }],
      'nope',
    ]) {
      expect((await t.put(R('a-rub')).send({ criteria: bad })).status).toBe(400);
    }
  });

  it('sets a rubric, making the assignment worth the sum of its criteria', async () => {
    const t = await as('teacher');
    const res = await t.put(R('a-rub')).send({ criteria: crit });
    expect(res.status).toBe(200);
    expect(res.body.data.maxPoints).toBe(50);
    expect(res.body.data.rubric).toHaveLength(3);
    expect(res.body.data.rubric.every((c: any) => c.id)).toBe(true);

    // Learners can read the rubric before they submit.
    const list = await (await as('s1')).get('/api/v1/courses/c1/assignments');
    const a = list.body.data.find((x: any) => x.id === 'a-rub');
    expect(a.rubricJson).toHaveLength(3);
    expect(a.maxPoints).toBe(50);
  });

  it('requires criterion scores for a rubric assignment, and refuses bad ones', async () => {
    const t = await as('teacher');
    const rubric = (await admin.assignment.findUnique({ where: { id: 'a-rub' } }))!.rubricJson as any[];
    const [thesis, evidence, style] = rubric.map((c) => c.id);
    const url = '/api/v1/assignments/a-rub/submissions/a-rub-s1/grade';

    expect((await t.patch(url).send({ grade: 40 })).status).toBe(400); // bare total
    expect((await t.patch(url).send({ grade: 40, criteria: { [thesis]: 1 } })).status).toBe(400); // both
    expect((await t.patch(url).send({ criteria: { [thesis]: 5, [evidence]: 5 } })).status).toBe(400); // style missing
    expect((await t.patch(url).send({ criteria: { [thesis]: 11, [evidence]: 5, [style]: 5 } })).status).toBe(400); // over max
    expect((await t.patch(url).send({ criteria: { [thesis]: 5, [evidence]: 5, [style]: 5, bogus: 1 } })).status).toBe(400); // unknown
    expect((await t.patch(url).send({})).status).toBe(400);
    expect((await admin.assignmentSubmission.findUnique({ where: { id: 'a-rub-s1' } }))?.grade).toBeNull();

    const ok = await t.patch(url).send({ criteria: { [thesis]: 8, [evidence]: 12.5, [style]: 20 }, feedback: 'Solid.' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.grade).toBe(40.5);
    expect(ok.body.data.rubricScoresJson).toEqual({ [thesis]: 8, [evidence]: 12.5, [style]: 20 });
    expect(ok.body.courseGradeReopened).toBe(false); // first grading never reopens anything

    // The learner sees the breakdown and is told.
    const mine = await (await as('s1')).get('/api/v1/assignments/a-rub/submissions');
    expect(mine.body.data[0]).toMatchObject({ grade: 40.5, feedback: 'Solid.' });
    expect(mine.body.data[0].rubricScoresJson[thesis]).toBe(8);
    const notes = (await (await as('s1')).get('/api/v1/notifications?category=GRADE')).body.data;
    expect(notes.some((n: any) => n.body === 'Grade: 40.5 / 50')).toBe(true);
  });

  it('keeps plain assignments plain', async () => {
    const t = await as('teacher');
    const url = '/api/v1/assignments/a-plain/submissions/a-plain-s1/grade';
    expect((await t.patch(url).send({ criteria: { x: 1 } })).status).toBe(400);
    expect((await t.patch(url).send({ grade: 101 })).status).toBe(400);
    expect((await t.patch(url).send({ grade: -1 })).status).toBe(400);
    expect((await t.patch(url).send({ grade: 80, criteria: { x: 1 } })).status).toBe(400);
    expect((await t.patch(url).send({ grade: 85, feedback: 'Good' })).body.data.grade).toBe(85);
    expect((await (await as('teacher2')).patch(url).send({ grade: 1 })).status).toBe(403);
    expect((await (await as('s1')).patch(url).send({ grade: 100 })).status).toBe(403);
  });

  it('freezes the rubric once something is graded, but lets an unused one be removed', async () => {
    const t = await as('teacher');
    expect((await t.put(R('a-rub')).send({ criteria: [{ name: 'New', maxPoints: 5 }] })).status).toBe(409);
    expect((await t.put(R('a-rub')).send({ criteria: null })).status).toBe(409);

    expect((await t.put(R('a-free')).send({ criteria: crit })).status).toBe(200);
    const removed = await t.put(R('a-free')).send({ criteria: null });
    expect(removed.status).toBe(200);
    expect(removed.body.data.rubric).toBeNull();
    expect((await admin.assignment.findUnique({ where: { id: 'a-free' } }))?.rubricJson).toBeNull();
    expect(await admin.auditLog.count({ where: { action: { in: ['ASSIGNMENT_RUBRIC_SET', 'ASSIGNMENT_RUBRIC_REMOVED'] } } })).toBe(3);
  });
});

// ---------------------------------------------------------------------------
describe('grade appeals', () => {
  const appealUrl = (a: string, s: string) => `/api/v1/assignments/${a}/submissions/${a}-${s}/appeal`;
  const reason = 'I believe the evidence criterion was marked too harshly.';
  let rubricIds: string[];
  let appealId: string;

  beforeAll(async () => {
    rubricIds = ((await admin.assignment.findUnique({ where: { id: 'a-rub' } }))!.rubricJson as any[]).map((c) => c.id);
  });

  it('only allows appealing your own graded work', async () => {
    const s1 = await as('s1');
    expect((await (await as('s2')).post(appealUrl('a-rub', 's2')).send({ reason })).status).toBe(409); // not graded yet
    expect((await (await as('s2')).post(appealUrl('a-rub', 's1')).send({ reason })).status).toBe(404); // someone else's
    expect((await (await as('s3')).post(appealUrl('a-rub', 's1')).send({ reason })).status).toBe(404);
    expect((await (await as('teacher')).post(appealUrl('a-rub', 's1')).send({ reason })).status).toBe(404); // staff do not file for learners
    expect((await s1.post(appealUrl('a-rub', 's1')).send({ reason: 'too short' })).status).toBe(400);
    expect((await request(app).post(appealUrl('a-rub', 's1')).send({ reason })).status).toBe(401);
  });

  it('files one appeal per submission and alerts the course staff', async () => {
    const s1 = await as('s1');
    const res = await s1.post(appealUrl('a-rub', 's1')).send({ reason });
    expect(res.status).toBe(201);
    appealId = res.body.data.id;
    expect(res.body.data.status).toBe('OPEN');
    expect((await s1.post(appealUrl('a-rub', 's1')).send({ reason })).status).toBe(409);

    for (const who of ['teacher', 'ta']) {
      const notes = (await (await as(who)).get('/api/v1/notifications?category=GRADE')).body.data;
      expect(
        notes.some((n: any) => n.title === 'Grade appeal on "Rubric essay"'),
        who
      ).toBe(true);
    }
    expect((await (await as('teacher2')).get('/api/v1/notifications?category=GRADE')).body.data).toHaveLength(0);
  });

  it('refuses appeals filed after the window closes', async () => {
    await admin.assignmentSubmission.update({
      where: { id: 'a-plain-s2' },
      data: { grade: 60, gradedAt: new Date(Date.now() - 20 * 86_400_000) },
    });
    const res = await (await as('s2')).post(appealUrl('a-plain', 's2')).send({ reason });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/14 days/);
  });

  it('shows learners their own appeals and staff the whole course', async () => {
    await (await as('s2')).post(appealUrl('a-plain', 's2')); // (refused above; nothing created)
    const mine = await (await as('s1')).get('/api/v1/courses/c1/appeals');
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].student).toBeUndefined();
    expect(mine.body.data[0].submission.text).toBeUndefined();
    expect((await (await as('s2')).get('/api/v1/courses/c1/appeals')).body.data).toEqual([]);

    const staff = await (await as('teacher')).get('/api/v1/courses/c1/appeals');
    expect(staff.body.data[0]).toMatchObject({ student: 's1 L', status: 'OPEN', reason });
    expect(staff.body.data[0].submission.text).toBe('my work');
    expect(staff.body.data[0].assignment.rubricJson).toHaveLength(3);
    expect((await (await as('teacher2')).get('/api/v1/courses/c1/appeals')).status).toBe(403);
    expect((await (await as('m-admin', 'mit')).get('/api/v1/courses/c1/appeals')).status).toBe(404);
  });

  it('limits decisions to course editors', async () => {
    const body = { decision: 'DENIED', response: 'The marking stands.' };
    for (const who of ['s1', 'ta', 'teacher2'])
      expect((await (await as(who)).post(`/api/v1/appeals/${appealId}/resolve`).send(body)).status, who).toBe(403);
    expect((await (await as('m-admin', 'mit')).post(`/api/v1/appeals/${appealId}/resolve`).send(body)).status).toBe(404);
    expect((await request(app).post(`/api/v1/appeals/${appealId}/resolve`).send(body)).status).toBe(401);
  });

  it('validates the decision', async () => {
    const t = await as('teacher');
    const url = `/api/v1/appeals/${appealId}/resolve`;
    const [thesis, evidence, style] = rubricIds;
    expect((await t.post(url).send({ decision: 'UPHELD', response: 'Agreed.' })).status).toBe(400); // needs the corrected grade
    expect((await t.post(url).send({ decision: 'DENIED', response: 'No.', grade: 50 })).status).toBe(400); // denial cannot regrade
    expect((await t.post(url).send({ decision: 'DENIED', response: '' })).status).toBe(400);
    expect((await t.post(url).send({ decision: 'MAYBE', response: 'Hmm.' })).status).toBe(400);
    expect(
      (await t.post(url).send({ decision: 'UPHELD', response: 'Agreed.', criteria: { [thesis]: 99, [evidence]: 1, [style]: 1 } })).status
    ).toBe(400); // invalid scores
    // A rejected correction must leave the appeal open and the grade alone.
    expect((await admin.gradeAppeal.findUnique({ where: { id: appealId } }))?.status).toBe('OPEN');
    expect((await admin.assignmentSubmission.findUnique({ where: { id: 'a-rub-s1' } }))?.grade).toBe(40.5);
  });

  it('upholds an appeal: regrades, notifies, audits, and reopens the approved course grade', async () => {
    const t = await as('teacher');
    const [thesis, evidence, style] = rubricIds;
    const res = await t
      .post(`/api/v1/appeals/${appealId}/resolve`)
      .send({ decision: 'UPHELD', response: 'Evidence was strong.', criteria: { [thesis]: 8, [evidence]: 15, [style]: 20 } });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'UPHELD', courseGradeReopened: true });

    const sub = await admin.assignmentSubmission.findUnique({ where: { id: 'a-rub-s1' } });
    expect(sub?.grade).toBe(43);
    expect((sub?.rubricScoresJson as any)[evidence]).toBe(15);
    const appeal = await admin.gradeAppeal.findUnique({ where: { id: appealId } });
    expect(appeal).toMatchObject({ status: 'UPHELD', response: 'Evidence was strong.', respondedById: 'teacher' });

    // Only that learner's approved course grade went back to draft.
    expect(await admin.courseGrade.findFirst({ where: { userId: 's1' } })).toMatchObject({ status: 'DRAFT', approvedById: null });
    expect((await admin.courseGrade.findFirst({ where: { userId: 's2' } }))?.status).toBe('APPROVED');

    const notes = (await (await as('s1')).get('/api/v1/notifications?category=GRADE')).body.data;
    expect(notes.some((n: any) => /appeal was upheld.*43/.test(n.body))).toBe(true);
    expect(await admin.auditLog.count({ where: { action: 'GRADE_CHANGED_ON_APPEAL' } })).toBe(1);
    expect(await admin.auditLog.count({ where: { action: 'GRADE_APPEAL_UPHELD' } })).toBe(1);

    expect((await t.post(`/api/v1/appeals/${appealId}/resolve`).send({ decision: 'DENIED', response: 'Changed my mind.' })).status).toBe(
      409
    ); // decided once
  });

  it('denies an appeal without touching the grade', async () => {
    const s2 = await as('s2');
    // Grade s2's rubric submission, then appeal and be refused.
    const [thesis, evidence, style] = rubricIds;
    await (
      await as('teacher')
    )
      .patch('/api/v1/assignments/a-rub/submissions/a-rub-s2/grade')
      .send({ criteria: { [thesis]: 4, [evidence]: 4, [style]: 4 } });
    const filed = await s2.post(appealUrl('a-rub', 's2')).send({ reason });
    expect(filed.status).toBe(201);

    const res = await (
      await as('admin')
    )
      .post(`/api/v1/appeals/${filed.body.data.id}/resolve`)
      .send({ decision: 'DENIED', response: 'Marked against the rubric.' });
    expect(res.status).toBe(200);
    expect(res.body.data.courseGradeReopened).toBe(false);
    expect((await admin.assignmentSubmission.findUnique({ where: { id: 'a-rub-s2' } }))?.grade).toBe(12);
    expect((await admin.courseGrade.findFirst({ where: { userId: 's2' } }))?.status).toBe('APPROVED');
    const notes = (await (await as('s2')).get('/api/v1/notifications?category=GRADE')).body.data;
    expect(notes.some((n: any) => n.body === 'Not upheld. Marked against the rubric.')).toBe(true);

    const view = (await s2.get('/api/v1/courses/c1/appeals')).body.data[0];
    expect(view).toMatchObject({ status: 'DENIED', response: 'Marked against the rubric.' });
  });

  it('reopens an approved course grade whenever a graded submission is regraded directly', async () => {
    // s2's course grade is APPROVED (untouched by the denial); a plain regrade must flag it.
    const res = await (await as('teacher')).patch('/api/v1/assignments/a-plain/submissions/a-plain-s2/grade').send({ grade: 75 });
    expect(res.body.courseGradeReopened).toBe(true);
    expect((await admin.courseGrade.findFirst({ where: { userId: 's2' } }))?.status).toBe('DRAFT');
  });
});

// ---------------------------------------------------------------------------
describe('row-level security on appeals', () => {
  it('hides appeals from a connection with no tenant context', async () => {
    const unscoped = new PrismaClient({ datasourceUrl: db.appUrl });
    try {
      expect(await admin.gradeAppeal.count()).toBeGreaterThan(0);
      expect(await unscoped.gradeAppeal.count()).toBe(0);
    } finally {
      await unscoped.$disconnect();
    }
  });
});
