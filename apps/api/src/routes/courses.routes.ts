import { Router, Request } from 'express';
import { z } from 'zod';
import { prisma, runInTenantTransaction } from '../lib/prisma';
import { logAuditEvent, pick } from '../lib/audit';
import { authenticateJWT, requireRole, tenantIdOf } from '../middleware/auth';
import { CourseStatus, ContentType, EnrollmentStatus } from '@enterprise-lms/database';
import { HttpError, route } from '../lib/http';
import { httpUrl, idSchema, pageMeta, paginationShape, parseBody, parseQuery } from '../lib/validate';
import { progressFromLessons } from '../lib/lesson-progress';
import { autoComplete } from '../lib/completion';
import { assertAttachable, linkOrUpload } from '../lib/stored-files';
import { recomputeCourseProgress } from '../lib/course-progress';
import { canSeeAllCourses, requireContentAccess, requireCourseAccess, requireCourseEditor } from '../lib/access';

const router = Router();

const COURSE_AUDIT_FIELDS = [
  'code', 'title', 'status', 'departmentId', 'passingGradePercent', 'allowSelfEnroll',
] as const;

const emptyToNull = (v: string | undefined | null) => (v === '' ? null : v);

const courseFields = {
  code: z.string().trim().min(2).max(50),
  title: z.string().trim().min(3).max(255),
  description: z.string().max(20_000).optional(),
  syllabus: z.string().max(50_000).optional(),
  thumbnailUrl: httpUrl.or(z.literal('')).optional(),
  passingGradePercent: z.number().min(0).max(100).optional(),
  allowSelfEnroll: z.boolean().optional(),
  status: z.nativeEnum(CourseStatus).optional(),
};

export const createCourseSchema = z.object({ ...courseFields, departmentId: idSchema.optional() });
export const updateCourseSchema = z.object(courseFields).partial().extend({ departmentId: idSchema.nullable().optional() });

export const createModuleSchema = z.object({
  title: z.string().trim().min(1).max(255),
  orderIndex: z.number().int().min(0).max(10_000).optional(),
  isLocked: z.boolean().optional(),
});
export const updateModuleSchema = createModuleSchema.partial();

const lessonFields = {
  title: z.string().trim().min(1).max(255),
  orderIndex: z.number().int().min(0).max(10_000).optional(),
  contentType: z.nativeEnum(ContentType).optional(),
  bodyContent: z.string().max(200_000).nullable().optional(),
  /** An http(s) URL, or an uploaded LESSON_MEDIA file of this course (/api/v1/files/<id>). */
  mediaUrl: linkOrUpload.nullable().optional(),
  scormPackageId: idSchema.nullable().optional(),
  ltiToolLaunchUrl: httpUrl.nullable().optional(),
  estimatedMinutes: z.number().int().min(1).max(1440).optional(),
};
export const createLessonSchema = z.object(lessonFields);
export const updateLessonSchema = z.object(lessonFields).partial();

export const listQuery = z.object({
  ...paginationShape,
  status: z.nativeEnum(CourseStatus).optional(),
  search: z.string().trim().max(100).optional(),
});

/** A department must exist inside the caller's tenant (row-level security scopes this lookup). */
async function assertDepartmentInTenant(departmentId: string | null | undefined) {
  if (!departmentId) return;
  const department = await prisma.department.findFirst({ where: { id: departmentId }, select: { id: true } });
  if (!department) throw new HttpError(400, 'Department not found');
}

/** Instructor contact details are for staff, not for learners browsing the catalogue. */
function instructorSelect(req: Request) {
  const staffView = canSeeAllCourses(req.user!.role) || ['INSTRUCTOR', 'TEACHING_ASSISTANT'].includes(req.user!.role);
  return {
    id: true,
    firstName: true,
    lastName: true,
    avatarUrl: true,
    ...(staffView ? { email: true } : {}),
  };
}

/**
 * GET /api/v1/courses
 * Learners see published courses; instructors see published courses plus their own drafts;
 * admins and auditors see everything in the tenant.
 */
