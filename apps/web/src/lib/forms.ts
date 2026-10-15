// Pure form logic shared by the grading, assignment and question-bank screens. It mirrors the rules
// the API enforces so people see the problem before the round trip; the API stays authoritative.

export interface Criterion {
  id: string;
  name: string;
  description?: string;
  maxPoints: number;
}

export interface ChoiceOption {
  id?: string;
  text: string;
  isCorrect: boolean;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Scores a rubric draft the way the API will, so the total shown is the total saved. */
export function rubricDraft(criteria: Criterion[], values: Record<string, string>): { total: number; problem: string | null } {
  let total = 0;
  for (const c of criteria) {
    const raw = values[c.id];
    if (raw === undefined || raw.trim() === "") return { total: round2(total), problem: `Score "${c.name}".` };
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0 || v > c.maxPoints) {
      return { total: round2(total), problem: `"${c.name}" must be between 0 and ${c.maxPoints}.` };
    }
    total += v;
  }
  return { total: round2(total), problem: null };
}

/** Length of the window in which a learner may appeal a grade (the API enforces the same number). */
export const APPEAL_WINDOW_DAYS = 14;

/** Whole days left to appeal a grade, or 0 when the window has closed. */
export function appealDaysLeft(gradedAt: string, now: number = Date.now()): number {
  const left = APPEAL_WINDOW_DAYS - (now - new Date(gradedAt).getTime()) / 86_400_000;
  return left > 0 ? Math.ceil(left) : 0;
}

export const CHOICE_TYPES = ["MULTIPLE_CHOICE", "MULTI_SELECT", "TRUE_FALSE"];
export const KEYED_TYPES = ["SHORT_ANSWER", "FORMULA_CALCULATED"];

/** The first thing wrong with a question draft, or null when it can be saved. */
export function draftProblem(d: { type: string; text: string; options: ChoiceOption[]; answer: string }): string | null {
  if (!d.text.trim()) return "Write the question.";
  if (CHOICE_TYPES.includes(d.type)) {
    const filled = d.options.filter((o) => o.text.trim());
    const correct = filled.filter((o) => o.isCorrect).length;
    if (filled.length < 2) return "Add at least two options.";
    if (d.type === "MULTI_SELECT" ? correct < 1 : correct !== 1) {
      return d.type === "MULTI_SELECT" ? "Mark at least one correct option." : "Mark exactly one correct option.";
    }
  }
  if (KEYED_TYPES.includes(d.type) && !d.answer.trim()) return "Enter the correct answer.";
  return null;
}

/** #rgb or #rrggbb, the same rule the API applies to branding colours. */
export const isHexColor = (v: string) => /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(v.trim());

/** Empty (to clear the field) or an http(s) URL. */
export const isHttpUrlOrEmpty = (v: string) => {
  const t = v.trim();
  if (!t) return true;
  try {
    const u = new URL(t);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
};

/** Campus/department code: normalised the way the API does (upper case, 2-20 of A-Z 0-9 -). */
export const normaliseCode = (v: string) => v.trim().toUpperCase();
export const isValidCode = (v: string) => /^[A-Z0-9][A-Z0-9-]{1,19}$/.test(normaliseCode(v));

/** "#fff" -> "#ffffff", so it can feed <input type="color">. */
export const expandHex = (v: string) => {
  const t = v.trim();
  return /^#[A-Fa-f0-9]{3}$/.test(t) ? `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}` : t;
};

/** Whole days until an expiry (negative once past), or null when there is none (a bare public key). */
export const daysUntil = (iso: string | null, now: number = Date.now()): number | null =>
  iso ? Math.floor((new Date(iso).getTime() - now) / 86_400_000) : null;
