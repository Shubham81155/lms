import { Router, type Request } from 'express';
import { z } from 'zod';
import { CourseStatus } from '@enterprise-lms/database';
import { prisma } from '../lib/prisma';
import { HttpError, route } from '../lib/http';
import { idSchema, parseBody } from '../lib/validate';
import { isAdminRole, requireCourseEditor } from '../lib/access';
import { logAuditEvent } from '../lib/audit';
import { notifyMany } from '../lib/notify';
import { authenticateJWT, requireRole, tenantIdOf } from '../middleware/auth';

// Mounted at /api/v1. Publishing review: when the organisation turns it on (Tenant.requireCourseApproval),
// only administrators publish courses. An instructor submits a draft for review; an administrator publishes
// it or sends it back with reasons. Off, instructors publish themselves as before.

const router = Router();
router.use(['/admin/course-approval', '/course-reviews', '/courses/:id/review'], authenticateJWT);

export const approvalSettingSchema = z.object({ required: z.boolean() });
export const submitReviewSchema = z.object({ message: z.string().trim().max(2000).optional() });
export const requestChangesSchema = z.object({ note: z.string().trim().min(3).max(2000) });

/** Whether publishing a course in this organisation needs an administrator's approval. */
export async function approvalRequired(tenantId: string): Promise<boolean> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { requireCourseApproval: true } });
  return !!t?.requireCourseApproval;
}

/** Throws unless the caller may move a course to PUBLISHED (admins always may; others only when review is off). */
export async function assertMayPublish(req: Request, next: CourseStatus | undefined, current: CourseStatus | null) {
  if (next !== CourseStatus.PUBLISHED || current === CourseStatus.PUBLISHED || isAdminRole(req.user!.role)) return;
  if (await approvalRequired(tenantIdOf(req))) {
    throw new HttpError(403, 'Courses are reviewed before they are published here: submit this course for review');
  }
}

const audit = (req: Request, action: string, courseId: string, diffJson?: unknown) =>
  logAuditEvent({
    tenantId: tenantIdOf(req),
    userId: req.user!.id,
    action,
    resourceType: 'COURSE',
    resourceId: courseId,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    diffJson,
  });

const nameOf = (u: { firstName: string; lastName: string } | null | undefined) => (u ? `${u.firstName} ${u.lastName}` : null);

/** GET /api/v1/admin/course-approval (administrators) */
router.get(
  '/admin/course-approval',
  requireRole('TENANT_ADMIN', 'SUPER_ADMIN'),
  route('Failed to load the setting', async (req, res) => {
    return res.json({ data: { required: await approvalRequired(tenantIdOf(req)) } });
  })
);

/** PUT /api/v1/admin/course-approval {required} (administrators). Audited. */
router.put(
  '/admin/course-approval',
  requireRole('TENANT_ADMIN', 'SUPER_ADMIN'),
  route('Failed to change the setting', async (req, res) => {
    const { required } = parseBody(req, approvalSettingSchema);
    await prisma.tenant.update({ where: { id: tenantIdOf(req) }, data: { requireCourseApproval: required } });
    await logAuditEvent({
      tenantId: tenantIdOf(req),
      userId: req.user!.id,
      action: 'COURSE_APPROVAL_SETTING_CHANGED',
      resourceType: 'TENANT',
      resourceId: tenantIdOf(req),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: { required },
    });
    return res.json({ data: { required } });
  })
);

/** GET /api/v1/course-reviews (administrators): courses waiting for review, oldest first. */
router.get(
  '/course-reviews',
  requireRole('TENANT_ADMIN', 'SUPER_ADMIN'),
  route('Failed to load the review queue', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const courses = await prisma.course.findMany({
      where: { tenantId, reviewStatus: 'PENDING' },
      orderBy: { reviewSubmittedAt: 'asc' },
      select: {
        id: true,
        code: true,
        title: true,
        reviewNote: true,
        reviewSubmittedAt: true,
        reviewSubmittedById: true,
        term: { select: { name: true } },
        _count: { select: { modules: true, quizzes: true, assignments: true } },
      },
    });
    const submitters = await prisma.user.findMany({
      where: { id: { in: courses.map((c) => c.reviewSubmittedById).filter((x): x is string => !!x) } },
      select: { id: true, firstName: true, lastName: true },
    });
    const byId = new Map(submitters.map((u) => [u.id, u]));
    return res.json({
      data: courses.map((c) => ({
        id: c.id,
        code: c.code,
        title: c.title,
        term: c.term?.name ?? null,
        message: c.reviewNote,
        submittedAt: c.reviewSubmittedAt,
        submittedBy: nameOf(c.reviewSubmittedById ? byId.get(c.reviewSubmittedById) : null),
        counts: c._count,
      })),
    });
  })
);

