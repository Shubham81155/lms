import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// Course publishing review against a real PostgreSQL: off by default (instructors publish), and when an
// administrator turns it on, instructors submit drafts and administrators publish them or send them back.
// Every response is also checked against its documented schema.

const PASSWORD = 'CorrectHorse1!';
let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;
let RESPONSES: typeof import('../src/openapi/responses/learning.js').RESPONSES;

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
  await user('dean', 'TENANT_ADMIN');
  await user('teacher', 'INSTRUCTOR');
  await user('other-teacher', 'INSTRUCTOR');
  for (const c of ['c-open', 'c-new']) {
    await admin.course.create({ data: { id: c, tenantId: 't-h', code: c.toUpperCase(), title: `Course ${c}`, status: 'DRAFT' } });
    await admin.courseInstructor.create({ data: { courseId: c, userId: 'teacher', isPrimary: true } });
  }

  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
  RESPONSES = (await import('../src/openapi/responses/learning.js')).RESPONSES;
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

function check(key: string, res: { status: number; body: any }, status: number) {
  expect(res.status, `${key}: ${JSON.stringify(res.body)}`).toBe(status);
  const doc = [RESPONSES[key].response!, ...(RESPONSES[key].otherResponses ?? [])].find((d) => d.status === status);
  expect(doc, `${key}: status ${status} is not documented`).toBeDefined();
  if (doc!.schema) {
    const r = doc!.schema.safeParse(res.body);
    expect(r.success, `${key}: ${JSON.stringify(r.success ? res.body : r.error)}`).toBe(true);
  }
  return res.body;
}

const statusOf = async (id: string) => (await admin.course.findUniqueOrThrow({ where: { id } })).status;

