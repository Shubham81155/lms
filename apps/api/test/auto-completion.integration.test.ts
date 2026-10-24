import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// Automatic course completion against a real PostgreSQL. Finishing every lesson takes progress to 100%.
// A course without a gradebook completes then; one with a gradebook completes only when the learner's grade
// is approved and passing, whichever happens last. A failing grade, or a course with no lessons, is left to
// staff: nothing here ever records FAILED.

const PASSWORD = 'CorrectHorse1!';
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
  await user('dean', 'TENANT_ADMIN');
  for (const s of ['s1', 's2', 's3', 's4']) await user(s, 'STUDENT');

  // c-plain has no gradebook; c-graded has one (a grade category), pass mark 70.
  for (const c of ['c-plain', 'c-graded']) {
    await admin.course.create({
      data: { id: c, tenantId: 't-h', code: c.toUpperCase(), title: c, status: 'PUBLISHED', passingGradePercent: 70 },
    });
    await admin.courseInstructor.create({ data: { courseId: c, userId: 'teacher', isPrimary: true } });
    await admin.module.create({
      data: {
        courseId: c,
        title: 'Week 1',
        orderIndex: 1,
        lessons: {
          create: [
            { id: `${c}-l1`, title: 'One', orderIndex: 1 },
            { id: `${c}-l2`, title: 'Two', orderIndex: 2 },
          ],
        },
      },
    });
  }
  await admin.gradeCategory.create({ data: { tenantId: 't-h', courseId: 'c-graded', name: 'Exams', weightPercent: 100 } });
  await admin.enrollment.create({ data: { tenantId: 't-h', courseId: 'c-plain', userId: 's1', status: 'IN_PROGRESS' } });
  for (const s of ['s2', 's3', 's4'])
    await admin.enrollment.create({ data: { tenantId: 't-h', courseId: 'c-graded', userId: s, status: 'IN_PROGRESS' } });

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

const finish = async (who: string, courseId: string, lesson: string) => {
  const res = await (await as(who)).post(`/api/v1/courses/${courseId}/lessons/${courseId}-${lesson}/complete`).send({});
  expect(res.status).toBe(201);
  return res.body.data;
};
const enrollmentOf = (userId: string, courseId: string) =>
  admin.enrollment.findUniqueOrThrow({ where: { courseId_userId: { courseId, userId } }, include: { certificate: true } });
const submittedGrade = (userId: string, curvedPercent: number) =>
  admin.courseGrade.create({
    data: {
      tenantId: 't-h',
      courseId: 'c-graded',
      userId,
      rawPercent: curvedPercent,
      curvedPercent,
      letter: 'X',
      breakdownJson: {},
      status: 'SUBMITTED',
      submittedById: 'teacher',
    },
  });

describe('course without a gradebook', () => {
  it('completes on the last lesson and issues the certificate', async () => {
    expect(await finish('s1', 'c-plain', 'l1')).toMatchObject({ progressPercent: 50, completion: 'LESSONS_REMAINING' });
    expect((await enrollmentOf('s1', 'c-plain')).status).toBe('IN_PROGRESS');

    expect(await finish('s1', 'c-plain', 'l2')).toMatchObject({ progressPercent: 100, completion: 'COMPLETED' });
    const e = await enrollmentOf('s1', 'c-plain');
    expect(e).toMatchObject({ status: 'COMPLETED', progressPercent: 100 });
    expect(e.completedAt).not.toBeNull();
    expect(e.certificate).not.toBeNull();
    expect(await admin.notification.count({ where: { userId: 's1', title: 'You completed c-plain' } })).toBe(1);
  });

  it('does not complete again when a lesson is re-sent', async () => {
    expect(await finish('s1', 'c-plain', 'l2')).toMatchObject({ completion: 'COMPLETED' });
    expect(await admin.notification.count({ where: { userId: 's1', title: 'You completed c-plain' } })).toBe(1);
  });
});

describe('course with a gradebook', () => {
  it('waits for the approved grade after the last lesson', async () => {
    await finish('s2', 'c-graded', 'l1');
    expect(await finish('s2', 'c-graded', 'l2')).toMatchObject({ progressPercent: 100, completion: 'AWAITING_GRADE' });
    const e = await enrollmentOf('s2', 'c-graded');
    expect(e).toMatchObject({ status: 'IN_PROGRESS', progressPercent: 100, certificate: null });
  });

  it('completes passing learners and leaves failing ones to staff when grades are approved', async () => {
    // s3 also finishes every lesson but scores below the pass mark; s4 has not finished the lessons.
    await finish('s3', 'c-graded', 'l1');
    await finish('s3', 'c-graded', 'l2');
    await finish('s4', 'c-graded', 'l1');
    await submittedGrade('s2', 88);
    await submittedGrade('s3', 55);
    await submittedGrade('s4', 91);

    const res = await (await as('dean')).post('/api/v1/courses/c-graded/gradebook/approve').send({});
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ approved: 3, completed: 1 });

    expect(await enrollmentOf('s2', 'c-graded')).toMatchObject({ status: 'COMPLETED', finalGrade: 88, progressPercent: 100 });
    expect((await enrollmentOf('s2', 'c-graded')).certificate).not.toBeNull();
    expect(await enrollmentOf('s3', 'c-graded')).toMatchObject({ status: 'IN_PROGRESS', finalGrade: 55, certificate: null });
    expect(await enrollmentOf('s4', 'c-graded')).toMatchObject({ status: 'IN_PROGRESS', finalGrade: 91, certificate: null });
  });

  it('says why a finished learner below the pass mark is not complete', async () => {
    expect(await finish('s3', 'c-graded', 'l2')).toMatchObject({ completion: 'BELOW_PASS_MARK' });
  });

  it('completes on the last lesson when the grade is already approved', async () => {
    expect(await finish('s4', 'c-graded', 'l2')).toMatchObject({ progressPercent: 100, completion: 'COMPLETED' });
    expect(await enrollmentOf('s4', 'c-graded')).toMatchObject({ status: 'COMPLETED', finalGrade: 91 });
  });

  it('still does not let learners report 100% by hand', async () => {
    const fresh = await admin.enrollment.create({ data: { tenantId: 't-h', courseId: 'c-plain', userId: 's3', status: 'IN_PROGRESS' } });
    expect((await (await as('s3')).patch(`/api/v1/enrollments/${fresh.id}/progress`).send({ progressPercent: 100 })).status).toBe(403);
  });
});
