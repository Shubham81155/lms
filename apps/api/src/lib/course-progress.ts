import { EnrollmentStatus } from '@enterprise-lms/database';
import { prisma } from './prisma';
import { progressFromLessons } from './lesson-progress';

/**
 * Re-derives progress after a course's lessons are added or removed. Only live enrollments of learners
 * who track progress by lesson (they have at least one finished lesson) are touched: a percentage an
 * instructor set by hand, or a finished or failed result, is left alone.
 */
export async function recomputeCourseProgress(courseId: string): Promise<void> {
  const [totalLessons, finished] = await Promise.all([
    prisma.lesson.count({ where: { module: { courseId } } }),
    prisma.lessonProgress.groupBy({ by: ['userId'], where: { courseId }, _count: { _all: true } }),
  ]);

  for (const row of finished) {
    await prisma.enrollment.updateMany({
      where: { courseId, userId: row.userId, status: { in: [EnrollmentStatus.ENROLLED, EnrollmentStatus.IN_PROGRESS] } },
      data: { progressPercent: progressFromLessons(row._count._all, totalLessons) },
    });
  }
}
