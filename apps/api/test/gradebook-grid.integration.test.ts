import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// The gradebook grid and its CSV export against a real PostgreSQL: who may see it, how each cell is scored
// (best finished quiz attempt, pending manual grading, missing work), and that the export is formula-safe
// and audited.

const PASSWORD = 'CorrectHorse1!';
let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  await admin.tenant.create({ data: { id: 't-h', slug: 'harvard', name: 'harvard' } });
  const user = (id: string, role: any, firstName = id, lastName = 'L') =>
    admin.user.create({ data: { id, tenantId: 't-h', email: `${id}@x.edu`, firstName, lastName, role, passwordHash: bcrypt.hashSync(PASSWORD, 4), emailVerified: true } });
  await user('teacher', 'INSTRUCTOR');
  await user('other-teacher', 'INSTRUCTOR');
  await user('s1', 'STUDENT', 'Ann', 'Zed');
  await user('s2', 'STUDENT', '=HYPERLINK("x")', 'Abe');
  await user('dropped', 'STUDENT');
  await admin.course.create({ data: { id: 'c1', tenantId: 't-h', code: 'CS 101', title: 'Course', status: 'PUBLISHED' } });
  await admin.courseInstructor.create({ data: { courseId: 'c1', userId: 'teacher', isPrimary: true } });
  for (const s of ['s1', 's2']) await admin.enrollment.create({ data: { tenantId: 't-h', courseId: 'c1', userId: s, status: 'IN_PROGRESS' } });
  await admin.enrollment.create({ data: { tenantId: 't-h', courseId: 'c1', userId: 'dropped', status: 'DROPPED' } });

  await admin.quiz.create({
    data: {
      id: 'q1', tenantId: 't-h', courseId: 'c1', title: 'Quiz 1',
      questions: { create: [{ questionText: '2 + 2?', questionType: 'MULTIPLE_CHOICE', points: 4, optionsJson: [{ id: 'o4', text: '4', isCorrect: true }] }] },
    },
  });
  // s1: two finished attempts, the best one counts. s2: one attempt still waiting for manual grading.
  await admin.quizSubmission.create({ data: { quizId: 'q1', userId: 's1', attemptNumber: 1, score: 1, maxScore: 4, submittedAt: new Date(), answersJson: {} } });
  await admin.quizSubmission.create({ data: { quizId: 'q1', userId: 's1', attemptNumber: 2, score: 3, maxScore: 4, submittedAt: new Date(), answersJson: {} } });
  await admin.quizSubmission.create({ data: { quizId: 'q1', userId: 's2', attemptNumber: 1, score: 0, maxScore: 4, submittedAt: new Date(), answersJson: { pendingManual: ['q'] } } });

  await admin.assignment.create({ data: { id: 'a1', tenantId: 't-h', courseId: 'c1', title: 'Essay', instructions: 'Write', maxPoints: 20 } });
  await admin.assignmentSubmission.create({ data: { assignmentId: 'a1', userId: 's1', submissionText: 'x', grade: 17 } });
  await admin.courseGrade.create({ data: { tenantId: 't-h', courseId: 'c1', userId: 's1', rawPercent: 80, curvedPercent: 82, letter: 'B', breakdownJson: {}, status: 'APPROVED' } });

  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
}, 240_000);

afterAll(async () => {
  await admin?.$disconnect();
  await db?.stop();
}, 60_000);

async function as(who: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').set('x-tenant-id', 'harvard').send({ email: `${who}@x.edu`, password: PASSWORD });
  expect(res.status, `login as ${who}`).toBe(200);
  return agent;
}

describe('gradebook grid', () => {
  it('is for course staff only', async () => {
    expect((await (await as('s1')).get('/api/v1/courses/c1/gradebook/grid')).status).toBe(403);
    expect((await (await as('other-teacher')).get('/api/v1/courses/c1/gradebook/grid')).status).toBe(403);
    expect((await (await as('s1')).get('/api/v1/courses/c1/gradebook/export.csv')).status).toBe(403);
  });

  it('scores every active learner on every item, sorted by last name', async () => {
    const res = await (await as('teacher')).get('/api/v1/courses/c1/gradebook/grid');
    expect(res.status).toBe(200);
    const { items, learners } = res.body.data;
    expect(items.map((i: any) => [i.id, i.type])).toEqual([['q1', 'QUIZ'], ['a1', 'ASSIGNMENT']]);
    expect(learners.map((l: any) => l.userId)).toEqual(['s2', 's1']);

    const [s2, s1] = learners;
    expect(s1.scores.q1).toEqual({ percent: 75, pending: false, missing: false });
    expect(s1.scores.a1).toEqual({ percent: 85, pending: false, missing: false });
    expect(s1.courseGrade).toEqual({ rawPercent: 80, curvedPercent: 82, letter: 'B', status: 'APPROVED' });
    expect(s2.scores.q1).toEqual({ percent: null, pending: true, missing: false });
    expect(s2.scores.a1).toEqual({ percent: 0, pending: false, missing: true });
    expect(s2.courseGrade).toBeNull();
  });
});

describe('gradebook CSV export', () => {
  it('exports the grid as a formula-safe CSV and audits it', async () => {
    const res = await (await as('teacher')).get('/api/v1/courses/c1/gradebook/export.csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toBe('attachment; filename="grades-CS_101.csv"');

    const lines = res.text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
    expect(lines[0]).toBe('name,email,Quiz 1 (%),Essay (%),course_raw_%,course_curved_%,letter,grade_status');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('pending,missing,,,,');
    expect(lines[1]).not.toMatch(/(^|,)"?=/);
    expect(lines[2]).toBe('Ann Zed,s1@x.edu,75,85,80,82,B,APPROVED');

    const log = await admin.auditLog.findFirst({ where: { action: 'GRADES_EXPORTED', resourceId: 'c1' } });
    expect(log?.userId).toBe('teacher');
    expect(log?.diffJson).toEqual({ learners: 2, items: 2 });
  });
});
