import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// The real app, the real migrations, and the unprivileged lms_app role (so RLS is enforced),
// against a throwaway PostgreSQL. Nothing is mocked.

const PASSWORD = 'CorrectHorse1!';
const COURSE_ID = {
  harvard: '11111111-1111-4111-8111-111111111111',
  mit: '22222222-2222-4222-8222-222222222222',
};

let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;
let setMailer: typeof import('../src/lib/mailer.js').setMailer;
const mails: { to: string; text: string }[] = [];

const hash = (p: string) => bcrypt.hashSync(p, 4);

async function seedTenant(id: string, slug: string) {
  await admin.tenant.create({ data: { id, slug, name: `${slug} University` } });
  const mk = (suffix: string, role: any, extra: object = {}) =>
    admin.user.create({
      data: {
        id: `${slug}-${suffix}`,
        tenantId: id,
        email: `${suffix}@x.edu`, // identical emails in both tenants on purpose
        firstName: suffix,
        lastName: slug,
        role,
        passwordHash: hash(`${PASSWORD}-${slug}`),
        emailVerified: true,
        ...extra,
      },
    });
  await mk('admin', 'TENANT_ADMIN');
  await mk('teacher', 'INSTRUCTOR');
  await mk('student', 'STUDENT');
  await mk('unverified', 'STUDENT', { emailVerified: false });
  const course = await admin.course.create({
    data: { id: COURSE_ID[slug as 'harvard' | 'mit'], tenantId: id, code: 'CS-101', title: `${slug} course`, status: 'PUBLISHED', allowSelfEnroll: true },
  });
  await admin.courseInstructor.create({ data: { courseId: course.id, userId: `${slug}-teacher`, isPrimary: true } });
  await admin.enrollment.create({ data: { tenantId: id, courseId: course.id, userId: `${slug}-student` } });
}

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  await seedTenant('ten-h', 'harvard');
  await seedTenant('ten-m', 'mit');

  process.env.DATABASE_URL = db.appUrl; // API connects as lms_app
  app = (await import('../src/server.js')).app;
  setMailer = (await import('../src/lib/mailer.js')).setMailer;
  setMailer({ send: async (m) => void mails.push(m) });
}, 240_000);

afterAll(async () => {
  await admin?.$disconnect();
  await db?.stop();
}, 60_000);

/** Signs in and returns a supertest agent that carries the session cookie. */
async function signIn(tenant: 'harvard' | 'mit', who: string, password = `${PASSWORD}-${tenant}`) {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/v1/auth/login')
    .set('x-tenant-id', tenant)
    .send({ email: `${who}@x.edu`, password });
  return { agent, res };
}

describe('sign-in is scoped to a tenant', () => {
  it('logs the same email into the tenant named by the hint, with that tenant’s password', async () => {
    const h = await signIn('harvard', 'student');
    expect(h.res.status).toBe(200);
    expect(h.res.body.user.tenant.slug).toBe('harvard');

    const m = await signIn('mit', 'student');
    expect(m.res.status).toBe(200);
    expect(m.res.body.user.tenant.slug).toBe('mit');
    expect(m.res.body.user.id).not.toBe(h.res.body.user.id);
  });

  it('does not accept harvard’s password for mit', async () => {
    const res = await signIn('mit', 'student', `${PASSWORD}-harvard`);
    expect(res.res.status).toBe(401);
  });

  it('returns branding for the resolved tenant', async () => {
    const res = await request(app).get('/api/v1/tenant/config').set('x-tenant-id', 'mit');
    expect(res.body.name).toBe('mit University');
  });
});

