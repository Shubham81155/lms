import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { logAuditEvent } from '../lib/audit';
import { authenticateJWT, tenantIdOf } from '../middleware/auth';
import { EnrollmentStatus } from '@enterprise-lms/database';
import { HttpError, route } from '../lib/http';
import { idSchema, pageMeta, paginationShape, parseBody, parseQuery } from '../lib/validate';
import { COURSE_STAFF_ROLES, isAdminRole, canSeeAllCourses } from '../lib/access';
import { issueCertificate } from '../lib/certificates';

const router = Router();

const enrollSchema = z.object({
  courseId: idSchema,
  userId: idSchema.optional(),
});

const updateProgressSchema = z.object({
  progressPercent: z.number().min(0).max(100),
  finalGrade: z.number().min(0).max(100).optional(),
});

const statsQuery = z.object({ userId: idSchema.optional() });

const listQuery = z.object({
  ...paginationShape,
  userId: idSchema.optional(),
  courseId: idSchema.optional(),
  status: z.nativeEnum(EnrollmentStatus).optional(),
});

/** Highest progress a learner can report themselves; finishing a course is recorded by staff. */
const LEARNER_MAX_PROGRESS = 99;

const courseSummary = {
  id: true,
  code: true,
  title: true,
  description: true,
  thumbnailUrl: true,
  status: true,
  passingGradePercent: true,
} as const;

const isCourseStaff = (user: NonNullable<Request['user']>, instructorIds: string[]) =>
  isAdminRole(user.role) ||
  ((COURSE_STAFF_ROLES as readonly string[]).includes(user.role) && instructorIds.includes(user.id));

/**
 * GET /api/v1/enrollments/stats
 * Aggregates for the caller; admins and auditors may pass ?userId=.
 */
router.get(
  '/stats',
  authenticateJWT,
  route('Failed to retrieve enrollment statistics', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const { userId } = parseQuery(req, statsQuery);
    const user = req.user!;

    if (userId && userId !== user.id && !canSeeAllCourses(user.role)) {
      throw new HttpError(403, 'Forbidden: you can only view your own statistics');
    }

    const enrollments = await prisma.enrollment.findMany({
      where: { tenantId, userId: userId ?? user.id },
      select: { status: true, progressPercent: true },
    });

    const count = (s: EnrollmentStatus) => enrollments.filter((e) => e.status === s).length;
    const total = enrollments.length;
    const totalProgress = enrollments.reduce((sum, e) => sum + e.progressPercent, 0);

    return res.status(200).json({
      data: {
        total,
        completed: count(EnrollmentStatus.COMPLETED),
        inProgress: count(EnrollmentStatus.IN_PROGRESS),
        enrolled: count(EnrollmentStatus.ENROLLED),
        dropped: count(EnrollmentStatus.DROPPED),
        failed: count(EnrollmentStatus.FAILED),
        averageProgress: total > 0 ? parseFloat((totalProgress / total).toFixed(2)) : 0,
      },
    });
  })
);

/**
 * GET /api/v1/enrollments   (alias: GET /enrollments/my)
 * Own enrollments by default. Passing another ?userId= or a ?courseId= lists a roster, which
 * learners may not do, instructors may do only for courses they teach, and admins/auditors for any.
 */
const listEnrollments = route('Failed to retrieve enrollments', async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const user = req.user!;
  const { page, limit, userId, courseId, status } = parseQuery(req, listQuery);

  const rosterMode = (!!userId && userId !== user.id) || (!userId && !!courseId);
  const where: any = { tenantId };

  if (!rosterMode) {
    where.userId = user.id;
  } else {
    if (userId) where.userId = userId;
    if (canSeeAllCourses(user.role)) {
      // unrestricted within the tenant
    } else if ((COURSE_STAFF_ROLES as readonly string[]).includes(user.role)) {
      where.course = { instructors: { some: { userId: user.id } } };
    } else {
      throw new HttpError(403, 'Forbidden: you can only view your own enrollments');
    }
  }
  if (courseId) where.courseId = courseId;
  if (status) where.status = status;

  const [total, enrollments] = await Promise.all([
    prisma.enrollment.count({ where }),
    prisma.enrollment.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { enrolledAt: 'desc' },
      include: {
        course: { select: courseSummary },
        certificate: {
          select: { id: true, certificateNumber: true, issuedAt: true, pdfUrl: true, verificationQr: true },
        },
      },
    }),
  ]);

  return res.status(200).json({ data: enrollments, pagination: pageMeta(page, limit, total) });
});

router.get('/', authenticateJWT, listEnrollments);
router.get('/my', authenticateJWT, listEnrollments);

/**
 * POST /api/v1/enrollments
 *  - yourself: students only, in a published course that allows self-enrolment
 *  - someone else: administrators or the course's instructor
 */
