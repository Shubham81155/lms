import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// Quiz and assignment due dates on the calendar against a real PostgreSQL: they appear without anyone
// creating an event, follow the caller's own extension, respect the date range and course visibility, are
// marked completed once the work is in, and are part of the iCalendar feed.

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
    admin.user.create({ data: { id, tenantId: 't-h', email: `${id}@x.edu`, firstName: id, lastName: 'L', role, passwordHash: bcrypt.hashSync(PASSWORD, 4), emailVerified: true } });
  await user('teacher', 'INSTRUCTOR');
  for (const s of ['s1', 's2', 'outsider']) await user(s, 'STUDENT');
  for (const c of ['c1', 'c2']) await admin.course.create({ data: { id: c, tenantId: 't-h', code: c.toUpperCase(), title: c, status: 'PUBLISHED' } });
  await admin.courseInstructor.create({ data: { courseId: 'c1', userId: 'teacher', isPrimary: true } });
  for (const s of ['s1', 's2']) await admin.enrollment.create({ data: { tenantId: 't-h', courseId: 'c1', userId: s, status: 'IN_PROGRESS' } });
  await admin.enrollment.create({ data: { tenantId: 't-h', courseId: 'c2', userId: 'outsider', status: 'IN_PROGRESS' } });

  const question = { questionText: '2 + 2?', questionType: 'MULTIPLE_CHOICE' as const, points: 1, optionsJson: [{ id: 'o4', text: '4', isCorrect: true }] };
  await admin.quiz.create({ data: { id: 'q1', tenantId: 't-h', courseId: 'c1', title: 'Midterm', dueAt: at(3 * DAY), questions: { create: [question] } } });
  // No questions yet: not ready, so not on the calendar.
  await admin.quiz.create({ data: { id: 'q-empty', tenantId: 't-h', courseId: 'c1', title: 'Draft quiz', dueAt: at(3 * DAY) } });
  await admin.quiz.create({ data: { id: 'q-undated', tenantId: 't-h', courseId: 'c1', title: 'Practice', questions: { create: [question] } } });
  await admin.assignment.create({ data: { id: 'a1', tenantId: 't-h', courseId: 'c1', title: 'Essay', instructions: 'Write', dueDate: at(DAY) } });
  await admin.assignment.create({ data: { id: 'a-far', tenantId: 't-h', courseId: 'c1', title: 'Project', instructions: 'Build', dueDate: at(60 * DAY) } });
  await admin.assignment.create({ data: { id: 'a-other', tenantId: 't-h', courseId: 'c2', title: 'Other course', instructions: 'Write', dueDate: at(DAY) } });

  // s2 has a week's extension on the essay and has already taken the midterm (its only attempt).
  await admin.deadlineExtension.create({ data: { tenantId: 't-h', userId: 's2', assignmentId: 'a1', dueAt: at(7 * DAY), grantedById: 'teacher' } });
  await admin.quizSubmission.create({ data: { quizId: 'q1', userId: 's2', score: 1, maxScore: 1, passed: true, submittedAt: new Date(), answersJson: {} } });

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

const calendar = async (who: string, query: Record<string, string> = {}) => {
  const res = await (await as(who)).get('/api/v1/calendar/events').query(query);
  expect(res.status).toBe(200);
  return res.body as { data: any[]; nextDeadline: any };
};

describe('due dates on the calendar', () => {
  it('lists dated, ready quizzes and assignments from the learner’s courses, soonest first', async () => {
    const { data, nextDeadline } = await calendar('s1');
    expect(data.map((e) => e.id)).toEqual(['assignment-a1', 'quiz-q1', 'assignment-a-far']);
    expect(data[0]).toMatchObject({ source: 'ASSIGNMENT', itemId: 'a1', courseId: 'c1', category: 'DEADLINE', title: 'C1: Essay due', createdById: null, extended: false, completed: false });
    expect(data[0].startsAt).toBe(data[0].endsAt);
    expect(data[1]).toMatchObject({ source: 'QUIZ', category: 'EXAM', title: 'C1: Midterm due' });
    expect(nextDeadline.id).toBe('assignment-a1');
  });

  it('uses the learner’s own extension and marks finished work', async () => {
    const { data, nextDeadline } = await calendar('s2');
    const essay = data.find((e) => e.id === 'assignment-a1');
    expect(essay.extended).toBe(true);
    expect(new Date(essay.startsAt).getTime()).toBeGreaterThan(Date.now() + 6 * DAY);
    expect(data.find((e) => e.id === 'quiz-q1').completed).toBe(true);
    // The midterm is done, so the next deadline is the extended essay.
    expect(nextDeadline.id).toBe('assignment-a1');
  });

  it('filters by the personal due date, not the course one', async () => {
    const window = { from: at(2 * DAY).toISOString(), to: at(10 * DAY).toISOString() };
    expect((await calendar('s1', window)).data.map((e) => e.id)).toEqual(['quiz-q1']);
    expect((await calendar('s2', window)).data.map((e) => e.id)).toEqual(['quiz-q1', 'assignment-a1']);
  });

  it('shows staff the course dates and keeps other courses out', async () => {
    const teacher = await calendar('teacher');
    expect(teacher.data.find((e) => e.id === 'assignment-a1').extended).toBe(false);
    expect(teacher.data.some((e) => e.courseId === 'c2')).toBe(false);
    expect((await calendar('outsider')).data.map((e) => e.id)).toEqual(['assignment-a-other']);
    expect((await calendar('outsider', { courseId: 'c1' })).data).toEqual([]);
  });

  it('includes due dates in the iCalendar feed', async () => {
    const ics = await (await as('s1')).get('/api/v1/calendar/export.ics');
    expect(ics.status).toBe(200);
    expect(ics.text).toContain('UID:assignment-a1@enterprise-lms');
    expect(ics.text).toContain('SUMMARY:C1: Midterm due');
  });

  it('cannot be edited or deleted as an event', async () => {
    const t = await as('teacher');
    expect((await t.patch('/api/v1/calendar/events/assignment-a1').send({ title: 'x' })).status).toBeGreaterThanOrEqual(400);
    expect((await t.delete('/api/v1/calendar/events/quiz-q1')).status).toBeGreaterThanOrEqual(400);
    expect(await admin.assignment.count({ where: { id: 'a1' } })).toBe(1);
  });
});