describe('an authenticated user only ever sees their own tenant', () => {
  it('lists only own-tenant courses', async () => {
    const { agent } = await signIn('harvard', 'student');
    const res = await agent.get('/api/v1/courses');
    expect(res.status).toBe(200);
    expect(res.body.data.map((c: any) => c.id)).toEqual([COURSE_ID.harvard]);
  });

  it('cannot fetch another tenant’s course by id', async () => {
    const { agent } = await signIn('harvard', 'student');
    expect((await agent.get(`/api/v1/courses/${COURSE_ID.mit}`)).status).toBe(404);
    expect((await agent.get(`/api/v1/courses/${COURSE_ID.mit}/modules`)).status).toBe(404);
  });

  it('cannot switch tenant with a header while holding a session', async () => {
    const { agent } = await signIn('harvard', 'student');
    const res = await agent.get('/api/v1/courses').set('x-tenant-id', 'mit');
    expect(res.body.data.map((c: any) => c.id)).toEqual([COURSE_ID.harvard]);
    const me = await agent.get('/api/v1/auth/me').set('x-tenant-id', 'ten-m');
    expect(me.body.user.tenant.slug).toBe('harvard');
  });

  it('cannot modify another tenant’s course, even as that role', async () => {
    const { agent } = await signIn('harvard', 'admin');
    const res = await agent.put(`/api/v1/courses/${COURSE_ID.mit}`).send({ title: 'pwned' });
    expect(res.status).toBe(404);
    expect((await admin.course.findUniqueOrThrow({ where: { id: COURSE_ID.mit } })).title).toBe('mit course');
  });

  it('cannot enrol into another tenant’s course', async () => {
    const { agent } = await signIn('harvard', 'student');
    const res = await agent.post('/api/v1/enrollments').send({ courseId: COURSE_ID.mit });
    expect(res.status).toBe(404);
  });

  it('cannot enrol or read another tenant’s user', async () => {
    const { agent } = await signIn('harvard', 'admin');
    expect((await agent.get('/api/v1/users/mit-student')).status).toBe(404);
    const list = await agent.get('/api/v1/users');
    expect(list.body.data.every((u: any) => u.tenantId === 'ten-h')).toBe(true);
    expect(list.body.pagination.total).toBe(4);
  });

  it('admin stats and audit logs are per tenant', async () => {
    const { agent } = await signIn('harvard', 'admin');
    const stats = await agent.get('/api/v1/admin/stats');
    expect(stats.body.data.totalUsers).toBe(4);
    expect(stats.body.data.totalCourses).toBe(1);

    const logs = await agent.get('/api/v1/admin/audit-logs');
    expect(logs.body.data.length).toBeGreaterThan(0);
    expect(logs.body.data.every((l: any) => l.tenantId === 'ten-h')).toBe(true);
  });

  it('writes audit events under the right tenant', async () => {
    const before = await admin.auditLog.count({ where: { tenantId: 'ten-m', action: 'USER_LOGIN' } });
    await signIn('mit', 'teacher');
    expect(await admin.auditLog.count({ where: { tenantId: 'ten-m', action: 'USER_LOGIN' } })).toBe(before + 1);
  });

  it('lets an instructor create a course that lands in their own tenant only', async () => {
    const { agent } = await signIn('mit', 'teacher');
    const res = await agent.post('/api/v1/courses').send({ code: 'NEW-1', title: 'A new course' });
    expect(res.status).toBe(201);
    expect(res.body.data.tenantId).toBe('ten-m');
    expect(res.body.data.instructors).toHaveLength(1);
    expect(await admin.course.count({ where: { code: 'NEW-1', tenantId: 'ten-h' } })).toBe(0);
  });
});

describe('lockout against the real database', () => {
  it('locks after repeated failures and refuses the correct password until it expires', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await signIn('mit', 'unverified', 'wrong-password')).res.status).toBe(401);
    }
    const locked = await signIn('mit', 'unverified');
    expect(locked.res.status).toBe(423);

    await admin.user.update({ where: { id: 'mit-unverified' }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    expect((await signIn('mit', 'unverified')).res.status).toBe(200);
  });
});

describe('password reset, end to end', () => {
  it('emails a link, sets a new password once, and the old one stops working', async () => {
    mails.length = 0;
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .set('x-tenant-id', 'harvard')
      .send({ email: 'student@x.edu' });
    expect(res.status).toBe(200);
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe('student@x.edu');

    const token = mails[0].text.match(/token=([\w-]+)/)![1];
    const stored = await admin.passwordResetToken.findMany({ where: { userId: 'harvard-student' } });
    expect(stored).toHaveLength(1);
    expect(stored[0].tenantId).toBe('ten-h');
    expect(JSON.stringify(stored)).not.toContain(token);

    const newPassword = 'a-brand-new-password-1';
    const reset = await request(app).post('/api/v1/auth/reset-password').send({ token, password: newPassword });
    expect(reset.status).toBe(200);

    expect((await signIn('harvard', 'student')).res.status).toBe(401); // old password
    expect((await signIn('harvard', 'student', newPassword)).res.status).toBe(200);
    expect((await signIn('mit', 'student')).res.status).toBe(200); // other tenant untouched

    const reuse = await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'another-password-2' });
    expect(reuse.status).toBe(400);
  });

  it('sends nothing for an unknown email, with the same response', async () => {
    mails.length = 0;
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .set('x-tenant-id', 'harvard')
      .send({ email: 'nobody@x.edu' });
    expect(res.status).toBe(200);
    expect(mails).toHaveLength(0);
  });
});

describe('email verification, end to end', () => {
  it('verifies the address with the emailed single-use link', async () => {
    mails.length = 0;
    const { agent } = await signIn('harvard', 'unverified');
    expect((await agent.post('/api/v1/auth/resend-verification')).status).toBe(200);
    expect(mails).toHaveLength(1);

    const token = mails[0].text.match(/token=([\w-]+)/)![1];
    expect((await request(app).post('/api/v1/auth/verify-email').send({ token })).status).toBe(200);
    expect((await admin.user.findUniqueOrThrow({ where: { id: 'harvard-unverified' } })).emailVerified).toBe(true);
    expect((await request(app).post('/api/v1/auth/verify-email').send({ token })).status).toBe(400);
  });
});

