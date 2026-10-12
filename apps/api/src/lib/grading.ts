export type QuestionType =
  | 'MULTIPLE_CHOICE'
  | 'MULTI_SELECT'
  | 'TRUE_FALSE'
  | 'SHORT_ANSWER'
  | 'ESSAY'
  | 'CODE_SANDBOX'
  | 'FORMULA_CALCULATED';

/** Question types that a person must mark. */
export const MANUAL_TYPES: readonly QuestionType[] = ['ESSAY', 'CODE_SANDBOX'];

export type Answer = string | string[] | undefined | null;

export interface GradableQuestion {
  id: string;
  questionType: QuestionType;
  points: number;
  optionsJson: unknown;
  correctAnswer: string | null;
}

export interface QuestionResult {
  awardedPoints: number;
  maxPoints: number;
  /** null while a manual question is waiting for a grader. */
  isCorrect: boolean | null;
  needsManualGrading: boolean;
}

export interface QuizGrade {
  results: Record<string, QuestionResult>;
  score: number;
  maxScore: number;
  pendingManual: string[];
}

interface Option {
  id?: unknown;
  text?: unknown;
  isCorrect?: unknown;
}

const norm = (v: unknown): string => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

function optionsOf(raw: unknown): Option[] {
  return Array.isArray(raw) ? raw.filter((o): o is Option => !!o && typeof o === 'object') : [];
}

/** Index of the option an answer refers to, matched by id first and then by text. */
function matchOption(options: Option[], answer: string): number {
  const a = norm(answer);
  if (!a) return -1;
  const byId = options.findIndex((o) => o.id !== undefined && norm(o.id) === a);
  if (byId >= 0) return byId;
  return options.findIndex((o) => o.text !== undefined && norm(o.text) === a);
}

const asList = (answer: Answer): string[] =>
  Array.isArray(answer) ? answer.map(String) : answer === undefined || answer === null ? [] : [String(answer)];

function isBlank(answer: Answer): boolean {
  return asList(answer).every((a) => !a.trim());
}

function gradeChoice(q: GradableQuestion, answer: Answer): boolean {
  const options = optionsOf(q.optionsJson);
  const given = asList(answer).filter((a) => a.trim());
  if (given.length !== 1) return false;

  const correct = options.map((o, i) => (o.isCorrect === true ? i : -1)).filter((i) => i >= 0);
  if (correct.length > 0) return correct.includes(matchOption(options, given[0]));

  return !!q.correctAnswer && norm(given[0]) === norm(q.correctAnswer);
}

function gradeMultiSelect(q: GradableQuestion, answer: Answer): boolean {
  const options = optionsOf(q.optionsJson);
  const given = asList(answer).filter((a) => a.trim());
  if (given.length === 0) return false;

  const correct = options.map((o, i) => (o.isCorrect === true ? i : -1)).filter((i) => i >= 0);
  if (correct.length > 0) {
    const picked = given.map((a) => matchOption(options, a));
    if (picked.some((i) => i < 0)) return false;
    const pickedSet = new Set(picked);
    return pickedSet.size === correct.length && correct.every((i) => pickedSet.has(i));
  }

  if (q.correctAnswer) {
    const expected = new Set(q.correctAnswer.split(',').map(norm).filter(Boolean));
    const got = new Set(given.map(norm));
    return expected.size === got.size && [...expected].every((e) => got.has(e));
  }
  return false;
}

function gradeShortAnswer(q: GradableQuestion, answer: Answer): boolean {
  const given = norm(asList(answer)[0]);
  if (!given || !q.correctAnswer) return false;
  // Alternative accepted answers are separated by "||".
  return q.correctAnswer.split('||').some((alt) => norm(alt) === given);
}

function gradeFormula(q: GradableQuestion, answer: Answer): boolean {
  const given = asList(answer)[0]?.trim();
  if (!given || !q.correctAnswer) return false;
  const a = Number(given);
  const e = Number(q.correctAnswer);
  if (Number.isFinite(a) && Number.isFinite(e)) {
    return Math.abs(a - e) <= Math.max(1e-6, Math.abs(e) * 1e-6);
  }
  return norm(given) === norm(q.correctAnswer);
}

export function gradeQuestion(q: GradableQuestion, answer: Answer): QuestionResult {
  const maxPoints = q.points > 0 ? q.points : 1;

  if (MANUAL_TYPES.includes(q.questionType)) {
    const blank = isBlank(answer);
    return {
      awardedPoints: 0,
      maxPoints,
      isCorrect: blank ? false : null,
      needsManualGrading: !blank,
    };
  }

  let correct: boolean;
  switch (q.questionType) {
    case 'MULTIPLE_CHOICE':
    case 'TRUE_FALSE':
      correct = gradeChoice(q, answer);
      break;
    case 'MULTI_SELECT':
      correct = gradeMultiSelect(q, answer);
      break;
    case 'SHORT_ANSWER':
      correct = gradeShortAnswer(q, answer);
      break;
    case 'FORMULA_CALCULATED':
      correct = gradeFormula(q, answer);
      break;
    default:
      correct = false;
  }

  return { awardedPoints: correct ? maxPoints : 0, maxPoints, isCorrect: correct, needsManualGrading: false };
}

export function gradeQuiz(questions: GradableQuestion[], answers: Record<string, Answer>): QuizGrade {
  const results: Record<string, QuestionResult> = {};
  const pendingManual: string[] = [];
  let score = 0;
  let maxScore = 0;

  for (const q of questions) {
    const r = gradeQuestion(q, answers[q.id]);
    results[q.id] = r;
    score += r.awardedPoints;
    maxScore += r.maxPoints;
    if (r.needsManualGrading) pendingManual.push(q.id);
  }
  return { results, score, maxScore, pendingManual };
}

/** Accepts the answer map the API documents, or the [{ questionId, answer }] list the web client sends. */
export function normalizeAnswers(
  input: Record<string, Answer> | { questionId: string; answer: Answer }[]
): Record<string, Answer> {
  if (!Array.isArray(input)) return input;
  const out: Record<string, Answer> = {};
  for (const item of input) out[item.questionId] = item.answer;
  return out;
}

/** Whether a graded quiz passes. A quiz with ungraded manual questions has no verdict yet. */
export function hasPassed(score: number, maxScore: number, passingPercent: number, pendingManual: number): boolean {
  if (pendingManual > 0 || maxScore <= 0) return false;
  return (score / maxScore) * 100 >= passingPercent;
}