describe('publishing review', () => {
  it('is off by default: instructors publish, and cannot submit for review', async () => {
    const t = await as('teacher');
    expect(check('GET /api/v1/admin/course-approval', await (await as('dean')).get('/api/v1/admin/course-approval'), 200).data).toEqual({
      required: false,
    });
    expect((await t.get('/api/v1/courses/c-open')).body.data.publishNeedsApproval).toBe(false);
    expect((await t.post('/api/v1/courses/c-new/review/submit').send({})).status).toBe(409);
    expect((await t.put('/api/v1/courses/c-open').send({ status: 'PUBLISHED' })).status).toBe(200);
    expect(await statusOf('c-open')).toBe('PUBLISHED');
  });

  it('is switched on by administrators only', async () => {
    expect((await (await as('teacher')).put('/api/v1/admin/course-approval').send({ required: true })).status).toBe(403);
    expect(
      check(
        'PUT /api/v1/admin/course-approval',
        await (await as('dean')).put('/api/v1/admin/course-approval').send({ required: true }),
        200
      ).data
    ).toEqual({ required: true });
    expect(await admin.auditLog.count({ where: { action: 'COURSE_APPROVAL_SETTING_CHANGED' } })).toBe(1);
  });

  it('then stops instructors publishing directly, but not unpublishing', async () => {
    const t = await as('teacher');
    expect((await t.get('/api/v1/courses/c-new')).body.data.publishNeedsApproval).toBe(true);
    const direct = await t.put('/api/v1/courses/c-new').send({ status: 'PUBLISHED' });
    expect(direct.status).toBe(403);
    expect(direct.body.error).toMatch(/submit this course for review/);
    expect((await t.post('/api/v1/courses').send({ code: 'NEW-PUB', title: 'Straight to learners', status: 'PUBLISHED' })).status).toBe(
      403
    );
    // An already published course stays editable, and can be taken down.
    expect((await t.put('/api/v1/courses/c-open').send({ title: 'Course c-open, renamed' })).status).toBe(200);
    expect((await (await as('dean')).get('/api/v1/courses/c-new')).body.data.publishNeedsApproval).toBe(false);
  });

  it('lets the course’s editors submit a draft, and tells administrators', async () => {
    // Not their course: a draft they cannot see does not exist for them.
    expect((await (await as('other-teacher')).post('/api/v1/courses/c-new/review/submit').send({})).status).toBe(404);
    const t = await as('teacher');
    check(
      'POST /api/v1/courses/:id/review/submit',
      await t.post('/api/v1/courses/c-new/review/submit').send({ message: 'Ready for spring' }),
      200
    );
    expect((await t.post('/api/v1/courses/c-new/review/submit').send({})).status).toBe(409);
    expect((await t.post('/api/v1/courses/c-open/review/submit').send({})).status).toBe(409); // published, not a draft
    expect(await admin.notification.count({ where: { userId: 'dean', title: 'C-NEW is waiting for review' } })).toBe(1);

    expect((await t.get('/api/v1/course-reviews')).status).toBe(403);
    const queue = check('GET /api/v1/course-reviews', await (await as('dean')).get('/api/v1/course-reviews'), 200);
    expect(queue.data).toMatchObject([{ id: 'c-new', code: 'C-NEW', message: 'Ready for spring', submittedBy: 'teacher L' }]);
  });

  it('sends a course back with reasons, and the instructors resubmit', async () => {
    const dean = await as('dean');
    expect((await (await as('teacher')).post('/api/v1/courses/c-new/review/request-changes').send({ note: 'Add a syllabus' })).status).toBe(
      403
    );
    expect((await dean.post('/api/v1/courses/c-new/review/request-changes').send({ note: 'x' })).status).toBe(400);
    const back = check(
      'POST /api/v1/courses/:id/review/request-changes',
      await dean.post('/api/v1/courses/c-new/review/request-changes').send({ note: 'Add a syllabus' }),
      200
    );
    expect(back.data.note).toBe('Add a syllabus');
    expect(await admin.course.findUniqueOrThrow({ where: { id: 'c-new' } })).toMatchObject({
      status: 'DRAFT',
      reviewStatus: 'CHANGES_REQUESTED',
      reviewNote: 'Add a syllabus',
      reviewedById: 'dean',
    });
    expect(await admin.notification.count({ where: { userId: 'teacher', title: 'Changes requested for C-NEW' } })).toBe(1);
    expect((await dean.get('/api/v1/course-reviews')).body.data).toEqual([]);
    expect((await dean.post('/api/v1/courses/c-new/review/approve')).status).toBe(409); // not waiting any more

    expect((await (await as('teacher')).post('/api/v1/courses/c-new/review/submit').send({})).status).toBe(200);
  });

  it('publishes on approval and tells the instructors', async () => {
    const dean = await as('dean');
    expect((await (await as('teacher')).post('/api/v1/courses/c-new/review/approve')).status).toBe(403);
    check('POST /api/v1/courses/:id/review/approve', await dean.post('/api/v1/courses/c-new/review/approve'), 200);
    expect(await admin.course.findUniqueOrThrow({ where: { id: 'c-new' } })).toMatchObject({
      status: 'PUBLISHED',
      reviewStatus: null,
      reviewedById: 'dean',
    });
    expect(await admin.notification.count({ where: { userId: 'teacher', title: 'C-NEW was approved and published' } })).toBe(1);
    const actions = (await admin.auditLog.findMany({ where: { resourceId: 'c-new' }, orderBy: { createdAt: 'asc' } })).map((a) => a.action);
    expect(actions).toEqual([
      'COURSE_REVIEW_SUBMITTED',
      'COURSE_REVIEW_CHANGES_REQUESTED',
      'COURSE_REVIEW_SUBMITTED',
      'COURSE_REVIEW_APPROVED',
    ]);
  });

  it('still lets administrators publish directly', async () => {
    const dean = await as('dean');
    const created = await dean.post('/api/v1/courses').send({ code: 'ADMIN-PUB', title: 'Published by the dean', status: 'PUBLISHED' });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('PUBLISHED');
  });
});
