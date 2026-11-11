export interface Category {
  id: string;
  name: string;
  weightPercent: number;
}

export interface Item {
  type: 'QUIZ' | 'ASSIGNMENT';
  id: string;
  title: string;
  gradeCategoryId: string | null;
}

export type CurveMethod = 'NONE' | 'ADD_POINTS' | 'SCALE_TO_MAX';

export interface Config {
  curve: { method: CurveMethod; value: number };
  categories: Category[];
  items: Item[];
}

export interface Row {
  userId: string;
  name: string;
  email: string;
  rawPercent: number;
  curvedPercent: number;
  letter: string;
  incomplete: boolean;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED';
  decisionNote: string | null;
}

export interface Book {
  data: Row[];
  summary: { total: number; draft: number; submitted: number; approved: number; incomplete: number; average: number | null };
}

export interface Score {
  percent: number | null;
  pending: boolean;
  missing: boolean;
}

export interface GridData {
  items: { id: string; type: 'QUIZ' | 'ASSIGNMENT'; title: string; category: string | null }[];
  learners: {
    userId: string;
    name: string;
    email: string;
    scores: Record<string, Score>;
    courseGrade: { rawPercent: number; curvedPercent: number; letter: string; status: Row['status'] } | null;
  }[];
}

export const inputClass =
  'bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand';
export const primaryBtnClass =
  'px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold transition-all';
export const ghostBtnClass =
  'px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50';

export const STATUS_STYLE: Record<Row['status'], string> = {
  DRAFT: 'bg-raised text-ink border-line',
  SUBMITTED: 'bg-accent/10 text-accent border-accent/30',
  APPROVED: 'bg-success/10 text-success border-success/30',
};

export const round2 = (n: number) => Math.round(n * 100) / 100;

export const CURVE_OPTIONS: CurveMethod[] = ['NONE', 'ADD_POINTS', 'SCALE_TO_MAX'];
