import { prisma } from './prisma';
import { HttpError } from './http';

/**
 * Due dates as a particular learner sees them: a course-wide date, moved later by that learner's extension
 * when staff granted one. All rules about "open", "late" and "closed" live here so the quiz, assignment and
 * to-do routes agree.
 */

export const REVIEW_POLICIES = ['SCORE_ONLY', 'RESPONSES', 'ANSWERS'] as const;
export type ReviewPolicy = (typeof REVIEW_POLICIES)[number];

export async function extensionFor(userId: string, item: { quizId: string } | { assignmentId: string }): Promise<Date | null> {
  const row =
    'quizId' in item
      ? await prisma.deadlineExtension.findUnique({ where: { quizId_userId: { quizId: item.quizId, userId } }, select: { dueAt: true } })
      : await prisma.deadlineExtension.findUnique({
          where: { assignmentId_userId: { assignmentId: item.assignmentId, userId } },
          select: { dueAt: true },
        });
  return row?.dueAt ?? null;
}

/** The later of the course date and the learner's extension (an extension never shortens a deadline). */
export const personalDue = (due: Date | null, extension: Date | null): Date | null =>
  extension && (!due || extension > due) ? extension : due;

/** Throws when the quiz cannot be started now: before it opens, or after it closes for this learner. */
export function assertQuizOpen(quiz: { availableFrom: Date | null; dueAt: Date | null }, extension: Date | null, now = new Date()) {
  if (quiz.availableFrom && now < quiz.availableFrom) {
    throw new HttpError(403, `This quiz opens on ${quiz.availableFrom.toISOString()}`);
  }
  const closes = personalDue(quiz.dueAt, extension);
  if (closes && now > closes) throw new HttpError(403, 'This quiz has closed');
}

/**
 * For an assignment submission arriving now: whether it is late, and a 403 when late work is no longer
 * accepted. The cutoff moves with an extension too.
 */
export function assignmentSubmissionTiming(
  assignment: { dueDate: Date | null; acceptLateUntil: Date | null },
  extension: Date | null,
  now = new Date()
): { isLate: boolean; dueAt: Date | null } {
  const dueAt = personalDue(assignment.dueDate, extension);
  const cutoff = assignment.acceptLateUntil ? personalDue(assignment.acceptLateUntil, extension) : null;
  if (cutoff && now > cutoff) throw new HttpError(403, 'This assignment no longer accepts submissions');
  return { isLate: !!dueAt && now > dueAt, dueAt };
}

/**
 * Whether a learner may see the correct answers to a quiz: only with the ANSWERS policy, and only once they
 * cannot change their result any more (no attempts left, or the quiz has closed for them).
 */
export function answersRevealed(policy: string, attemptsLeft: number, closesAt: Date | null, now = new Date()): boolean {
  return policy === 'ANSWERS' && (attemptsLeft <= 0 || (!!closesAt && now > closesAt));
}
