import { randomUUID } from 'crypto';

// Pure rubric arithmetic: no database access, so every rule is unit-tested directly.

export interface Criterion {
  id: string;
  name: string;
  description?: string;
  maxPoints: number;
}

export class RubricError extends Error {}

const round2 = (n: number) => Math.round(n * 100) / 100;

export const rubricTotal = (criteria: Criterion[]) => round2(criteria.reduce((s, c) => s + c.maxPoints, 0));

/** Gives new criteria ids and rejects empty or duplicate names (case-insensitive). */
export function normaliseCriteria(input: { id?: string; name: string; description?: string; maxPoints: number }[]): Criterion[] {
  if (input.length === 0) throw new RubricError('A rubric needs at least one criterion');
  const names = input.map((c) => c.name.trim().toLowerCase());
  if (names.some((n) => !n)) throw new RubricError('Every criterion needs a name');
  if (new Set(names).size !== names.length) throw new RubricError('Criterion names must be unique');
  const ids = input.map((c) => c.id).filter(Boolean);
  if (new Set(ids).size !== ids.length) throw new RubricError('Criterion ids must be unique');
  return input.map((c) => ({
    id: c.id ?? randomUUID(),
    name: c.name.trim(),
    ...(c.description?.trim() ? { description: c.description.trim() } : {}),
    maxPoints: round2(c.maxPoints),
  }));
}

/**
 * Turns per-criterion scores into a grade. Every criterion must be scored, scores may not exceed
 * the criterion's maximum or be negative, and unknown criteria are refused, so a typo can never
 * silently drop points.
 */
export function scoreFromCriteria(criteria: Criterion[], scores: Record<string, number>): { total: number; scores: Record<string, number> } {
  const known = new Set(criteria.map((c) => c.id));
  for (const id of Object.keys(scores)) if (!known.has(id)) throw new RubricError(`Unknown criterion ${id}`);
  const out: Record<string, number> = {};
  for (const c of criteria) {
    const v = scores[c.id];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new RubricError(`Score the "${c.name}" criterion`);
    if (v < 0 || v > c.maxPoints) throw new RubricError(`"${c.name}" must be between 0 and ${c.maxPoints}`);
    out[c.id] = round2(v);
  }
  return { total: round2(Object.values(out).reduce((a, b) => a + b, 0)), scores: out };
}