router.get(
  '/',
  authenticateJWT,
  route('Failed to retrieve courses', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const { page, limit, status, search } = parseQuery(req, listQuery);
    const user = req.user!;

    const and: any[] = [];
    if (status) and.push({ status });
    if (search) {
      and.push({
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { code: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      });
    }
    if (!canSeeAllCourses(user.role)) {
      and.push(
        ['INSTRUCTOR', 'TEACHING_ASSISTANT'].includes(user.role)
          ? { OR: [{ status: 'PUBLISHED' }, { instructors: { some: { userId: user.id } } }] }
          : { status: 'PUBLISHED' }
      );
    }
    const where = { tenantId, ...(and.length ? { AND: and } : {}) };

    const [total, courses] = await Promise.all([
      prisma.course.count({ where }),
      prisma.course.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { instructors: true, enrollments: true, modules: true } },
          instructors: { select: { isPrimary: true, user: { select: instructorSelect(req) } } },
          department: { select: { id: true, name: true } },
        },
      }),
    ]);

    // Lesson count and total estimated study time per course, for the catalogue.
    const lessonRows = await prisma.lesson.findMany({
      where: { module: { courseId: { in: courses.map((c) => c.id) } } },
      select: { estimatedMinutes: true, module: { select: { courseId: true } } },
    });
    const study = new Map<string, { lessons: number; minutes: number }>();
    for (const l of lessonRows) {
      const s = study.get(l.module.courseId) ?? { lessons: 0, minutes: 0 };
      study.set(l.module.courseId, { lessons: s.lessons + 1, minutes: s.minutes + l.estimatedMinutes });
    }

    return res.status(200).json({
      data: courses.map(({ _count, ...course }) => ({
        ...course,
        instructorCount: _count.instructors,
        enrollmentCount: _count.enrollments,
        moduleCount: _count.modules,
        lessonCount: study.get(course.id)?.lessons ?? 0,
        estimatedMinutes: study.get(course.id)?.minutes ?? 0,
      })),
      pagination: pageMeta(page, limit, total),
    });
  })
);

/**
 * GET /api/v1/courses/departments
 * Departments to file a course under, for the people who create and edit courses.
 */
router.get(
  '/departments',
  authenticateJWT,
  requireRole('INSTRUCTOR', 'TEACHING_ASSISTANT', 'TENANT_ADMIN', 'SUPER_ADMIN'),
  route('Failed to load departments', async (req, res) => {
    const departments = await prisma.department.findMany({
      where: { campus: { tenantId: tenantIdOf(req) } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, code: true, campus: { select: { name: true } } },
    });
    return res.json({ data: departments.map((d) => ({ id: d.id, name: d.name, code: d.code, campus: d.campus.name })) });
  })
);

/**
 * GET /api/v1/courses/:id
 * Metadata for anyone who can see the course; modules and lessons only for enrolled learners,
 * assigned staff, admins and auditors.
 */
router.get(
  '/:id',
  authenticateJWT,
  route('Failed to retrieve course details', async (req, res) => {
    const access = await requireCourseAccess(req, String(req.params.id));

    const course = await prisma.course.findFirst({
      where: { id: access.course.id, tenantId: tenantIdOf(req) },
      include: {
        department: true,
        instructors: { select: { isPrimary: true, user: { select: instructorSelect(req) } } },
        modules: access.canAccessContent
          ? { orderBy: { orderIndex: 'asc' }, include: { lessons: { orderBy: { orderIndex: 'asc' } } } }
          : false,
        _count: { select: { enrollments: true, quizzes: true, assignments: true } },
      },
    });
    if (!course) throw new HttpError(404, 'Course not found');

    return res.status(200).json({
      data: {
        ...course,
        modules: course.modules ?? [],
        contentLocked: !access.canAccessContent,
        isEnrolled: access.isEnrolled,
        enrollmentCount: course._count.enrollments,
        quizCount: course._count.quizzes,
        assignmentCount: course._count.assignments,
      },
    });
  })
);

/** POST /api/v1/courses - create a course (INSTRUCTOR, TENANT_ADMIN, SUPER_ADMIN) */
router.post(
  '/',
  authenticateJWT,
  requireRole('INSTRUCTOR', 'TENANT_ADMIN', 'SUPER_ADMIN'),
  route('Failed to create course', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const input = parseBody(req, createCourseSchema);
    await assertDepartmentInTenant(input.departmentId);

    const course = await prisma.course.create({
      data: {
        tenantId,
        code: input.code,
        title: input.title,
        description: input.description,
        syllabus: input.syllabus,
        thumbnailUrl: emptyToNull(input.thumbnailUrl) ?? null,
        departmentId: input.departmentId,
        passingGradePercent: input.passingGradePercent ?? 70.0,
        allowSelfEnroll: input.allowSelfEnroll ?? false,
        status: input.status ?? CourseStatus.DRAFT,
        // An instructor who creates a course becomes its primary instructor.
        instructors:
          req.user!.role === 'INSTRUCTOR' ? { create: { userId: req.user!.id, isPrimary: true } } : undefined,
      },
      include: { instructors: { include: { user: { select: { id: true, firstName: true, lastName: true } } } } },
    });

    await logAuditEvent({
      tenantId,
      userId: req.user!.id,
      action: 'COURSE_CREATED',
      resourceType: 'COURSE',
      resourceId: course.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: pick(course, COURSE_AUDIT_FIELDS),
    });

    return res.status(201).json({ data: course });
  })
);

