import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createTenantPrismaClient, findRlsBypassReason, runWithTenant, TenantPrismaClient } from '../src/index';
import { startTestDatabase, TestDatabase } from '../test-utils/embedded';

// Real PostgreSQL (throwaway, isolated data dir, random port) so the actual migrations and
// policies are exercised. It never touches any database you have configured.

const A = 'tenant-a';
const B = 'tenant-b';

let db: TestDatabase;
let admin: PrismaClient; // superuser: bypasses RLS, used to arrange test data
let app: TenantPrismaClient; // lms_app: the role the API uses

beforeAll(async () => {
  db = await startTestDatabase();
  const adminUrl = db.adminUrl;
  const appUrl = db.appUrl;

  admin = new PrismaClient({ datasourceUrl: adminUrl });
  for (const [id, slug] of [
    [A, 'a'],
    [B, 'b'],
  ]) {
    await admin.tenant.create({ data: { id, slug, name: `Tenant ${slug}` } });
    await admin.user.create({
      data: { id: `u-${slug}`, tenantId: id, email: `u@${slug}.edu`, firstName: 'U', lastName: slug },
    });
    const course = await admin.course.create({
      data: { id: `c-${slug}`, tenantId: id, code: 'C1', title: `Course ${slug}` },
    });
    await admin.enrollment.create({
      data: { id: `e-${slug}`, tenantId: id, courseId: course.id, userId: `u-${slug}` },
    });
    const module_ = await admin.module.create({ data: { id: `m-${slug}`, courseId: course.id, title: 'M' } });
    await admin.lesson.create({ data: { id: `l-${slug}`, moduleId: module_.id, title: 'L' } });
    const quiz = await admin.quiz.create({
      data: { id: `q-${slug}`, tenantId: id, courseId: course.id, title: 'Q' },
    });
    await admin.quizQuestion.create({
      data: { id: `qq-${slug}`, quizId: quiz.id, questionText: 'secret answer key' },
    });
    await admin.auditLog.create({
      data: { tenantId: id, action: 'X', resourceType: 'T' },
    });
  }

  app = createTenantPrismaClient({ datasourceUrl: appUrl });
}, 240_000);

afterAll(async () => {
  await app?.base.$disconnect();
  await admin?.$disconnect();
  await db?.stop();
}, 60_000);

const asTenant = <T>(id: string, fn: () => Promise<T>) => runWithTenant(id, fn);

describe('test fixture', () => {
  it('has data for both tenants (control: privileged role sees everything)', async () => {
    expect(await admin.course.count()).toBe(2);
    expect(await admin.user.count()).toBe(2);
  });

  it('connects the API client as a role that does not bypass RLS', async () => {
    expect(await findRlsBypassReason(app.base)).toBeNull();
    expect(await findRlsBypassReason(admin)).toMatch(/superuser/);
  });
});

