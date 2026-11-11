import { Request } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { tenantIdOf } from '../../middleware/auth';
import { HttpError } from '../../lib/http';
import { idSchema, paginationShape } from '../../lib/validate';
import { CourseAccess, canSeeAllCourses } from '../../lib/access';

/** Extra seconds allowed beyond a quiz's time limit, to absorb network latency. */
export const TIME_LIMIT_GRACE_SECONDS = 30;

export const submissionListQuery = z.object({ ...paginationShape, userId: idSchema.optional() });

export interface QuizQuestionOption {
  id?: string;
  text?: string;
  isCorrect?: boolean;
}

export interface StoredGradingEntry {
  awardedPoints: number;
  maxPoints: number;
  isCorrect: boolean | null;
  needsManualGrading: boolean;
  gradedBy?: string;
  gradedAt?: string;
}

export interface StoredQuizAnswers {
  submittedAnswers?: Record<string, unknown>;
  grading?: Record<string, StoredGradingEntry>;
  pendingManual?: string[];
}

export function parseQuestionOptions(raw: unknown): QuizQuestionOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((o) => (typeof o === 'object' && o !== null ? (o as QuizQuestionOption) : {}));
}

export function parseStoredAnswers(raw: unknown): StoredQuizAnswers {
  if (typeof raw !== 'object' || raw === null) return {};
  return raw as StoredQuizAnswers;
}

export async function loadQuiz(req: Request, quizId: string) {
  const quiz = await prisma.quiz.findFirst({
    where: { id: quizId, tenantId: tenantIdOf(req) },
    include: { questions: { orderBy: { orderIndex: 'asc' } } },
  });
  if (!quiz) throw new HttpError(404, 'Quiz not found');
  return quiz;
}

export async function loadAssignment(req: Request, assignmentId: string) {
  const assignment = await prisma.assignment.findFirst({ where: { id: assignmentId, tenantId: tenantIdOf(req) } });
  if (!assignment) throw new HttpError(404, 'Assignment not found');
  return assignment;
}

/** Learners (and anyone who is neither staff nor an auditor) must not see answer keys. */
export const seesAnswerKeys = (req: Request, access: CourseAccess) => access.isStaff || canSeeAllCourses(req.user!.role);

export function assertCanTake(access: CourseAccess) {
  if (access.isStaff || !access.isEnrolled || access.course.status !== 'PUBLISHED') {
    throw new HttpError(403, 'Forbidden: you must be an enrolled learner in a published course');
  }
}

export const shuffled = <T>(items: T[]): T[] => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};