/** PUT /api/v1/courses/:id - update (assigned instructor or admin) */
router.put(
  '/:id',
  authenticateJWT,
  route('Failed to update course', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const id = String(req.params.id);
    const input = parseBody(req, updateCourseSchema);
    await requireCourseEditor(req, id);
    await assertDepartmentInTenant(input.departmentId);

    const before = await prisma.course.findFirstOrThrow({ where: { id, tenantId } });
    const updated = await prisma.course.update({
      where: { id },
      data: {
        code: input.code,
        title: input.title,
        description: input.description,
        syllabus: input.syllabus,
        thumbnailUrl: input.thumbnailUrl !== undefined ? emptyToNull(input.thumbnailUrl) : undefined,
        departmentId: input.departmentId,
        passingGradePercent: input.passingGradePercent,
        allowSelfEnroll: input.allowSelfEnroll,
        status: input.status,
      },
    });

    await logAuditEvent({
      tenantId,
      userId: req.user!.id,
      action: 'COURSE_UPDATED',
      resourceType: 'COURSE',
      resourceId: id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: { before: pick(before, COURSE_AUDIT_FIELDS), after: pick(updated, COURSE_AUDIT_FIELDS) },
    });

    return res.status(200).json({ data: updated });
  })
);

/** DELETE /api/v1/courses/:id - archive (soft delete), admins only */
router.delete(
  '/:id',
  authenticateJWT,
  requireRole('SUPER_ADMIN', 'TENANT_ADMIN'),
  route('Failed to archive course', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const id = String(req.params.id);

    const course = await prisma.course.findFirst({ where: { id, tenantId } });
    if (!course) throw new HttpError(404, 'Course not found');

    const archived = await prisma.course.update({ where: { id }, data: { status: CourseStatus.ARCHIVED } });

    await logAuditEvent({
      tenantId,
      userId: req.user!.id,
      action: 'COURSE_DELETED',
      resourceType: 'COURSE',
      resourceId: id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: { previousStatus: course.status, newStatus: CourseStatus.ARCHIVED },
    });

    return res.status(200).json({ message: 'Course archived successfully', id: archived.id, status: archived.status });
  })
);

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

/** GET /api/v1/courses/:id/modules */
router.get(
  '/:id/modules',
  authenticateJWT,
  route('Failed to retrieve course modules', async (req, res) => {
    const id = String(req.params.id);
    await requireContentAccess(req, id);

    const modules = await prisma.module.findMany({
      where: { courseId: id },
      orderBy: { orderIndex: 'asc' },
      include: { lessons: { orderBy: { orderIndex: 'asc' } } },
    });
    return res.status(200).json({ data: modules });
  })
);

/**
 * GET /api/v1/courses/:id/progress
 * The caller's own lesson progress in this course: which lessons are finished and the resulting percentage.
 */
router.get(
  '/:id/progress',
  authenticateJWT,
  route('Failed to retrieve lesson progress', async (req, res) => {
    const id = String(req.params.id);
    await requireContentAccess(req, id);
    const userId = req.user!.id;

    const [totalLessons, done] = await Promise.all([
      prisma.lesson.count({ where: { module: { courseId: id } } }),
      prisma.lessonProgress.findMany({ where: { courseId: id, userId }, select: { lessonId: true } }),
    ]);
    return res.status(200).json({
      data: {
        completedLessonIds: done.map((d) => d.lessonId),
        totalLessons,
        progressPercent: progressFromLessons(done.length, totalLessons),
      },
    });
  })
);

/**
 * POST /api/v1/courses/:id/lessons/:lessonId/complete
 * The learner marks a lesson finished (idempotent). Their enrollment's progress is recomputed from the
 * finished lessons; the last one can complete the course (see lib/completion), and `completion` says
 * where the course stands.
 */
