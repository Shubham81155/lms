import type { Criterion } from '@/lib/forms';

export type { Criterion };

export interface Assignment {
  id: string;
  title: string;
  maxPoints: number;
  rubricJson: Criterion[] | null;
  _count?: { submissions: number };
}

export interface Submission {
  id: string;
  userId: string;
  fileUrl: string | null;
  submissionText: string | null;
  grade: number | null;
  feedback: string | null;
  plagiarismScore: number | null;
  plagiarismReportUrl: string | null;
  plagiarismStatus: 'PENDING' | 'SUBMITTED' | 'COMPLETE' | 'FAILED' | null;
  rubricScoresJson: Record<string, number> | null;
  submittedAt: string;
  gradedAt: string | null;
  user?: { firstName: string; lastName: string; email: string };
}

export interface Appeal {
  id: string;
  status: 'OPEN' | 'UPHELD' | 'DENIED';
  reason: string;
  response: string | null;
  student?: string;
  createdAt: string;
  submission: { id: string; grade: number | null; text?: string | null; rubricScores: Record<string, number> | null };
  assignment: Assignment;
}

export const inputClass =
  'bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand';
export const primaryBtnClass =
  'px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold transition-all';
export const ghostBtnClass =
  'px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50';

export const DAY: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: undefined };
export const DAY_TIME: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: undefined,
};