describe('row-level security', () => {
  it('fails closed: no tenant context returns no rows', async () => {
    expect(await app.prisma.user.findMany()).toEqual([]);
    expect(await app.prisma.course.count()).toBe(0);
    expect(await app.prisma.auditLog.count()).toBe(0);
  });

  it('shows a tenant only its own rows, in every table', async () => {
    await asTenant(A, async () => {
      const p = app.prisma;
      expect((await p.user.findMany()).map((u) => u.id)).toEqual(['u-a']);
      expect((await p.course.findMany()).map((c) => c.id)).toEqual(['c-a']);
      expect((await p.enrollment.findMany()).map((e) => e.id)).toEqual(['e-a']);
      expect((await p.quiz.findMany()).map((q) => q.id)).toEqual(['q-a']);
      expect((await p.auditLog.findMany()).length).toBe(1);
      // child tables without their own tenantId
      expect((await p.module.findMany()).map((m) => m.id)).toEqual(['m-a']);
      expect((await p.lesson.findMany()).map((l) => l.id)).toEqual(['l-a']);
      expect((await p.quizQuestion.findMany()).map((q) => q.id)).toEqual(['qq-a']);
    });
  });

  it('cannot read another tenant by id', async () => {
    await asTenant(A, async () => {
      expect(await app.prisma.course.findUnique({ where: { id: 'c-b' } })).toBeNull();
      expect(await app.prisma.quizQuestion.findUnique({ where: { id: 'qq-b' } })).toBeNull();
      expect(await app.prisma.user.findFirst({ where: { email: 'u@b.edu' } })).toBeNull();
    });
  });

  it('cannot read another tenant through relations', async () => {
    await asTenant(A, async () => {
      const course = await app.prisma.course.findUnique({
        where: { id: 'c-a' },
        include: { modules: { include: { lessons: true } }, quizzes: { include: { questions: true } } },
      });
      expect(course?.modules.map((m) => m.id)).toEqual(['m-a']);
      expect(course?.quizzes[0].questions.map((q) => q.id)).toEqual(['qq-a']);
    });
  });

  it('cannot modify or delete another tenant’s rows', async () => {
    await asTenant(A, async () => {
      expect((await app.prisma.course.updateMany({ where: { id: 'c-b' }, data: { title: 'pwned' } })).count).toBe(0);
      expect((await app.prisma.course.deleteMany({ where: { id: 'c-b' } })).count).toBe(0);
      await expect(app.prisma.course.update({ where: { id: 'c-b' }, data: { title: 'pwned' } })).rejects.toThrow();
    });
    expect((await admin.course.findUniqueOrThrow({ where: { id: 'c-b' } })).title).toBe('Course b');
  });

  it('cannot insert a row for another tenant', async () => {
    await asTenant(A, async () => {
      await expect(app.prisma.course.create({ data: { tenantId: B, code: 'EVIL', title: 'x' } })).rejects.toThrow();
      await expect(app.prisma.user.create({ data: { tenantId: B, email: 'evil@b.edu', firstName: 'e', lastName: 'e' } })).rejects.toThrow();
    });
  });

  it('cannot attach child rows to another tenant’s parent', async () => {
    await asTenant(A, async () => {
      await expect(app.prisma.module.create({ data: { courseId: 'c-b', title: 'evil' } })).rejects.toThrow();
      await expect(app.prisma.quizQuestion.create({ data: { quizId: 'q-b', questionText: 'evil' } })).rejects.toThrow();
    });
    expect(await admin.module.count({ where: { title: 'evil' } })).toBe(0);
  });

  it('can create its own rows, including children', async () => {
    await asTenant(A, async () => {
      const course = await app.prisma.course.create({ data: { tenantId: A, code: 'NEW', title: 'New' } });
      await app.prisma.module.create({ data: { courseId: course.id, title: 'ok' } });
      expect(await app.prisma.course.count()).toBe(2);
    });
    await app.prisma.course.count(); // no context: still nothing
    await admin.course.deleteMany({ where: { code: 'NEW' } });
  });

  it('does not leak between concurrent requests sharing the connection pool', async () => {
    const results = await Promise.all(
      Array.from({ length: 60 }, (_, i) => {
        const tenant = i % 2 === 0 ? A : B;
        return asTenant(tenant, async () => {
          const courses = await app.prisma.course.findMany();
          const users = await app.prisma.user.findMany();
          return { tenant, courses: courses.map((c) => c.tenantId), users: users.map((u) => u.tenantId) };
        });
      })
    );
    for (const r of results) {
      expect(r.courses).toEqual([r.tenant]);
      expect(r.users).toEqual([r.tenant]);
    }
  });

  it('applies the tenant to a lazy query returned straight out of the scope', async () => {
    // Prisma queries only run when awaited; they must still run inside the tenant scope.
    const courses = await runWithTenant(A, () => app.prisma.course.findMany());
    expect(courses.map((c) => c.id)).toEqual(['c-a']);
    const counted = await runWithTenant(B, () => app.prisma.user.count());
    expect(counted).toBe(1);
  });

  it('does not keep the tenant after a request finishes', async () => {
    await asTenant(A, () => app.prisma.course.count());
    expect(await app.prisma.course.count()).toBe(0);
    expect(await app.base.course.count()).toBe(0);
  });

  it('runInTenantTransaction scopes to the tenant and rolls back as one unit', async () => {
    await expect(
      app.runInTenantTransaction(A, async (tx) => {
        await tx.course.create({ data: { tenantId: A, code: 'TX', title: 'tx' } });
        expect(await tx.course.count()).toBe(2);
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(await admin.course.count({ where: { code: 'TX' } })).toBe(0);

    const seen = await app.runInTenantTransaction(B, (tx) => tx.course.findMany());
    expect(seen.map((c) => c.id)).toEqual(['c-b']);
  });

  it('leaves tenant lookup (login) available without a tenant context', async () => {
    const tenant = await app.prisma.tenant.findFirst({ where: { slug: 'a' } });
    expect(tenant?.id).toBe(A);
  });
});
