import { randomUUID } from 'crypto';
import { QuestionType } from '@enterprise-lms/database';
import { HttpError } from './http';

export interface QuestionInput {
  questionType: QuestionType;
  optionsJson?: { id?: string; text: string; isCorrect: boolean }[] | null;
  correctAnswer?: string | null;
}

/** Rejects questions that could never be answered correctly or graded. */
export function validateQuestion(q: QuestionInput) {
  const options = q.optionsJson ?? [];
  const correct = options.filter((o) => o.isCorrect).length;
  const hasKey = !!q.correctAnswer?.trim();

  switch (q.questionType) {
    case 'MULTIPLE_CHOICE':
    case 'TRUE_FALSE':
      if (options.length > 0 ? options.length < 2 || correct !== 1 : !hasKey) {
        throw new HttpError(400, 'Choice questions need at least two options with exactly one correct, or a correctAnswer');
      }
      break;
    case 'MULTI_SELECT':
      if (options.length < 2 || correct < 1) {
        throw new HttpError(400, 'Multi-select questions need at least two options with at least one correct');
      }
      break;
    case 'SHORT_ANSWER':
    case 'FORMULA_CALCULATED':
      if (!hasKey) throw new HttpError(400, `${q.questionType} questions need a correctAnswer`);
      break;
    default:
      break; // ESSAY / CODE_SANDBOX are graded by a person
  }
}

export const withOptionIds = (options: { id?: string; text: string; isCorrect: boolean }[] | null | undefined) =>
  options ? options.map((o) => ({ ...o, id: o.id ?? randomUUID() })) : options;