router.post(
  '/:id/lessons/:lessonId/complete',
  authenticateJWT,
  route('Failed to record lesson progress', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const id = String(req.params.id);
    const userId = req.user!.id;
    await requireContentAccess(req, id);

    const enrollment = await prisma.enrollment.findUnique({ where: { courseId_userId: { courseId: id, userId } } });
    if (!enrollment || enrollment.status === EnrollmentStatus.DROPPED) {
      throw new HttpError(403, 'Forbidden: only enrolled learners can complete lessons');
    }

    const lesson = await prisma.lesson.findFirst({ where: { id: String(req.params.lessonId), module: { courseId: id } }, select: { id: true } });
    if (!lesson) throw new HttpError(404, 'Lesson not found');

    await prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId, lessonId: lesson.id } },
      update: {},
      create: { tenantId, courseId: id, userId, lessonId: lesson.id },
    });

    const [totalLessons, completed] = await Promise.all([
      prisma.lesson.count({ where: { module: { courseId: id } } }),
      prisma.lessonProgress.count({ where: { courseId: id, userId } }),
    ]);
    const progressPercent = progressFromLessons(completed, totalLessons);

    // A finished or failed course keeps the result staff recorded; only live enrollments are recomputed.
    const live = enrollment.status === EnrollmentStatus.ENROLLED || enrollment.status === EnrollmentStatus.IN_PROGRESS;
    if (live) {
      await prisma.enrollment.update({
        where: { id: enrollment.id },
        data: { progressPercent, status: progressPercent > 0 ? EnrollmentStatus.IN_PROGRESS : enrollment.status },
      });
    }

    const completion = await autoComplete(id, userId);
    return res.status(201).json({
      data: { lessonId: lesson.id, completedLessons: completed, totalLessons, progressPercent: live ? progressPercent : enrollment.progressPercent, completion },
    });
  })
);

/** POST /api/v1/courses/:id/modules */
router.post(
  '/:id/modules',
  authenticateJWT,
  route('Failed to create module', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const id = String(req.params.id);
    await requireCourseEditor(req, id);
    const input = parseBody(req, createModuleSchema);

    let orderIndex = input.orderIndex;
    if (orderIndex === undefined) {
      const max = await prisma.module.aggregate({ where: { courseId: id }, _max: { orderIndex: true } });
      orderIndex = (max._max?.orderIndex ?? -1) + 1;
    }

    const moduleRecord = await prisma.module.create({
      data: { courseId: id, title: input.title, orderIndex, isLocked: input.isLocked ?? false },
      include: { lessons: true },
    });

    await logAuditEvent({
      tenantId,
      userId: req.user!.id,
      action: 'MODULE_CREATED',
      resourceType: 'MODULE',
      resourceId: moduleRecord.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: { courseId: id, title: moduleRecord.title },
    });

    return res.status(201).json({ data: moduleRecord });
  })
);

export const orderSchema = z.object({ moduleIds: z.array(idSchema).min(1).max(500) });

/** PUT /api/v1/courses/:id/modules-order - reorder; the list must contain every module exactly once */
router.put(
  '/:id/modules-order',
  authenticateJWT,
  route('Failed to reorder modules', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const id = String(req.params.id);
    await requireCourseEditor(req, id);
    const { moduleIds } = parseBody(req, orderSchema);

    const existing = await prisma.module.findMany({ where: { courseId: id }, select: { id: true } });
    const existingIds = new Set(existing.map((m) => m.id));
    if (
      new Set(moduleIds).size !== moduleIds.length ||
      moduleIds.length !== existingIds.size ||
      !moduleIds.every((m) => existingIds.has(m))
    ) {
      throw new HttpError(400, 'moduleIds must list every module of this course exactly once');
    }

    await runInTenantTransaction(tenantId, async (tx) => {
      for (const [index, moduleId] of moduleIds.entries()) {
        await tx.module.update({ where: { id: moduleId }, data: { orderIndex: index } });
      }
    });

    const modules = await prisma.module.findMany({ where: { courseId: id }, orderBy: { orderIndex: 'asc' } });
    return res.status(200).json({ data: modules });
  })
);

/** PATCH /api/v1/courses/:id/modules/:moduleId */
router.patch(
  '/:id/modules/:moduleId',
  authenticateJWT,
  route('Failed to update module', async (req, res) => {
    const id = String(req.params.id);
    await requireCourseEditor(req, id);
    const input = parseBody(req, updateModuleSchema);

    const existing = await prisma.module.findFirst({ where: { id: String(req.params.moduleId), courseId: id } });
    if (!existing) throw new HttpError(404, 'Module not found');

    const updated = await prisma.module.update({ where: { id: existing.id }, data: input, include: { lessons: true } });
    return res.status(200).json({ data: updated });
  })
);

