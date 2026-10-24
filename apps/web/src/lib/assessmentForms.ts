// Pure validation for the staff assessment and calendar screens. It mirrors the limits the API
// enforces so people see the problem before the round trip; the API stays authoritative.

import type { ProblemText } from '@/lib/forms';

/** Quiz, assignment and event messages: translation key and English text from one place. */
export const ASSESSMENT_PROBLEMS = {
  quizTitle: { key: 'assess.problem.z1', en: 'Give the quiz a title.' },
  quizAttempts: { key: 'assess.problem.z2', en: 'Attempts must be a whole number from 1 to 100.' },
  quizPassing: { key: 'assess.problem.z3', en: 'Passing score must be between 0 and 100.' },
  quizMinutes: { key: 'assess.problem.z4', en: 'Time limit must be a whole number of minutes from 1 to 1440.' },
  quizWindow: { key: 'assess.problem.z5', en: 'The quiz must open before it closes.' },
  asgTitle: { key: 'assess.problem.a1', en: 'Give the assignment a title.' },
  asgInstructions: { key: 'assess.problem.a2', en: 'Write the instructions.' },
  asgPoints: { key: 'assess.problem.a3', en: 'Points must be more than 0 and at most 10,000.' },
  asgDue: { key: 'assess.problem.a4', en: 'The due date is not valid.' },
  asgLateNeedsDue: { key: 'assess.problem.a5', en: 'Set a due date before a late-work cutoff.' },
  asgLateAfterDue: { key: 'assess.problem.a6', en: 'Late work must be accepted until a time after the due date.' },
  eventTitle: { key: 'teach.cal.problem.title', en: 'Give the event a title.' },
  eventWhen: { key: 'teach.cal.problem.when', en: 'Choose when it starts and ends.' },
  eventOrder: { key: 'teach.cal.problem.order', en: 'It cannot end before it starts.' },
} as const satisfies Record<string, ProblemText>;

const P = ASSESSMENT_PROBLEMS;

/** The translation key of a message these helpers returned, or undefined. */
export const assessmentProblemKey = (msg: string | null): string | undefined =>
  msg ? Object.values(P).find((p) => p.en === msg)?.key : undefined;

export interface QuizSettings {
  title: string;
  timed: boolean;
  minutes: string;
  attempts: string;
  passing: string;
  randomize: boolean;
  proctoring: boolean;
  /** With proctoring: watch the camera / microphone in the learner's browser. */
  camera: boolean;
  microphone: boolean;
  /** datetime-local values; empty means no limit. */
  opens: string;
  closes: string;
  review: 'SCORE_ONLY' | 'RESPONSES' | 'ANSWERS';
}

/** Why a quiz's settings cannot be saved yet, or null. */
export function quizSettingsProblem(s: QuizSettings): string | null {
  if (!s.title.trim()) return P.quizTitle.en;
  const attempts = Number(s.attempts);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 100) return P.quizAttempts.en;
  const passing = Number(s.passing);
  if (!Number.isFinite(passing) || passing < 0 || passing > 100) return P.quizPassing.en;
  if (s.timed) {
    const mins = Number(s.minutes);
    if (!Number.isInteger(mins) || mins < 1 || mins > 1440) return P.quizMinutes.en;
  }
  if (s.opens && s.closes && new Date(s.closes) <= new Date(s.opens)) return P.quizWindow.en;
  return null;
}

export interface AssignmentDraft {
  title: string;
  instructions: string;
  maxPoints: string;
  due: string;
  /** datetime-local; empty means late work is always accepted. */
  lateUntil: string;
}

/** Why an assignment cannot be saved yet, or null. */
export function assignmentProblem(d: AssignmentDraft): string | null {
  if (!d.title.trim()) return P.asgTitle.en;
  if (!d.instructions.trim()) return P.asgInstructions.en;
  const pts = Number(d.maxPoints);
  if (!Number.isFinite(pts) || pts <= 0 || pts > 10000) return P.asgPoints.en;
  if (d.due && Number.isNaN(new Date(d.due).getTime())) return P.asgDue.en;
  if (d.lateUntil && !d.due) return P.asgLateNeedsDue.en;
  if (d.lateUntil && new Date(d.lateUntil) < new Date(d.due)) return P.asgLateAfterDue.en;
  return null;
}

export interface EventDraft {
  title: string;
  start: string;
  end: string;
}

/** Why a calendar event cannot be saved yet, or null. */
export function eventProblem(d: EventDraft): string | null {
  if (!d.title.trim()) return P.eventTitle.en;
  if (!d.start || !d.end) return P.eventWhen.en;
  if (new Date(d.end) < new Date(d.start)) return P.eventOrder.en;
  return null;
}

/** An ISO instant as the local "YYYY-MM-DDTHH:mm" a datetime-local input wants. */
export const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
