import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// "Continue: <next lesson>" against a real PostgreSQL: a learner's own enrollment list says how many lessons
// they have finished and which one is next in course order (module order, then lesson order), while a
// roster does not carry it.

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
  await user('s1', 'STUDENT');
  for (const c of ['c1', 'c-empty'])
    await admin.course.create({ data: { id: c, tenantId: 't-h', code: c.toUpperCase(), title: c, status: 'PUBLISHED' } });
  await admin.courseInstructor.create({ data: { courseId: 'c1', userId: 'teacher', isPrimary: true } });
  for (const c of ['c1', 'c-empty'])
    await admin.enrollment.create({ data: { tenantId: 't-h', courseId: c, userId: 's1', status: 'IN_PROGRESS' } });

  // Created out of order on purpose: the order comes from orderIndex, not from creation.
  await admin.module.create({
    data: {
      id: 'm2',
      courseId: 'c1',
      title: 'Week 2',
      orderIndex: 2,
      lessons: { create: [{ id: 'l3', title: 'Recursion', orderIndex: 1 }] },
    },
  });
  await admin.module.create({
    data: {
      id: 'm1',
      courseId: 'c1',
      title: 'Week 1',
      orderIndex: 1,
      lessons: {
        create: [
          { id: 'l2', title: 'Loops', orderIndex: 2 },
          { id: 'l1', title: 'Variables', orderIndex: 1 },
        ],
      },
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

const mine = async (s: request.Agent) => {
  const res = await s.get('/api/v1/enrollments/my');
  expect(res.status).toBe(200);
  return new Map<string, any>(res.body.data.map((e: any) => [e.courseId, e]));
};

describe('continue where you left off', () => {
  it('points at the first lesson of the first module to begin with', async () => {
    const list = await mine(await as('s1'));
    expect(list.get('c1')).toMatchObject({
      lessons: { total: 3, completed: 0 },
      nextLesson: { id: 'l1', title: 'Variables', moduleTitle: 'Week 1' },
    });
    expect(list.get('c-empty')).toMatchObject({ lessons: { total: 0, completed: 0 }, nextLesson: null });
  });

  it('skips finished lessons, including ones finished out of order', async () => {
    const s1 = await as('s1');
    expect((await s1.post('/api/v1/courses/c1/lessons/l1/complete').send({})).status).toBe(201);
    expect((await s1.post('/api/v1/courses/c1/lessons/l3/complete').send({})).status).toBe(201);
    expect((await mine(s1)).get('c1')).toMatchObject({
      lessons: { total: 3, completed: 2 },
      nextLesson: { id: 'l2', moduleTitle: 'Week 1' },
    });

    expect((await s1.post('/api/v1/courses/c1/lessons/l2/complete').send({})).status).toBe(201);
    expect((await mine(s1)).get('c1')).toMatchObject({ lessons: { total: 3, completed: 3 }, nextLesson: null });
  });

  it('is not part of a roster', async () => {
    const roster = await (await as('teacher')).get('/api/v1/enrollments').query({ courseId: 'c1' });
    expect(roster.status).toBe(200);
    expect(roster.body.data[0].nextLesson).toBeUndefined();
    expect(roster.body.data[0].lessons).toBeUndefined();
  });
});
