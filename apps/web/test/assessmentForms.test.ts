import { describe, it, expect } from 'vitest';
import { assignmentProblem, eventProblem, quizSettingsProblem, toLocalInput } from '../src/lib/assessmentForms';
import { blankQuestion, questionBody } from '../src/lib/questionDraft';

const quiz = { title: 'Midterm', timed: false, minutes: '30', attempts: '2', passing: '70', randomize: false, proctoring: false, camera: false, microphone: false, opens: '', closes: '', review: 'RESPONSES' as const };

describe('quizSettingsProblem', () => {
  it('accepts sensible settings', () => {
    expect(quizSettingsProblem(quiz)).toBeNull();
    expect(quizSettingsProblem({ ...quiz, timed: true, minutes: '45' })).toBeNull();
  });
  it('needs a title', () => {
    expect(quizSettingsProblem({ ...quiz, title: '   ' })).toMatch(/title/);
  });
  it('needs the quiz to open before it closes', () => {
    expect(quizSettingsProblem({ ...quiz, opens: '2026-11-02T09:00', closes: '2026-11-01T09:00' })).toMatch(/open before/);
    expect(quizSettingsProblem({ ...quiz, opens: '2026-11-01T09:00', closes: '2026-11-02T09:00' })).toBeNull();
    expect(quizSettingsProblem({ ...quiz, closes: '2026-11-02T09:00' })).toBeNull();
  });
  it('keeps attempts and the passing score inside the API limits', () => {
    expect(quizSettingsProblem({ ...quiz, attempts: '0' })).toMatch(/Attempts/);
    expect(quizSettingsProblem({ ...quiz, attempts: '101' })).toMatch(/Attempts/);
    expect(quizSettingsProblem({ ...quiz, attempts: '1.5' })).toMatch(/Attempts/);
    expect(quizSettingsProblem({ ...quiz, passing: '101' })).toMatch(/Passing/);
    expect(quizSettingsProblem({ ...quiz, passing: '-1' })).toMatch(/Passing/);
  });
  it('only checks the time limit when the quiz is timed', () => {
    expect(quizSettingsProblem({ ...quiz, timed: false, minutes: 'abc' })).toBeNull();
    expect(quizSettingsProblem({ ...quiz, timed: true, minutes: '0' })).toMatch(/Time limit/);
    expect(quizSettingsProblem({ ...quiz, timed: true, minutes: '1441' })).toMatch(/Time limit/);
  });
});

describe('assignmentProblem', () => {
  const ok = { title: 'Essay', instructions: 'Write it.', maxPoints: '100', due: '', lateUntil: '' };
  it('accepts a complete draft, with or without a due date', () => {
    expect(assignmentProblem(ok)).toBeNull();
    expect(assignmentProblem({ ...ok, due: '2027-01-15T10:30' })).toBeNull();
  });
  it('needs a title, instructions and points in range', () => {
    expect(assignmentProblem({ ...ok, title: '' })).toMatch(/title/);
    expect(assignmentProblem({ ...ok, instructions: ' ' })).toMatch(/instructions/);
    expect(assignmentProblem({ ...ok, maxPoints: '0' })).toMatch(/Points/);
    expect(assignmentProblem({ ...ok, maxPoints: '10001' })).toMatch(/Points/);
    expect(assignmentProblem({ ...ok, maxPoints: 'x' })).toMatch(/Points/);
  });
  it('keeps the late-work cutoff after the due date', () => {
    expect(assignmentProblem({ ...ok, lateUntil: '2027-01-20T10:30' })).toMatch(/due date before/);
    expect(assignmentProblem({ ...ok, due: '2027-01-15T10:30', lateUntil: '2027-01-14T10:30' })).toMatch(/after the due date/);
    expect(assignmentProblem({ ...ok, due: '2027-01-15T10:30', lateUntil: '2027-01-20T10:30' })).toBeNull();
  });
});

describe('eventProblem', () => {
  it('needs a title and a start and end that are in order', () => {
    expect(eventProblem({ title: '', start: '2027-02-01T09:00', end: '2027-02-01T10:00' })).toMatch(/title/);
    expect(eventProblem({ title: 'Exam', start: '', end: '2027-02-01T10:00' })).toMatch(/starts and ends/);
    expect(eventProblem({ title: 'Exam', start: '2027-02-01T10:00', end: '2027-02-01T09:00' })).toMatch(/cannot end before/);
    expect(eventProblem({ title: 'Exam', start: '2027-02-01T09:00', end: '2027-02-01T09:00' })).toBeNull();
  });
});

describe('toLocalInput', () => {
  it('round-trips an instant through a datetime-local value', () => {
    const iso = new Date(2027, 0, 15, 10, 30).toISOString();
    expect(toLocalInput(iso)).toBe('2027-01-15T10:30');
    expect(new Date(toLocalInput(iso)).toISOString()).toBe(iso);
  });
  it('is empty for no date', () => {
    expect(toLocalInput(null)).toBe('');
  });
});

describe('questionBody', () => {
  it('sends only filled options for choice questions and no answer key', () => {
    const d = { ...blankQuestion('MULTIPLE_CHOICE'), text: ' 2 + 2? ', options: [{ text: '3', isCorrect: false }, { text: ' 4 ', isCorrect: true }, { text: '  ', isCorrect: false }] };
    expect(questionBody(d)).toEqual({
      questionText: '2 + 2?',
      questionType: 'MULTIPLE_CHOICE',
      points: 1,
      optionsJson: [{ text: '3', isCorrect: false }, { text: '4', isCorrect: true }],
      correctAnswer: null,
      bloomLevel: null,
    });
  });
  it('sends an answer key for keyed types and nothing for essays', () => {
    expect(questionBody({ ...blankQuestion('SHORT_ANSWER'), text: 'Capital of France?', answer: ' Paris ' })).toMatchObject({ optionsJson: null, correctAnswer: 'Paris' });
    expect(questionBody({ ...blankQuestion('ESSAY'), text: 'Discuss.' })).toMatchObject({ optionsJson: null, correctAnswer: null });
  });
  it('starts true/false questions with both options', () => {
    expect(blankQuestion('TRUE_FALSE').options.map((o) => o.text)).toEqual(['True', 'False']);
  });
});
