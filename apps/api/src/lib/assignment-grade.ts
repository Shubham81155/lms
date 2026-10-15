import { Request } from 'express';
import { prisma } from './prisma';
import { logAuditEvent } from './audit';
import { notify } from './notify';
import { HttpError } from './http';
import { Criterion, RubricError, scoreFromCriteria } from './rubric';

export interface GradeInput {
  /** Plain points, for assignments without a rubric. */
  grade?: number;
  /** Points per criterion, for assignments with a rubric. */
  criteria?: Record<string, number>;
}

interface AssignmentLike {
  id: string;
  title: string;
  courseId: string;
  maxPoints: number;
  rubricJson: unknown;
}

export const rubricOf = (a: { rubricJson: unknown }): Criterion[] | null =>
  Array.isArray(a.rubricJson) && a.rubricJson.length > 0 ? (a.rubricJson as Criterion[]) : null;

/**
 * Validates a grade for this assignment and returns what to store. With a rubric the grade is the
 * sum of criterion scores and a bare number is refused (and the reverse), so the two can never
 * disagree. Pure apart from throwing HttpError(400).
 */
export function resolveGradeInput(assignment: AssignmentLike, input: GradeInput) {
  const rubric = rubricOf(assignment);
  if (rubric) {
    if (!input.criteria || input.grade !== undefined) throw new HttpError(400, 'This assignment uses a rubric: score each criterion instead of giving a total');
    try {
      const r = scoreFromCriteria(rubric, input.criteria);
      return { grade: r.total, rubricScores: r.scores };
    } catch (e) {
      if (e instanceof RubricError) throw new HttpError(400, e.message);
      throw e;
    }
  }
  if (input.criteria || input.grade === undefined) throw new HttpError(400, 'Provide a grade');
  if (input.grade > assignment.maxPoints) throw new HttpError(400, `Grade (${input.grade}) cannot exceed max points (${assignment.maxPoints})`);
  return { grade: input.grade, rubricScores: null as Record<string, number> | null };
}

/**
 * Stores a validated grade, tells the learner, audits it, and, if this changes a grade that was
 * already graded and the learner's course grade had been APPROVED, sends that one course grade
 * back to DRAFT so the approved figure cannot silently go stale.
 */
export async function commitGrade(opts: {
  req: Request;
  tenantId: string;
  assignment: AssignmentLike;
  submission: { id: string; userId: string; grade: number | null; gradedAt: Date | null };
  resolved: { grade: number; rubricScores: Record<string, number> | null };
  feedback?: string | null;
  action?: string;
  note?: string;
}) {
  const { req, tenantId, assignment, submission, resolved } = opts;
  const updated = await prisma.assignmentSubmission.update({
    where: { id: submission.id },
    data: { grade: resolved.grade, rubricScoresJson: (resolved.rubricScores as any) ?? undefined, feedback: opts.feedback || null, gradedAt: new Date() },
  });

  let courseGradeReopened = false;
  if (submission.gradedAt) {
    const r = await prisma.courseGrade.updateMany({
      where: { courseId: assignment.courseId, userId: submission.userId, status: 'APPROVED' },
      data: { status: 'DRAFT', approvedById: null, approvedAt: null, submittedById: null },
    });
    courseGradeReopened = r.count > 0;
  }

  await notify({
    tenantId,
    userId: submission.userId,
    category: 'GRADE',
    title: `Your assignment "${assignment.title}" has been graded`,
    body: opts.note ?? `Grade: ${resolved.grade} / ${assignment.maxPoints}`,
    link: `/assignments/${assignment.id}`,
  });
  await logAuditEvent({
    tenantId,
    userId: req.user!.id,
    action: opts.action ?? 'GRADE_MODIFIED',
    resourceType: 'GRADE',
    resourceId: submission.id,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    diffJson: { assignmentId: assignment.id, previousGrade: submission.grade, newGrade: resolved.grade, courseGradeReopened },
  });
  return { updated, courseGradeReopened };
}