/** The course's instructors and its submitter, to tell about a decision. */
async function courseTeam(courseId: string, submitterId: string | null) {
  const team = await prisma.courseInstructor.findMany({ where: { courseId }, select: { userId: true } });
  return [...new Set([...team.map((t) => t.userId), ...(submitterId ? [submitterId] : [])])];
}

/** POST /api/v1/courses/:id/review/submit {message?}: the course's editors, for a draft, while review is on. */
router.post(
  '/courses/:id/review/submit',
  route('Failed to submit the course for review', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const access = await requireCourseEditor(req, idSchema.parse(req.params.id));
    const { message } = parseBody(req, submitReviewSchema);
    if (!(await approvalRequired(tenantId))) throw new HttpError(409, 'Courses do not need approval here; publish it from its settings');
    const course = await prisma.course.findUniqueOrThrow({
      where: { id: access.course.id },
      select: { id: true, code: true, title: true, status: true, reviewStatus: true },
    });
    if (course.status !== CourseStatus.DRAFT) throw new HttpError(409, 'Only a draft course can be submitted for review');
    if (course.reviewStatus === 'PENDING') throw new HttpError(409, 'This course is already waiting for review');

    const now = new Date();
    await prisma.course.update({
      where: { id: course.id },
      data: {
        reviewStatus: 'PENDING',
        reviewNote: message || null,
        reviewSubmittedById: req.user!.id,
        reviewSubmittedAt: now,
        reviewedById: null,
        reviewedAt: null,
      },
    });
    const admins = await prisma.user.findMany({
      where: { tenantId, status: 'ACTIVE', role: { in: ['TENANT_ADMIN', 'SUPER_ADMIN'] } },
      select: { id: true },
    });
    await notifyMany(
      admins.map((a) => ({
        tenantId,
        userId: a.id,
        category: 'COURSE',
        title: `${course.code} is waiting for review`,
        body: message || `${course.title} was submitted for publishing.`,
        link: '/admin#courses',
      }))
    );
    await audit(req, 'COURSE_REVIEW_SUBMITTED', course.id, { message: message || null });
    return res.json({ data: { id: course.id, reviewStatus: 'PENDING', submittedAt: now } });
  })
);

/** POST /api/v1/courses/:id/review/approve (administrators): publishes the course. */
router.post(
  '/courses/:id/review/approve',
  requireRole('TENANT_ADMIN', 'SUPER_ADMIN'),
  route('Failed to approve the course', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const course = await prisma.course.findFirst({
      where: { id: idSchema.parse(req.params.id), tenantId },
      select: { id: true, code: true, title: true, reviewStatus: true, reviewSubmittedById: true },
    });
    if (!course) throw new HttpError(404, 'Course not found');
    if (course.reviewStatus !== 'PENDING') throw new HttpError(409, 'This course is not waiting for review');
    const now = new Date();
    await prisma.course.update({
      where: { id: course.id },
      data: { status: CourseStatus.PUBLISHED, reviewStatus: null, reviewNote: null, reviewedById: req.user!.id, reviewedAt: now },
    });
    const team = await courseTeam(course.id, course.reviewSubmittedById);
    await notifyMany(
      team.map((userId) => ({
        tenantId,
        userId,
        category: 'COURSE',
        title: `${course.code} was approved and published`,
        body: `${course.title} is now open to learners.`,
        link: '/teacher',
      }))
    );
    await audit(req, 'COURSE_REVIEW_APPROVED', course.id);
    return res.json({ data: { id: course.id, status: 'PUBLISHED', reviewedAt: now } });
  })
);

/** POST /api/v1/courses/:id/review/request-changes {note} (administrators): back to the instructors, with reasons. */
router.post(
  '/courses/:id/review/request-changes',
  requireRole('TENANT_ADMIN', 'SUPER_ADMIN'),
  route('Failed to send the course back', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const { note } = parseBody(req, requestChangesSchema);
    const course = await prisma.course.findFirst({
      where: { id: idSchema.parse(req.params.id), tenantId },
      select: { id: true, code: true, reviewStatus: true, reviewSubmittedById: true },
    });
    if (!course) throw new HttpError(404, 'Course not found');
    if (course.reviewStatus !== 'PENDING') throw new HttpError(409, 'This course is not waiting for review');
    const now = new Date();
    await prisma.course.update({
      where: { id: course.id },
      data: { reviewStatus: 'CHANGES_REQUESTED', reviewNote: note, reviewedById: req.user!.id, reviewedAt: now },
    });
    const team = await courseTeam(course.id, course.reviewSubmittedById);
    await notifyMany(
      team.map((userId) => ({
        tenantId,
        userId,
        category: 'COURSE',
        title: `Changes requested for ${course.code}`,
        body: note,
        link: '/teacher',
      }))
    );
    await audit(req, 'COURSE_REVIEW_CHANGES_REQUESTED', course.id, { note });
    return res.json({ data: { id: course.id, reviewStatus: 'CHANGES_REQUESTED', note, reviewedAt: now } });
  })
);

export default router;
