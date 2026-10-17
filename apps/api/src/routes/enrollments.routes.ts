import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { personalDue } from '../lib/deadlines';
import { logAuditEvent } from '../lib/audit';
import { authenticateJWT, tenantIdOf } from '../middleware/auth';
import { EnrollmentStatus } from '@enterprise-lms/database';
import { HttpError, route } from '../lib/http';
import { idSchema, pageMeta, paginationShape, parseBody, parseQuery } from '../lib/validate';
import { COURSE_STAFF_ROLES, isAdminRole, canSeeAllCourses } from '../lib/access';
import { issueCertificate } from '../lib/certificates';
import { config } from '../config';
import { notify } from '../lib/notify';
import { VERBS, recordStatement } from '../lib/xapi';
import { dispatchWebhook } from '../lib/webhooks';
import { LEARNER_MAX_PROGRESS, progressFromLessons } from '../lib/lesson-progress';

const router = Router();

export const enrollSchema = z
  .object({
    courseId: idSchema,
    userId: idSchema.optional(),
    /** Another way to name the person, for staff who do not know the account id. */
    email: z.string().trim().toLowerCase().email().max(254).optional(),
  })
  .refine((v) => !(v.userId && v.email), { message: 'Send either userId or email, not both' });

export const updateProgressSchema = z.object({
  progressPercent: z.number().min(0).max(100),
  finalGrade: z.number().min(0).max(100).optional(),
});

export const statsQuery = z.object({ userId: idSchema.optional() });

export const listQuery = z.object({
  ...paginationShape,
  userId: idSchema.optional(),
  courseId: idSchema.optional(),
  status: z.nativeEnum(EnrollmentStatus).optional(),
});

/** Highest progress a learner can report themselves; finishing a course is recorded by staff. */

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
 * GET /api/v1/enrollments/grades
 * The caller's own results, per course they are or were enrolled in: the course grade once it is approved,
 * every assignment (submitted or not) with its grade and feedback, and every quiz with the best attempt.
 */
router.get(
  '/grades',
  authenticateJWT,
  route('Failed to load your grades', async (req, res) => {
    const userId = req.user!.id;
    const tenantId = tenantIdOf(req);
    const enrollments = await prisma.enrollment.findMany({
      where: { tenantId, userId, status: { not: EnrollmentStatus.DROPPED } },
      orderBy: { enrolledAt: 'desc' },
      select: {
        status: true,
        progressPercent: true,
        finalGrade: true,
        course: { select: { id: true, code: true, title: true, passingGradePercent: true } },
      },
    });
    const courseIds = enrollments.map((e) => e.course.id);
    if (courseIds.length === 0) return res.json({ data: [] });

    const [grades, assignments, quizzes] = await Promise.all([
      prisma.courseGrade.findMany({ where: { tenantId, userId, courseId: { in: courseIds }, status: 'APPROVED' } }),
      prisma.assignment.findMany({
        where: { courseId: { in: courseIds } },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true, title: true, courseId: true, maxPoints: true, dueDate: true,
          submissions: { where: { userId }, select: { submittedAt: true, isLate: true, grade: true, feedback: true, gradedAt: true, appeal: { select: { status: true } } } },
        },
      }),
      prisma.quiz.findMany({
        where: { courseId: { in: courseIds }, questions: { some: {} } },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, title: true, courseId: true, maxAttempts: true, passingPercent: true,
          submissions: { where: { userId, submittedAt: { not: null } }, select: { score: true, maxScore: true, passed: true, submittedAt: true, answersJson: true } },
        },
      }),
    ]);
    const gradeOf = new Map(grades.map((g) => [g.courseId, g]));

    return res.json({
      data: enrollments.map((e) => {
        const g = gradeOf.get(e.course.id);
        return {
          course: e.course,
          status: e.status,
          progressPercent: e.progressPercent,
          courseGrade: g ? { letter: g.letter, percent: g.curvedPercent, approvedAt: g.approvedAt } : null,
          assignments: assignments
            .filter((a) => a.courseId === e.course.id)
            .map((a) => {
              const s = a.submissions[0];
              return {
                id: a.id,
                title: a.title,
                maxPoints: a.maxPoints,
                dueDate: a.dueDate,
                submittedAt: s?.submittedAt ?? null,
                late: !!s?.isLate,
                grade: s?.gradedAt ? s.grade : null,
                feedback: s?.gradedAt ? s.feedback : null,
                gradedAt: s?.gradedAt ?? null,
                appealStatus: s?.appeal?.status ?? null,
              };
            }),
          quizzes: quizzes
            .filter((q) => q.courseId === e.course.id)
            .map((q) => {
              const scored = q.submissions.filter((s) => s.score !== null && s.maxScore > 0);
              const best = scored.sort((x, y) => y.score! / y.maxScore - x.score! / x.maxScore)[0];
              return {
                id: q.id,
                title: q.title,
                attemptsUsed: q.submissions.length,
                maxAttempts: q.maxAttempts,
                passingPercent: q.passingPercent,
                bestPercent: best ? Math.round((best.score! / best.maxScore) * 1000) / 10 : null,
                passed: q.submissions.some((s) => s.passed),
                awaitingManualGrading: q.submissions.some((s) => ((s.answersJson as any)?.pendingManual ?? []).length > 0),
              };
            }),
        };
      }),
    });
  })
);

