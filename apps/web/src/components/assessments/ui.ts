import type { Translator } from '@/lib/i18n';

// Shared look for the staff assessment screens, matching the question bank and gradebook.
export const input =
  'bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand disabled:opacity-60';
export const primary =
  'px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold transition-all';
export const ghost =
  'px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50';
export const danger =
  'px-3 py-1.5 bg-danger hover:opacity-90 disabled:opacity-50 text-on-brand rounded-lg text-[11px] font-bold transition-all';
export const card = 'bg-canvas border border-line rounded-2xl p-4';

/** "MULTI_SELECT" -> "multi select" */
export const label = (s: string) => s.replace(/_/g, ' ').toLowerCase();

/** The same, in the reader's language (question types, Bloom levels); unknown values fall back to `label`. */
export const tLabel = (t: Translator, s: string) => t.dyn(`assess.enum.${s}`, label(s));

// The shared form checkers return English sentences; these are their keys.
const PROBLEM_KEYS: Record<string, string> = {
  'Write the question.': 'assess.problem.q1',
  'Add at least two options.': 'assess.problem.q2',
  'Mark at least one correct option.': 'assess.problem.q3',
  'Mark exactly one correct option.': 'assess.problem.q4',
  'Enter the correct answer.': 'assess.problem.q5',
  'Give the quiz a title.': 'assess.problem.z1',
  'Attempts must be a whole number from 1 to 100.': 'assess.problem.z2',
  'Passing score must be between 0 and 100.': 'assess.problem.z3',
  'Time limit must be a whole number of minutes from 1 to 1440.': 'assess.problem.z4',
  'The quiz must open before it closes.': 'assess.problem.z5',
  'Give the assignment a title.': 'assess.problem.a1',
  'Write the instructions.': 'assess.problem.a2',
  'Points must be more than 0 and at most 10,000.': 'assess.problem.a3',
  'The due date is not valid.': 'assess.problem.a4',
  'Set a due date before a late-work cutoff.': 'assess.problem.a5',
  'Late work must be accepted until a time after the due date.': 'assess.problem.a6',
};

/** A form checker's message in the reader's language (unknown messages stay as they are). */
export const tProblem = (t: Translator, s: string | null) => (s ? t.dyn(PROBLEM_KEYS[s] ?? 'assess.problem.unknown', s) : s);
