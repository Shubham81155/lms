import { prisma } from './prisma';

/** A submission with this many HIGH events (or this weighted total) is flagged for review. */
const FLAG_HIGH_COUNT = 3;
const WEIGHT = { LOW: 1, MEDIUM: 3, HIGH: 5 } as const;
const FLAG_SCORE = 12;
const INACTIVE_DAYS = 7;

/** Risk score and flag for a set of proctoring events. */
export function assessProctoring(events: { severity: string }[]) {
  const high = events.filter((e) => e.severity === 'HIGH').length;
  const score = events.reduce((sum, e) => sum + (WEIGHT[e.severity as keyof typeof WEIGHT] ?? 0), 0);
  return { high, score, flagged: high >= FLAG_HIGH_COUNT || score >= FLAG_SCORE };
}

export interface RiskInput {
  progressPercent: number;
  failedQuizzes: number;
  avgQuizPercent: number | null;
  daysInactive: number | null;
  proctoringFlags: number;
  plagiarismMax: number | null;
}

/** Pure scoring so it can be tested without a database. */
export function scoreRisk(i: RiskInput): { level: 'LOW' | 'MEDIUM' | 'HIGH'; score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  if (i.daysInactive === null || i.daysInactive >= INACTIVE_DAYS) {
    score += 2;
    reasons.push(i.daysInactive === null ? 'No recorded activity' : `Inactive for ${i.daysInactive} days`);
  }
  if (i.avgQuizPercent !== null && i.avgQuizPercent < 60) {
    score += 3;
    reasons.push(`Average quiz score ${Math.round(i.avgQuizPercent)}%`);
  }
  if (i.failedQuizzes >= 2) {
    score += 2;
    reasons.push(`${i.failedQuizzes} failed quiz attempts`);
  }
  if (i.proctoringFlags > 0) {
    score += 3;
    reasons.push(`${i.proctoringFlags} proctoring-flagged attempt(s)`);
  }
  if (i.plagiarismMax !== null && i.plagiarismMax >= 30) {
    score += 3;
    reasons.push(`Plagiarism match ${Math.round(i.plagiarismMax)}%`);
  }
  if (i.progressPercent < 25 && score > 0) {
    score += 1;
    reasons.push(`Progress only ${Math.round(i.progressPercent)}%`);
  }
  return { level: score >= 5 ? 'HIGH' : score >= 2 ? 'MEDIUM' : 'LOW', score, reasons };
}

/**
 * Learners at MEDIUM or HIGH risk (minors without a guardian's consent are left out: DPDP Act s.9(3)) across `courseIds`, highest first. Runs inside the tenant context.
 */
export async function computeAtRisk(tenantId: string, courseIds: string[]) {
  if (courseIds.length === 0) return [];
  const enrollments = await prisma.enrollment.findMany({
    where: { tenantId, courseId: { in: courseIds }, status: { in: ['ENROLLED', 'IN_PROGRESS'] }, user: { NOT: { isMinor: true, guardianConsentAt: null } } },
    select: {
      userId: true,
      courseId: true,
      progressPercent: true,
      course: { select: { code: true } },
      user: { select: { id: true, firstName: true, lastName: true, email: true, lastLoginAt: true } },
    },
  });
  const userIds = [...new Set(enrollments.map((e) => e.userId))];

  const [subs, assignments, lastXapi] = await Promise.all([
    prisma.quizSubmission.findMany({
      where: { userId: { in: userIds }, quiz: { courseId: { in: courseIds } }, submittedAt: { not: null } },
      select: { userId: true, score: true, maxScore: true, passed: true, quiz: { select: { courseId: true } }, proctoringLogs: { select: { severity: true } } },
    }),
    prisma.assignmentSubmission.findMany({
      where: { userId: { in: userIds }, assignment: { courseId: { in: courseIds } }, plagiarismScore: { not: null } },
      select: { userId: true, plagiarismScore: true, assignment: { select: { courseId: true } } },
    }),
    prisma.xapiStatement.groupBy({ by: ['actorUserId'], where: { tenantId, actorUserId: { in: userIds } }, _max: { timestamp: true } }),
  ]);

  const activity = new Map(lastXapi.map((r) => [r.actorUserId, r._max.timestamp]));
  const now = Date.now();

  return enrollments
    .map((e) => {
      const mine = subs.filter((s) => s.userId === e.userId && s.quiz.courseId === e.courseId);
      const pct = mine.filter((s) => s.score !== null && s.maxScore > 0).map((s) => ((s.score as number) / s.maxScore) * 100);
      const lastSeen = [activity.get(e.userId) ?? null, e.user.lastLoginAt]
        .filter((d): d is Date => !!d)
        .sort((a, b) => b.getTime() - a.getTime())[0];
      const plagiarism = assignments.filter((a) => a.userId === e.userId && a.assignment.courseId === e.courseId);
      const risk = scoreRisk({
        progressPercent: e.progressPercent,
        failedQuizzes: mine.filter((s) => !s.passed).length,
        avgQuizPercent: pct.length ? pct.reduce((a, b) => a + b, 0) / pct.length : null,
        daysInactive: lastSeen ? Math.floor((now - lastSeen.getTime()) / 86_400_000) : null,
        proctoringFlags: mine.filter((s) => assessProctoring(s.proctoringLogs).flagged).length,
        plagiarismMax: plagiarism.length ? Math.max(...plagiarism.map((a) => a.plagiarismScore ?? 0)) : null,
      });
      return {
        id: e.user.id,
        name: `${e.user.firstName} ${e.user.lastName}`,
        email: e.user.email,
        courseId: e.courseId,
        course: e.course.code,
        progressPercent: e.progressPercent,
        riskFactor: risk.level,
        riskScore: risk.score,
        reasons: risk.reasons,
        suggestedAction: risk.level === 'HIGH' ? 'Schedule a 1-on-1 check-in' : 'Send a nudge with a practice drill',
      };
    })
    .filter((l) => l.riskFactor !== 'LOW')
    .sort((a, b) => b.riskScore - a.riskScore);
}
