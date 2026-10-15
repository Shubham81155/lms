export const BLOOM_ORDER = ['REMEMBER', 'UNDERSTAND', 'APPLY', 'ANALYZE', 'EVALUATE', 'CREATE'] as const;

/**
 * Average score per Bloom level, from graded answers to tagged questions. Untagged questions and
 * answers still waiting for a grader are skipped; levels with no data are omitted.
 */
export function bloomsMastery(
  quizzes: { questions: { id: string; bloomLevel: string | null }[]; submissions: { answersJson: unknown }[] }[]
) {
  const totals = new Map<string, { awarded: number; max: number }>();
  for (const q of quizzes) {
    for (const question of q.questions) {
      if (!question.bloomLevel) continue;
      for (const s of q.submissions) {
        const r = (s.answersJson as any)?.grading?.[question.id];
        if (!r || r.needsManualGrading || !(r.maxPoints > 0)) continue;
        const t = totals.get(question.bloomLevel) ?? { awarded: 0, max: 0 };
        t.awarded += r.awardedPoints;
        t.max += r.maxPoints;
        totals.set(question.bloomLevel, t);
      }
    }
  }
  return BLOOM_ORDER.filter((l) => totals.has(l)).map((level) => {
    const t = totals.get(level)!;
    return { level, score: Math.round((t.awarded / t.max) * 100) };
  });
}
