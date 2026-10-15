// Pure grade arithmetic: no database access, so every rule here is unit-tested directly.

export type CurveMethod = 'NONE' | 'ADD_POINTS' | 'SCALE_TO_MAX';

export interface CategoryDef {
  id: string;
  name: string;
  weightPercent: number;
}

export interface ItemScore {
  itemId: string;
  type: 'QUIZ' | 'ASSIGNMENT';
  title: string;
  categoryId: string | null;
  /** 0-100, or null while the work is waiting for a grader. */
  percent: number | null;
  pending: boolean;
  /** Nothing was submitted; counts as 0 until the learner submits. */
  missing: boolean;
}

export interface CategoryResult {
  categoryId: string;
  name: string;
  weightPercent: number;
  /** Mean of the scored items, or null when the category has nothing scored yet. */
  averagePercent: number | null;
  items: number;
  pendingItems: number;
}

export interface RawGrade {
  rawPercent: number;
  incomplete: boolean;
  categories: CategoryResult[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number) => Math.min(100, Math.max(0, n));

/**
 * Weighted category average. Items waiting for a grader are left out of their category's mean and
 * mark the grade `incomplete`. Categories with no scored items are left out and the remaining
 * weights are renormalised, so a course with an empty "Final exam" category is not capped at 60%.
 * Items not assigned to a category do not count.
 */
export function computeRawGrade(categories: CategoryDef[], items: ItemScore[]): RawGrade {
  let incomplete = false;
  const results: CategoryResult[] = categories.map((c) => {
    const mine = items.filter((i) => i.categoryId === c.id);
    const scored = mine.filter((i) => !i.pending && i.percent !== null);
    const pendingItems = mine.length - scored.length;
    if (pendingItems > 0) incomplete = true;
    const avg = scored.length ? scored.reduce((s, i) => s + (i.percent as number), 0) / scored.length : null;
    return {
      categoryId: c.id,
      name: c.name,
      weightPercent: c.weightPercent,
      averagePercent: avg === null ? null : round2(avg),
      items: mine.length,
      pendingItems,
    };
  });

  const counted = results.filter((r) => r.averagePercent !== null);
  const weight = counted.reduce((s, r) => s + r.weightPercent, 0);
  const raw = weight > 0 ? counted.reduce((s, r) => s + (r.averagePercent as number) * r.weightPercent, 0) / weight : 0;
  return { rawPercent: round2(clamp(raw)), incomplete, categories: results };
}

/**
 * Applies a class-wide curve to every learner's raw percentage.
 *  - ADD_POINTS: adds `value` points (capped at 100, floor 0).
 *  - SCALE_TO_MAX: multiplies so the best raw score becomes 100; never lowers a grade.
 */
export function applyCurve(raws: number[], method: CurveMethod, value: number): number[] {
  if (method === 'ADD_POINTS') return raws.map((r) => round2(clamp(r + value)));
  if (method === 'SCALE_TO_MAX') {
    const max = Math.max(0, ...raws);
    const factor = max > 0 ? 100 / max : 1;
    return raws.map((r) => round2(clamp(r * Math.max(1, factor))));
  }
  return raws.map((r) => round2(clamp(r)));
}

export const DEFAULT_SCALE: { min: number; letter: string }[] = [
  { min: 90, letter: 'A' },
  { min: 80, letter: 'B' },
  { min: 70, letter: 'C' },
  { min: 60, letter: 'D' },
  { min: 0, letter: 'F' },
];

export function letterFor(percent: number, scale = DEFAULT_SCALE): string {
  return scale.find((s) => percent >= s.min)?.letter ?? 'F';
}

/** Category weights must total exactly 100 (to the cent). */
export function weightsValid(weights: number[]): boolean {
  return weights.length > 0 && Math.abs(weights.reduce((a, b) => a + b, 0) - 100) < 0.005;
}
