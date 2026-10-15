import type { CohortAnalyticsResponse } from "@/hooks/useAnalytics";
import { toCsv } from "@/lib/csv";

type Metrics = CohortAnalyticsResponse["metrics"];

/** Share of enrolled learners active this week, 0-100, or null when nobody is enrolled. */
export function activeShare(m: Metrics): number | null {
  if (m.totalEnrolled <= 0) return null;
  return Math.min(100, Math.round((m.activeThisWeek / m.totalEnrolled) * 100));
}

/** The API reports 0.00 when no grade has been approved yet; that is "no data", not a 0.0 average. */
export function hasGpa(m: Metrics): boolean {
  return m.averageGpa > 0;
}

export function cohortReportFilename(now: Date = new Date()): string {
  return `cohort-analytics-${now.toISOString().slice(0, 10)}.csv`;
}

/** The whole analytics panel as one CSV: summary, at-risk learners, item diagnostics and Bloom mastery. */
export function cohortReportCsv(a: CohortAnalyticsResponse, now: Date = new Date()): string {
  const m = a.metrics;
  return toCsv([
    ["Cohort analytics report"],
    ["Generated", now.toISOString()],
    [],
    ["Summary"],
    ["Metric", "Value"],
    ["Learners enrolled", m.totalEnrolled],
    ["Active this week", m.activeThisWeek],
    ["Average progress (%)", m.averageProgress],
    ["Completion rate (%)", m.completionRate],
    ["Average GPA (4.0 scale)", hasGpa(m) ? m.averageGpa : ""],
    [],
    ["At-risk learners"],
    ["Name", "E-mail", "Course", "Risk", "Reasons", "Suggested action"],
    ...a.atRiskLearners.map((s) => [s.name, s.email, s.course, s.riskFactor, s.reasons.join("; "), s.suggestedAction]),
    [],
    ["Assessment items"],
    ["Concept", "Bloom level / type", "Attempts", "Average score (%)", "Status", "Recommendation"],
    ...a.itemAnalysis.map((i) => [i.concept, i.taxonomyLevel ?? i.questionType ?? "", i.attempts ?? "", i.averageScorePercent, i.status, i.recommendation]),
    [],
    ["Bloom's taxonomy mastery"],
    ["Level", "Cohort mastery (%)"],
    ...a.bloomsMastery.map((b) => [b.level, b.score]),
  ]);
}
