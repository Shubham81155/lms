import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// Assignment submission history against a real PostgreSQL (as the unprivileged app role, so row-level
// security applies): every submit keeps a version, the learner and course staff can read them, nobody else
// can, and erasing a learner's personal data clears the text of every version.

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
  await user('other-teacher', 'INSTRUCTOR');
  for (const s of ['s1', 's2']) await user(s, 'STUDENT');
  await admin.course.create({ data: { id: 'c1', tenantId: 't-h', code: 'C1', title: 'Course', status: 'PUBLISHED' } });
  await admin.courseInstructor.create({ data: { courseId: 'c1', userId: 'teacher', isPrimary: true } });
  for (const s of ['s1', 's2'])
    await admin.enrollment.create({ data: { tenantId: 't-h', courseId: 'c1', userId: s, status: 'IN_PROGRESS' } });
  await admin.assignment.create({
    data: { id: 'a1', tenantId: 't-h', courseId: 'c1', title: 'Essay', instructions: 'Write', maxPoints: 10 },
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

let subId: string;
const versions = async (who: string) => (await as(who)).get(`/api/v1/assignments/a1/submissions/${subId}/versions`);

describe('submission history', () => {
  it('keeps every version, newest first, while the submission row holds the latest', async () => {
    const s1 = await as('s1');
    const first = await s1.post('/api/v1/assignments/a1/submit').send({ submissionText: 'First draft' });
    expect(first.status).toBe(201);
    expect(first.body.data.version).toBe(1);
    subId = first.body.data.id;
    const second = await s1
      .post('/api/v1/assignments/a1/submit')
      .send({ submissionText: 'Second draft', fileUrl: 'https://files.example/essay.pdf' });
    expect(second.body.data).toMatchObject({ id: subId, version: 2, submissionText: 'Second draft' });

    const res = await versions('s1');
    expect(res.status).toBe(200);
    expect(res.body.data.map((v: any) => [v.version, v.submissionText, v.fileUrl])).toEqual([
      [2, 'Second draft', 'https://files.example/essay.pdf'],
      [1, 'First draft', null],
    ]);
    expect(await admin.assignmentSubmission.count({ where: { assignmentId: 'a1', userId: 's1' } })).toBe(1);
  });

  it('is for the learner and the course staff only', async () => {
    expect((await versions('teacher')).body.data).toHaveLength(2);
    expect((await versions('s2')).status).toBe(404);
    expect((await versions('other-teacher')).status).toBe(403);
  });

  it('stops growing once the work is graded', async () => {
    const graded = await (await as('teacher')).patch(`/api/v1/assignments/a1/submissions/${subId}/grade`).send({ grade: 8 });
    expect(graded.status).toBe(200);
    expect((await (await as('s1')).post('/api/v1/assignments/a1/submit').send({ submissionText: 'Third' })).status).toBe(409);
    expect((await versions('s1')).body.data).toHaveLength(2);
  });

  it('is part of the personal data export and cleared on erasure', async () => {
    const s1 = await as('s1');
    const exported = await s1.get('/api/v1/privacy/me/export');
    expect(exported.status).toBe(200);
    const text = typeof exported.body === 'object' && Object.keys(exported.body).length ? JSON.stringify(exported.body) : exported.text;
    expect(text).toContain('First draft');

    expect((await s1.post('/api/v1/privacy/me/erase').send({ confirmEmail: 's1@x.edu', password: PASSWORD })).status).toBe(200);
    const left = await admin.assignmentSubmissionVersion.findMany({ where: { submissionId: subId } });
    expect(left).toHaveLength(2);
    expect(left.every((v) => v.submissionText === null && v.fileUrl === null)).toBe(true);
  });
});