describe('sessions are revoked server-side', () => {
  const tokenOf = (res: request.Response) => String(res.headers['set-cookie']).match(/lms_token=([^;]+)/)![1];

  it('a copied token stops working after logout', async () => {
    const { agent, res } = await signIn('harvard', 'teacher');
    const token = tokenOf(res);
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(200);

    await agent.post('/api/v1/auth/logout');
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);
    expect((await signIn('harvard', 'teacher')).res.status).toBe(200); // a fresh sign-in works again
  });

  it('a suspended user is cut off immediately and a reinstated one needs a new sign-in', async () => {
    const { res } = await signIn('mit', 'teacher');
    const token = tokenOf(res);
    const call = () => request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect((await call()).status).toBe(200);

    await admin.user.update({ where: { id: 'mit-teacher' }, data: { status: 'SUSPENDED', tokenVersion: { increment: 1 } } });
    expect((await call()).status).toBe(401);

    await admin.user.update({ where: { id: 'mit-teacher' }, data: { status: 'ACTIVE' } });
    expect((await call()).status).toBe(401); // the old token stays dead
    expect((await signIn('mit', 'teacher')).res.status).toBe(200);
  });

  it('the role in the database wins over the role in the token', async () => {
    const { res } = await signIn('mit', 'teacher');
    const token = tokenOf(res);
    await admin.user.update({ where: { id: 'mit-teacher' }, data: { role: 'STUDENT' } });
    const stats = await request(app).get('/api/v1/admin/stats').set('Authorization', `Bearer ${token}`);
    expect(stats.status).toBe(403);
    await admin.user.update({ where: { id: 'mit-teacher' }, data: { role: 'INSTRUCTOR' } });
  });
});

describe('the database role', () => {
  it('is not allowed to bypass row-level security', async () => {
    const { basePrisma } = await import('../src/lib/prisma.js');
    const { findRlsBypassReason } = await import('@enterprise-lms/database');
    expect(await findRlsBypassReason(basePrisma)).toBeNull();
  });
});

describe('responses match the API description', () => {
  it('login, /me, course list and enrollment list have the documented shape', async () => {
    const { PublicUser, CourseListItem, EnrollmentItem, Pagination } = await import('../src/openapi/docs.js');
    const { z } = await import('zod');
    // An earlier test reset this learner's password; restore the seed one.
    await admin.user.update({ where: { id: 'harvard-student' }, data: { passwordHash: hash(`${PASSWORD}-harvard`) } });
    const { agent, res } = await signIn('harvard', 'student');
    expect(PublicUser.safeParse(res.body.user).success, JSON.stringify(PublicUser.safeParse(res.body.user))).toBe(true);

    const me = await agent.get('/api/v1/auth/me');
    expect(PublicUser.safeParse(me.body.user).success).toBe(true);

    const courses = await agent.get('/api/v1/courses');
    const coursesShape = z.object({ data: z.array(CourseListItem), pagination: Pagination });
    const parsedCourses = coursesShape.safeParse(courses.body);
    expect(parsedCourses.success, JSON.stringify(parsedCourses)).toBe(true);
    expect(courses.body.data.length).toBeGreaterThan(0);

    const enrollments = await agent.get('/api/v1/enrollments');
    const enrollmentsShape = z.object({ data: z.array(EnrollmentItem), pagination: Pagination });
    const parsedEnrollments = enrollmentsShape.safeParse(enrollments.body);
    expect(parsedEnrollments.success, JSON.stringify(parsedEnrollments)).toBe(true);
    expect(enrollments.body.data.length).toBeGreaterThan(0);
  });

  it('enrolling returns the documented shape', async () => {
    const { EnrollmentCreated } = await import('../src/openapi/docs.js');
    await admin.enrollment.deleteMany({ where: { userId: 'harvard-student', courseId: COURSE_ID.harvard } });
    const { agent } = await signIn('harvard', 'student');
    const res = await agent.post('/api/v1/enrollments').send({ courseId: COURSE_ID.harvard });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const parsed = EnrollmentCreated.safeParse(res.body.data);
    expect(parsed.success, JSON.stringify(parsed)).toBe(true);
  });

  it('errors have the documented { error, requestId } shape', async () => {
    const { ErrorResponse } = await import('../src/openapi/docs.js');
    const res = await request(app).post('/api/v1/auth/login').set('x-tenant-id', 'harvard').send({ email: 'nope' });
    expect(res.status).toBe(400);
    expect(ErrorResponse.safeParse(res.body).success).toBe(true);
    const unauth = await request(app).get('/api/v1/courses');
    expect(unauth.status).toBe(401);
  });
});