/**
 * GET /api/v1/enrollments/todo
 * The caller's own upcoming work from the courses they are actively enrolled in (published
 * courses only): assignments not yet submitted or still ungraded, and quizzes with attempts left
 * (or an attempt in progress). Dated assignments come first, soonest due first.
 */
router.get(
  '/todo',
  authenticateJWT,
  route('Failed to load your to-do list', async (req, res) => {
    const userId = req.user!.id;
    const tenantId = tenantIdOf(req);
    const enrollments = await prisma.enrollment.findMany({
      where: { tenantId, userId, status: { in: [EnrollmentStatus.ENROLLED, EnrollmentStatus.IN_PROGRESS] }, course: { status: 'PUBLISHED' } },
      select: { course: { select: { id: true, code: true, title: true } } },
    });
    const courses = new Map(enrollments.map((e) => [e.course.id, e.course]));
    const courseIds = [...courses.keys()];
    if (courseIds.length === 0) return res.json({ data: [] });

    const [assignments, quizzes] = await Promise.all([
      prisma.assignment.findMany({
        where: {
          courseId: { in: courseIds },
          OR: [{ submissions: { none: { userId } } }, { submissions: { some: { userId, gradedAt: null } } }],
        },
        select: { id: true, title: true, dueDate: true, courseId: true, submissions: { where: { userId }, select: { id: true } } },
      }),
      prisma.quiz.findMany({
        where: { courseId: { in: courseIds }, questions: { some: {} } },
        select: {
          id: true, title: true, courseId: true, timeLimitMins: true, maxAttempts: true, requireProctoring: true, availableFrom: true, dueAt: true,
          submissions: { where: { userId }, select: { submittedAt: true } },
        },
      }),
    ]);
    const extensions = await prisma.deadlineExtension.findMany({ where: { tenantId, userId }, select: { assignmentId: true, quizId: true, dueAt: true } });
    const extended = new Map(extensions.map((e) => [(e.assignmentId ?? e.quizId)!, e.dueAt]));

    const now = Date.now();
    const work = assignments.map((a) => ({
      type: 'ASSIGNMENT' as const,
      id: a.id,
      title: a.title,
      course: courses.get(a.courseId)!,
      dueAt: personalDue(a.dueDate, extended.get(a.id) ?? null),
      extended: extended.has(a.id),
      overdue: (() => {
        const due = personalDue(a.dueDate, extended.get(a.id) ?? null);
        return !!due && due.getTime() < now && a.submissions.length === 0;
      })(),
      submitted: a.submissions.length > 0,
    }));
    const tests = quizzes
      .map((q) => ({
        type: 'QUIZ' as const,
        id: q.id,
        title: q.title,
        course: courses.get(q.courseId)!,
        dueAt: personalDue(q.dueAt, extended.get(q.id) ?? null),
        extended: extended.has(q.id),
        /** Set while the quiz has not opened yet. */
        opensAt: q.availableFrom && q.availableFrom.getTime() > now ? q.availableFrom : null,
        timeLimitMins: q.timeLimitMins,
        requireProctoring: q.requireProctoring,
        attemptsRemaining: Math.max(0, q.maxAttempts - q.submissions.length),
        hasOpenAttempt: q.submissions.some((s) => s.submittedAt === null),
      }))
      // A quiz that has closed for this learner is no longer something to do, unless an attempt is still open.
      .filter((q) => q.hasOpenAttempt || (q.attemptsRemaining > 0 && !(q.dueAt && q.dueAt.getTime() < now)));

    const byDue = (a: { dueAt: Date | null; title: string }, b: { dueAt: Date | null; title: string }) =>
      (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity) || a.title.localeCompare(b.title);
    return res.json({ data: [...work.sort(byDue), ...tests.sort(byDue)].slice(0, 20) });
  })
);

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
        // A roster needs to say who each row is; a learner's own list does not.
        ...(rosterMode ? { user: { select: { id: true, firstName: true, lastName: true, email: true } } } : {}),
      },
    }),
  ]);

  if (rosterMode) return res.status(200).json({ data: enrollments, pagination: pageMeta(page, limit, total) });
  const lessons = await lessonsToContinue(user.id, enrollments.map((e) => e.courseId));
  return res.status(200).json({
    data: enrollments.map((e) => ({ ...e, ...lessons.get(e.courseId)! })),
    pagination: pageMeta(page, limit, total),
  });
});

