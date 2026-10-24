import { describe, it, expect } from 'vitest';
import { GradableQuestion, gradeQuestion, gradeQuiz, hasPassed, normalizeAnswers } from '../src/lib/grading';

const opts = (...spec: [string, string, boolean][]) => spec.map(([id, text, isCorrect]) => ({ id, text, isCorrect }));

const q = (over: Partial<GradableQuestion> & Pick<GradableQuestion, 'questionType'>): GradableQuestion => ({
  id: 'q1',
  points: 2,
  optionsJson: null,
  correctAnswer: null,
  ...over,
});

describe('single-choice questions', () => {
  const mc = q({
    questionType: 'MULTIPLE_CHOICE',
    optionsJson: opts(['a', 'Paris', true], ['b', 'Rome', false], ['c', 'Oslo', false]),
  });

  it('accepts the correct option by id or by text, ignoring case and spacing', () => {
    expect(gradeQuestion(mc, 'a').isCorrect).toBe(true);
    expect(gradeQuestion(mc, '  PARIS ').isCorrect).toBe(true);
  });

  it('rejects wrong, blank and missing answers', () => {
    expect(gradeQuestion(mc, 'b').isCorrect).toBe(false);
    expect(gradeQuestion(mc, '').isCorrect).toBe(false);
    expect(gradeQuestion(mc, undefined).isCorrect).toBe(false);
    expect(gradeQuestion(mc, 'nonsense').awardedPoints).toBe(0);
  });

  it('does not let a student game it by selecting every option', () => {
    expect(gradeQuestion(mc, ['a', 'b', 'c']).isCorrect).toBe(false);
  });

  it('awards the question’s points', () => {
    expect(gradeQuestion(mc, 'a')).toMatchObject({ awardedPoints: 2, maxPoints: 2, needsManualGrading: false });
  });

  it('falls back to correctAnswer when there are no options (true/false)', () => {
    const tf = q({ questionType: 'TRUE_FALSE', correctAnswer: 'true' });
    expect(gradeQuestion(tf, 'True').isCorrect).toBe(true);
    expect(gradeQuestion(tf, 'false').isCorrect).toBe(false);
  });
});

describe('multi-select questions', () => {
  const ms = q({
    questionType: 'MULTI_SELECT',
    optionsJson: opts(['a', 'A', true], ['b', 'B', false], ['c', 'C', true]),
  });

  it('is correct only for exactly the right set, in any order', () => {
    expect(gradeQuestion(ms, ['a', 'c']).isCorrect).toBe(true);
    expect(gradeQuestion(ms, ['C', 'A']).isCorrect).toBe(true);
  });

  it('is wrong for a subset, a superset, or an unknown option', () => {
    expect(gradeQuestion(ms, ['a']).isCorrect).toBe(false);
    expect(gradeQuestion(ms, ['a', 'b', 'c']).isCorrect).toBe(false);
    expect(gradeQuestion(ms, ['a', 'zzz']).isCorrect).toBe(false);
    expect(gradeQuestion(ms, []).isCorrect).toBe(false);
  });

  it('ignores duplicates', () => {
    expect(gradeQuestion(ms, ['a', 'a', 'c']).isCorrect).toBe(true);
  });

  it('supports a comma separated answer key without options', () => {
    const keyed = q({ questionType: 'MULTI_SELECT', correctAnswer: 'x, y' });
    expect(gradeQuestion(keyed, ['y', 'x']).isCorrect).toBe(true);
    expect(gradeQuestion(keyed, ['x']).isCorrect).toBe(false);
  });
});

describe('text and numeric questions', () => {
  it('short answers compare case-insensitively and accept alternatives', () => {
    const sa = q({ questionType: 'SHORT_ANSWER', correctAnswer: 'Raft||Paxos' });
    expect(gradeQuestion(sa, ' raft ').isCorrect).toBe(true);
    expect(gradeQuestion(sa, 'PAXOS').isCorrect).toBe(true);
    expect(gradeQuestion(sa, 'zab').isCorrect).toBe(false);
  });

  it('formula answers compare numerically within a tolerance', () => {
    const f = q({ questionType: 'FORMULA_CALCULATED', correctAnswer: '3.14159' });
    expect(gradeQuestion(f, '3.14159').isCorrect).toBe(true);
    expect(gradeQuestion(f, '3.141590000001').isCorrect).toBe(true);
    expect(gradeQuestion(f, '3.15').isCorrect).toBe(false);
    expect(gradeQuestion(f, 'abc').isCorrect).toBe(false);
  });
});

describe('manually graded questions', () => {
  it('are left pending rather than scored zero', () => {
    const essay = q({ questionType: 'ESSAY', points: 5 });
    expect(gradeQuestion(essay, 'My answer')).toEqual({
      awardedPoints: 0,
      maxPoints: 5,
      isCorrect: null,
      needsManualGrading: true,
    });
  });

  it('are not queued for a grader when left blank', () => {
    expect(gradeQuestion(q({ questionType: 'CODE_SANDBOX' }), '   ')).toMatchObject({
      isCorrect: false,
      needsManualGrading: false,
    });
  });
});

describe('gradeQuiz', () => {
  const questions: GradableQuestion[] = [
    { id: 'm', questionType: 'MULTIPLE_CHOICE', points: 1, optionsJson: opts(['a', 'A', true], ['b', 'B', false]), correctAnswer: null },
    { id: 's', questionType: 'SHORT_ANSWER', points: 2, optionsJson: null, correctAnswer: 'yes' },
    { id: 'e', questionType: 'ESSAY', points: 3, optionsJson: null, correctAnswer: null },
  ];

  it('totals auto-graded points and reports the questions awaiting a grader', () => {
    const g = gradeQuiz(questions, { m: 'a', s: 'no', e: 'text' });
    expect(g.score).toBe(1);
    expect(g.maxScore).toBe(6);
    expect(g.pendingManual).toEqual(['e']);
  });

  it('ignores answers for questions that are not in the quiz', () => {
    const g = gradeQuiz(questions, { m: 'a', s: 'yes', ghost: 'x' });
    expect(g.score).toBe(3);
    expect(Object.keys(g.results)).toEqual(['m', 's', 'e']);
  });

  it('treats a non-positive point value as 1 so a quiz cannot score 0 of 0', () => {
    expect(gradeQuestion(q({ questionType: 'SHORT_ANSWER', points: 0, correctAnswer: 'x' }), 'x').awardedPoints).toBe(1);
  });
});

describe('hasPassed', () => {
  it('compares the percentage with the pass mark', () => {
    expect(hasPassed(7, 10, 70, 0)).toBe(true);
    expect(hasPassed(6, 10, 70, 0)).toBe(false);
  });

  it('gives no pass while manual grading is outstanding, or for an empty quiz', () => {
    expect(hasPassed(10, 10, 50, 1)).toBe(false);
    expect(hasPassed(0, 0, 0, 0)).toBe(false);
  });
});

describe('normalizeAnswers', () => {
  it('accepts both the map and the list form', () => {
    expect(normalizeAnswers({ a: 'x' })).toEqual({ a: 'x' });
    expect(
      normalizeAnswers([
        { questionId: 'a', answer: 'x' },
        { questionId: 'b', answer: ['1', '2'] },
      ])
    ).toEqual({
      a: 'x',
      b: ['1', '2'],
    });
  });
});