router.post(
  '/',
  authenticateJWT,
  route('Failed to enroll in course', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const user = req.user!;
    const { courseId, userId } = parseBody(req, enrollSchema);
    const targetId = userId ?? user.id;
    const selfEnroll = targetId === user.id;

    const course = await prisma.course.findFirst({
      where: { id: courseId, tenantId },
      select: {
        id: true,
        status: true,
        allowSelfEnroll: true,
        instructors: { select: { userId: true } },
      },
    });
    const staff = !!course && isCourseStaff(user, course.instructors.map((i) => i.userId));

    // Learners cannot tell a draft from a course that does not exist.
    if (!course || (course.status !== 'PUBLISHED' && !staff && !canSeeAllCourses(user.role))) {
      throw new HttpError(404, 'Course not found');
    }
    if (course.status === 'ARCHIVED') throw new HttpError(400, 'Cannot enroll in an archived course');

    if (selfEnroll) {
      if (!isAdminRole(user.role)) {
        if (user.role !== 'STUDENT' && !staff) {
          throw new HttpError(403, 'Forbidden: your role cannot enroll in courses');
        }
        if (!course.allowSelfEnroll) {
          throw new HttpError(
            403,
            'Self-enrollment is not permitted for this course. Please contact an instructor or administrator.'
          );
        }
        if (course.status !== 'PUBLISHED') throw new HttpError(400, 'This course is not open for enrollment');
      }
    } else if (!staff || (user.role === 'TEACHING_ASSISTANT')) {
      // Only administrators and the assigned instructor may enroll other people.
      throw new HttpError(403, 'Forbidden: only the course instructor or an administrator can enroll other users');
    }

    const target = await prisma.user.findFirst({
      where: { id: targetId, tenantId },
      select: { id: true, status: true },
    });
    if (!target) throw new HttpError(404, 'User not found in tenant');
    if (target.status !== 'ACTIVE') throw new HttpError(400, 'Only active users can be enrolled');

    const existing = await prisma.enrollment.findUnique({
      where: { courseId_userId: { courseId, userId: targetId } },
    });
    if (existing && existing.status !== EnrollmentStatus.DROPPED) {
      throw new HttpError(409, 'User is already enrolled in this course');
    }

    const include = { course: { select: { id: true, code: true, title: true } } };
    const enrollment = existing
      ? await prisma.enrollment.update({
          where: { id: existing.id },
          data: { status: EnrollmentStatus.ENROLLED, progressPercent: 0, finalGrade: null, completedAt: null },
          include,
        })
      : await prisma.enrollment.create({
          data: { tenantId, courseId, userId: targetId, status: EnrollmentStatus.ENROLLED, progressPercent: 0 },
          include,
        });

    await logAuditEvent({
      tenantId,
      userId: user.id,
      action: 'USER_ENROLLED',
      resourceType: 'ENROLLMENT',
      resourceId: enrollment.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: { courseId, enrolledUserId: targetId, reenrolled: !!existing },
    });

    return res.status(201).json({ data: enrollment });
  })
);

/**
 * PATCH /api/v1/enrollments/:id/progress
 *  - the learner: may report their own progress, never backwards and never to 100%
 *  - the course's staff / admins: may set progress and the final grade; reaching 100% completes
 *    (or fails, against the course's passing grade) the enrollment and issues the certificate
 */
router.patch(
  '/:id/progress',
  authenticateJWT,
  route('Failed to update enrollment progress', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const user = req.user!;
    const id = String(req.params.id);
    const { progressPercent, finalGrade } = parseBody(req, updateProgressSchema);

    const enrollment = await prisma.enrollment.findFirst({
      where: { id, tenantId },
      include: { course: { select: { passingGradePercent: true, instructors: { select: { userId: true } } } } },
    });

    const isOwner = !!enrollment && enrollment.userId === user.id;
    // Staff powers apply to other people's enrollments only; nobody grades their own.
    const staff = !!enrollment && !isOwner && isCourseStaff(user, enrollment.course.instructors.map((i) => i.userId));
    if (!enrollment || (!isOwner && !staff)) throw new HttpError(404, 'Enrollment record not found');

    if (enrollment.status === EnrollmentStatus.DROPPED) {
      throw new HttpError(409, 'This enrollment was dropped and cannot be updated');
    }

    if (!staff) {
      if (finalGrade !== undefined) throw new HttpError(403, 'Forbidden: only course staff can record a final grade');
      if (progressPercent > LEARNER_MAX_PROGRESS) {
        throw new HttpError(403, 'Forbidden: course completion is recorded by your instructor');
      }
      if (progressPercent < enrollment.progressPercent) {
        throw new HttpError(400, 'Progress cannot go backwards');
      }
    }

    const grade = finalGrade ?? enrollment.finalGrade;
    let status = enrollment.status;
    let completedAt = enrollment.completedAt;

    if (progressPercent >= 100) {
      const failed = grade !== null && grade < enrollment.course.passingGradePercent;
      status = failed ? EnrollmentStatus.FAILED : EnrollmentStatus.COMPLETED;
      completedAt = completedAt ?? new Date();
    } else if (status === EnrollmentStatus.COMPLETED || status === EnrollmentStatus.FAILED) {
      status = EnrollmentStatus.IN_PROGRESS; // staff reopened it
      completedAt = null;
    } else if (progressPercent > 0 && status === EnrollmentStatus.ENROLLED) {
      status = EnrollmentStatus.IN_PROGRESS;
    }

    const updated = await prisma.enrollment.update({
      where: { id },
      data: { progressPercent, finalGrade: grade, status, completedAt },
      include: { course: { select: { id: true, code: true, title: true } } },
    });

    let certificate = null;
    if (updated.status === EnrollmentStatus.COMPLETED) {
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } });
      certificate = await issueCertificate(updated.id, tenant?.slug ?? tenantId);
    }

    await logAuditEvent({
      tenantId,
      userId: user.id,
      action: 'ENROLLMENT_PROGRESS_UPDATED',
      resourceType: 'ENROLLMENT',
      resourceId: id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: {
        previousProgress: enrollment.progressPercent,
        newProgress: progressPercent,
        previousStatus: enrollment.status,
        status,
        finalGrade: grade,
        byStaff: staff,
      },
    });

    return res.status(200).json({ data: { ...updated, certificate } });
  })
);

export default router;
