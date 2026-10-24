import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { route } from '../lib/http';
import { isAdminRole } from '../lib/access';
import { computeAtRisk } from '../lib/risk';
import { bloomsMastery } from '../lib/bloom';
import { authenticateJWT, requireRole, tenantIdOf } from '../middleware/auth';

const router = Router();

/**
 * GET /api/v1/analytics/cohort
 * Faculty analytics computed from live data: enrolment / completion metrics, assessment item
 * analysis and early-warning learners. Instructors and assistants see only the courses they are
 * assigned to; admins see the whole tenant.
 */
router.get(
  '/cohort',
  authenticateJWT,
  requireRole('INSTRUCTOR', 'TEACHING_ASSISTANT', 'TENANT_ADMIN', 'SUPER_ADMIN'),
  route('Failed to retrieve cohort analytics', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const user = req.user!;
    const courseWhere = isAdminRole(user.role) ? { tenantId } : { tenantId, instructors: { some: { userId: user.id } } };
    const courses = await prisma.course.findMany({ where: courseWhere, select: { id: true } });
    const courseIds = courses.map((c) => c.id);
    const inCourses = { tenantId, courseId: { in: courseIds } };

    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const [totalEnrollments, completed, enrollments, active, quizzes] = await Promise.all([
      prisma.enrollment.count({ where: inCourses }),
      prisma.enrollment.count({ where: { ...inCourses, status: 'COMPLETED' } }),
      prisma.enrollment.findMany({ where: inCourses, select: { progressPercent: true, finalGrade: true } }),
      prisma.xapiStatement.groupBy({ by: ['actorUserId'], where: { tenantId, timestamp: { gte: weekAgo }, actorUserId: { not: null } } }),
      prisma.quiz.findMany({
        where: { courseId: { in: courseIds } },
        select: {
          questions: { select: { id: true, questionText: true, questionType: true, bloomLevel: true } },
          submissions: { where: { submittedAt: { not: null } }, select: { answersJson: true } },
        },
      }),
    ]);

    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const grades = enrollments.filter((e) => e.finalGrade !== null).map((e) => e.finalGrade as number);

    // Item analysis: share of awarded points per question across all graded attempts.
    const itemAnalysis = quizzes
      .flatMap((q) =>
        q.questions.map((question) => {
          const results = q.submissions
            .map((s) => (s.answersJson as any)?.grading?.[question.id])
            .filter((r) => r && !r.needsManualGrading && r.maxPoints > 0);
          if (results.length === 0) return null;
          const pct =
            (results.reduce((a: number, r: any) => a + r.awardedPoints, 0) / results.reduce((a: number, r: any) => a + r.maxPoints, 0)) *
            100;
          return {
            questionId: question.id,
            concept: question.questionText.slice(0, 120),
            questionType: question.questionType,
            attempts: results.length,
            averageScorePercent: Math.round(pct),
            status: pct < 55 ? 'FLAGGED_HIGH_DIFFICULTY' : pct < 70 ? 'ATTENTION_NEEDED' : 'NORMAL',
            recommendation:
              pct < 55
                ? 'Review this topic in class; most learners missed it'
                : pct < 70
                  ? 'Consider reinforcing this concept'
                  : 'Strong cohort comprehension',
          };
        })
      )
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.averageScorePercent - b.averageScorePercent)
      .slice(0, 20);

    return res.json({
      tenantId,
      metrics: {
        totalEnrolled: totalEnrollments,
        activeThisWeek: active.length,
        averageProgress: parseFloat(avg(enrollments.map((e) => e.progressPercent)).toFixed(1)),
        completionRate: totalEnrollments > 0 ? Math.round((completed / totalEnrollments) * 100) : 0,
        averageGrade: parseFloat(avg(grades).toFixed(1)),
        // Kept for older clients; the LMS grades on a percentage scale, not a GPA.
        averageGpa: parseFloat(((avg(grades) / 100) * 4).toFixed(2)),
      },
      atRiskLearners: await computeAtRisk(tenantId, courseIds),
      itemAnalysis,
      bloomsMastery: bloomsMastery(quizzes),
    });
  })
);

/**
 * GET /api/v1/analytics/mastery
 * The caller's own Bloom's-taxonomy profile, from their graded answers to tagged quiz questions.
 */
router.get(
  '/mastery',
  authenticateJWT,
  route('Failed to load mastery', async (req, res) => {
    const userId = req.user!.id;
    const quizzes = await prisma.quiz.findMany({
      where: {
        tenantId: tenantIdOf(req),
        questions: { some: { bloomLevel: { not: null } } },
        submissions: { some: { userId, submittedAt: { not: null } } },
      },
      select: {
        questions: { select: { id: true, bloomLevel: true } },
        submissions: { where: { userId, submittedAt: { not: null } }, select: { answersJson: true } },
      },
    });
    return res.json({ data: bloomsMastery(quizzes) });
  })
);

export default router;