/**
 * Per course: how many lessons the learner has finished, and the first one (in course order) they have
 * not, which is where "Continue" takes them. nextLesson is null when every lesson is done or there are none.
 */
async function lessonsToContinue(userId: string, courseIds: string[]) {
  const [modules, finished] = await Promise.all([
    prisma.module.findMany({
      where: { courseId: { in: courseIds } },
      orderBy: { orderIndex: 'asc' },
      select: { courseId: true, title: true, lessons: { orderBy: { orderIndex: 'asc' }, select: { id: true, title: true } } },
    }),
    prisma.lessonProgress.findMany({ where: { userId, courseId: { in: courseIds } }, select: { lessonId: true } }),
  ]);
  const done = new Set(finished.map((f) => f.lessonId));
  const out = new Map(
    courseIds.map((id) => [id, { lessons: { total: 0, completed: 0 }, nextLesson: null as { id: string; title: string; moduleTitle: string } | null }])
  );
  for (const m of modules) {
    const entry = out.get(m.courseId)!;
    for (const l of m.lessons) {
      entry.lessons.total++;
      if (done.has(l.id)) entry.lessons.completed++;
      else if (!entry.nextLesson) entry.nextLesson = { id: l.id, title: l.title, moduleTitle: m.title };
    }
  }
  return out;
}

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
    const { courseId, userId, email } = parseBody(req, enrollSchema);
    let targetId = userId ?? user.id;
    if (email) {
      const byEmail = await prisma.user.findFirst({ where: { tenantId, email }, select: { id: true } });
      if (!byEmail) throw new HttpError(404, 'No one in your organisation has that email address');
      targetId = byEmail.id;
    }
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
    const resumed = { progressPercent: existing?.progressPercent ?? 0 };
    if (existing) {
      const [finished, lessons] = await Promise.all([
        prisma.lessonProgress.count({ where: { courseId, userId: targetId } }),
        prisma.lesson.count({ where: { module: { courseId } } }),
      ]);
      if (finished > 0) resumed.progressPercent = progressFromLessons(finished, lessons);
    }
    const enrollment = existing
      ? await prisma.enrollment.update({
          where: { id: existing.id },
          // Coming back picks up where they left off: progress, finished lessons and any grade are kept.
          // Lessons may have been added or removed meanwhile, so progress is re-derived from what they finished.
          data: { status: resumed.progressPercent > 0 ? EnrollmentStatus.IN_PROGRESS : EnrollmentStatus.ENROLLED, progressPercent: resumed.progressPercent, completedAt: null },
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
 * DELETE /api/v1/enrollments/:id - withdraw from a course
 *  - the learner may leave their own course while it is in progress
 *  - administrators and the course's instructor may remove a learner
 * The record is kept (status DROPPED), progress included, so enrolling the person again later
 * picks up where they left off. A finished or failed enrollment is a record and cannot be withdrawn.
 */
router.delete(
  '/:id',
  authenticateJWT,
  route('Failed to withdraw enrollment', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const user = req.user!;
    const enrollment = await prisma.enrollment.findFirst({
      where: { id: String(req.params.id), tenantId },
      include: { course: { select: { code: true, instructors: { select: { userId: true } } } } },
    });

    const isOwner = !!enrollment && enrollment.userId === user.id;
    const mayRemove = !!enrollment && !isOwner && isCourseStaff(user, enrollment.course.instructors.map((i) => i.userId)) && user.role !== 'TEACHING_ASSISTANT';
    if (!enrollment || (!isOwner && !mayRemove)) throw new HttpError(404, 'Enrollment record not found');

    if (enrollment.status === EnrollmentStatus.DROPPED) throw new HttpError(409, 'This enrollment was already withdrawn');
    if (enrollment.status === EnrollmentStatus.COMPLETED || enrollment.status === EnrollmentStatus.FAILED) {
      throw new HttpError(409, 'A finished enrollment is kept as a record and cannot be withdrawn');
    }

    const updated = await prisma.enrollment.update({ where: { id: enrollment.id }, data: { status: EnrollmentStatus.DROPPED } });
    await logAuditEvent({
      tenantId,
      userId: user.id,
      action: 'USER_UNENROLLED',
      resourceType: 'ENROLLMENT',
      resourceId: enrollment.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: { courseId: enrollment.courseId, withdrawnUserId: enrollment.userId, byOwner: isOwner },
    });
    return res.status(200).json({ data: { id: updated.id, status: updated.status } });
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

      // Only on the transition into COMPLETED, so re-sending progress does not re-notify.
      if (enrollment.status !== EnrollmentStatus.COMPLETED) {
        const learner = await prisma.user.findFirst({ where: { id: updated.userId }, select: { id: true, email: true, firstName: true, lastName: true } });
        await Promise.all([
          notify({
            tenantId,
            userId: updated.userId,
            category: 'COURSE',
            title: `You completed ${updated.course.title}`,
            body: certificate ? `Certificate ${certificate.certificateNumber} is ready.` : undefined,
            link: `/courses/${updated.courseId}`,
          }),
          learner
            ? recordStatement({
                tenantId,
                user: learner,
                verb: VERBS.completed,
                object: { id: `${config.APP_URL}/xapi/courses/${updated.courseId}`, name: updated.course.title, type: 'http://adlnet.gov/expapi/activities/course' },
                result: { completion: true, ...(grade !== null ? { score: { raw: grade, min: 0, max: 100 } } : {}) },
              })
            : Promise.resolve(null),
        ]);
        // Not awaited: a slow receiver must not hold up the response.
        void dispatchWebhook(tenantId, 'enrollment.completed', { enrollmentId: updated.id, courseId: updated.courseId, userId: updated.userId, finalGrade: grade });
        if (certificate) void dispatchWebhook(tenantId, 'certificate.issued', { certificateNumber: certificate.certificateNumber, userId: updated.userId, courseId: updated.courseId });
      }
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