/** DELETE /api/v1/courses/:id/modules/:moduleId - also removes its lessons */
router.delete(
  '/:id/modules/:moduleId',
  authenticateJWT,
  route('Failed to delete module', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const id = String(req.params.id);
    await requireCourseEditor(req, id);

    const existing = await prisma.module.findFirst({ where: { id: String(req.params.moduleId), courseId: id } });
    if (!existing) throw new HttpError(404, 'Module not found');

    await prisma.module.delete({ where: { id: existing.id } });
    await logAuditEvent({
      tenantId,
      userId: req.user!.id,
      action: 'MODULE_DELETED',
      resourceType: 'MODULE',
      resourceId: existing.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: { courseId: id, title: existing.title },
    });
    await recomputeCourseProgress(id);
    return res.status(200).json({ message: 'Module deleted', id: existing.id });
  })
);

// ---------------------------------------------------------------------------
// Lessons
// ---------------------------------------------------------------------------

/** POST /api/v1/courses/:id/modules/:moduleId/lessons */
router.post(
  '/:id/modules/:moduleId/lessons',
  authenticateJWT,
  route('Failed to create lesson', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const id = String(req.params.id);
    await requireCourseEditor(req, id);
    const input = parseBody(req, createLessonSchema);
    await assertAttachable(input.mediaUrl, { tenantId: tenantIdOf(req), courseId: id, purpose: 'LESSON_MEDIA' });

    const moduleRecord = await prisma.module.findFirst({ where: { id: String(req.params.moduleId), courseId: id } });
    if (!moduleRecord) throw new HttpError(404, 'Module not found');

    let orderIndex = input.orderIndex;
    if (orderIndex === undefined) {
      const max = await prisma.lesson.aggregate({ where: { moduleId: moduleRecord.id }, _max: { orderIndex: true } });
      orderIndex = (max._max?.orderIndex ?? -1) + 1;
    }

    const lesson = await prisma.lesson.create({ data: { ...input, orderIndex, moduleId: moduleRecord.id } });

    await logAuditEvent({
      tenantId,
      userId: req.user!.id,
      action: 'LESSON_CREATED',
      resourceType: 'LESSON',
      resourceId: lesson.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: { courseId: id, moduleId: moduleRecord.id, title: lesson.title, contentType: lesson.contentType },
    });
    await recomputeCourseProgress(id);
    return res.status(201).json({ data: lesson });
  })
);

/** PATCH /api/v1/courses/:id/lessons/:lessonId */
router.patch(
  '/:id/lessons/:lessonId',
  authenticateJWT,
  route('Failed to update lesson', async (req, res) => {
    const id = String(req.params.id);
    await requireCourseEditor(req, id);
    const input = parseBody(req, updateLessonSchema);
    await assertAttachable(input.mediaUrl, { tenantId: tenantIdOf(req), courseId: id, purpose: 'LESSON_MEDIA' });

    const lesson = await prisma.lesson.findFirst({ where: { id: String(req.params.lessonId), module: { courseId: id } } });
    if (!lesson) throw new HttpError(404, 'Lesson not found');

    const updated = await prisma.lesson.update({ where: { id: lesson.id }, data: input });
    return res.status(200).json({ data: updated });
  })
);

/** DELETE /api/v1/courses/:id/lessons/:lessonId */
router.delete(
  '/:id/lessons/:lessonId',
  authenticateJWT,
  route('Failed to delete lesson', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const id = String(req.params.id);
    await requireCourseEditor(req, id);

    const lesson = await prisma.lesson.findFirst({ where: { id: String(req.params.lessonId), module: { courseId: id } } });
    if (!lesson) throw new HttpError(404, 'Lesson not found');

    await prisma.lesson.delete({ where: { id: lesson.id } });
    await logAuditEvent({
      tenantId,
      userId: req.user!.id,
      action: 'LESSON_DELETED',
      resourceType: 'LESSON',
      resourceId: lesson.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: { courseId: id, title: lesson.title },
    });
    await recomputeCourseProgress(id);
    return res.status(200).json({ message: 'Lesson deleted', id: lesson.id });
  })
);

export default router;
