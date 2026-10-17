import { EnrollmentStatus } from '@enterprise-lms/database';
import { prisma } from './prisma';
import { progressFromLessons } from './lesson-progress';
import { config } from '../config';
import { issueCertificate } from './certificates';
import { notify } from './notify';
import { VERBS, recordStatement } from './xapi';
import { dispatchWebhook } from './webhooks';

/**
 * Records a course result: COMPLETED (with a certificate) or FAILED against the course's passing grade.
 * The notification, xAPI statement and webhooks go out only on the transition into COMPLETED, so recording
 * the same result again does not repeat them. Used by staff (PATCH /enrollments/:id/progress) and by
 * automatic completion below.
 */
export async function recordCourseResult(enrollmentId: string, finalGrade: number | null, progressPercent = 100) {
  const enrollment = await prisma.enrollment.findUniqueOrThrow({
    where: { id: enrollmentId },
    include: { course: { select: { passingGradePercent: true } } },
  });
  const failed = finalGrade !== null && finalGrade < enrollment.course.passingGradePercent;
  const updated = await prisma.enrollment.update({
    where: { id: enrollmentId },
    data: {
      progressPercent,
      finalGrade,
      status: failed ? EnrollmentStatus.FAILED : EnrollmentStatus.COMPLETED,
      completedAt: enrollment.completedAt ?? new Date(),
    },
    include: { course: { select: { id: true, code: true, title: true } } },
  });

  let certificate = null;
  if (updated.status === EnrollmentStatus.COMPLETED) {
    const tenantId = updated.tenantId;
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } });
    certificate = await issueCertificate(updated.id, tenant?.slug ?? tenantId);

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
              result: { completion: true, ...(finalGrade !== null ? { score: { raw: finalGrade, min: 0, max: 100 } } : {}) },
            })
          : Promise.resolve(null),
      ]);
      // Not awaited: a slow receiver must not hold up the response.
      void dispatchWebhook(tenantId, 'enrollment.completed', { enrollmentId: updated.id, courseId: updated.courseId, userId: updated.userId, finalGrade });
      if (certificate) void dispatchWebhook(tenantId, 'certificate.issued', { certificateNumber: certificate.certificateNumber, userId: updated.userId, courseId: updated.courseId });
    }
  }
  return { enrollment: updated, certificate };
}

export type CompletionState =
  /** Not every lesson is finished yet. */
  | 'LESSONS_REMAINING'
  /** Every lesson is finished; the course uses a gradebook and the learner's grade is not approved yet. */
  | 'AWAITING_GRADE'
  /** Every lesson is finished but the approved grade is below the pass mark: staff decide what happens. */
  | 'BELOW_PASS_MARK'
  /** The course has no lessons, so completion stays with staff. */
  | 'MANUAL'
  | 'COMPLETED'
  | 'FAILED'
  /** Dropped, or not enrolled. */
  | 'NOT_ENROLLED';

/**
 * Completes a live enrollment once the learner has finished every lesson and, when the course uses a
 * gradebook (it has grade categories), once their course grade is approved and passing. A course without a
 * gradebook completes on the last lesson. This only ever completes: a failing grade, or a course with no
 * lessons, is left to staff, and results already recorded are never changed here.
 */
export async function autoComplete(courseId: string, userId: string): Promise<CompletionState> {
  const enrollment = await prisma.enrollment.findUnique({ where: { courseId_userId: { courseId, userId } } });
  if (!enrollment || enrollment.status === EnrollmentStatus.DROPPED) return 'NOT_ENROLLED';
  if (enrollment.status === EnrollmentStatus.COMPLETED) return 'COMPLETED';
  if (enrollment.status === EnrollmentStatus.FAILED) return 'FAILED';

  const [totalLessons, finished, categories, grade] = await Promise.all([
    prisma.lesson.count({ where: { module: { courseId } } }),
    prisma.lessonProgress.count({ where: { courseId, userId, lesson: { module: { courseId } } } }),
    prisma.gradeCategory.count({ where: { courseId } }),
    prisma.courseGrade.findUnique({ where: { courseId_userId: { courseId, userId } }, select: { status: true, curvedPercent: true } }),
  ]);
  if (totalLessons === 0) return 'MANUAL';
  if (finished < totalLessons) return 'LESSONS_REMAINING';

  let finalGrade = enrollment.finalGrade;
  if (categories > 0) {
    if (grade?.status !== 'APPROVED') return 'AWAITING_GRADE';
    finalGrade = grade.curvedPercent;
  }
  const course = await prisma.course.findUniqueOrThrow({ where: { id: courseId }, select: { passingGradePercent: true } });
  if (finalGrade !== null && finalGrade < course.passingGradePercent) return 'BELOW_PASS_MARK';
  await recordCourseResult(enrollment.id, finalGrade);
  return 'COMPLETED';
}

/**
 * Records lessons as finished for an enrolled learner (idempotent), recomputes their progress, and lets the
 * course complete (autoComplete). Used by "Mark as complete" and by SCORM packages reporting completion.
 * A finished or failed enrollment keeps the result staff recorded; only live enrollments are recomputed.
 */
export async function recordLessonsDone(tenantId: string, courseId: string, userId: string, lessonIds: string[]) {
  const enrollment = await prisma.enrollment.findUnique({ where: { courseId_userId: { courseId, userId } } });
  if (!enrollment || enrollment.status === EnrollmentStatus.DROPPED) throw new Error('recordLessonsDone needs an enrolled learner');
  for (const lessonId of lessonIds) {
    await prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId, lessonId } },
      update: {},
      create: { tenantId, courseId, userId, lessonId },
    });
  }
  const [totalLessons, completedLessons] = await Promise.all([
    prisma.lesson.count({ where: { module: { courseId } } }),
    prisma.lessonProgress.count({ where: { courseId, userId } }),
  ]);
  const progressPercent = progressFromLessons(completedLessons, totalLessons);
  const live = enrollment.status === EnrollmentStatus.ENROLLED || enrollment.status === EnrollmentStatus.IN_PROGRESS;
  if (live) {
    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { progressPercent, status: progressPercent > 0 ? EnrollmentStatus.IN_PROGRESS : enrollment.status },
    });
  }
  const completion = await autoComplete(courseId, userId);
  return { completedLessons, totalLessons, progressPercent: live ? progressPercent : enrollment.progressPercent, completion };
}
