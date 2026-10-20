"use client";

import React, { useEffect, useState } from "react";
import { X, BarChart2, AlertTriangle, CheckCircle2, Download, Sparkles, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { useCohortAnalytics, type AtRiskLearner } from "@/hooks/useAnalytics";
import { errorMessage } from "@/hooks/useApiData";
import { activeShare, cohortReportCsv, cohortReportFilename, hasGpa } from "@/lib/cohortReport";
import { downloadCsv } from "@/lib/download";

interface FacultyAnalyticsModalProps {
  onClose: () => void;
}

type TabId = "OVERVIEW" | "AT_RISK" | "ITEM_ANALYSIS";
type Notice = { kind: "ok" | "error"; text: string };

const EmptyState: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="rounded-2xl border border-dashed border-line bg-canvas/50 px-6 py-12 text-center">
    <p className="text-sm font-bold text-ink">{title}</p>
    <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-ink-muted">{children}</p>
  </div>
);

const MetricCard: React.FC<{ label: string; value: string; caption?: string; tone?: "default" | "danger" }> = ({ label, value, caption, tone = "default" }) => (
  <div className="rounded-2xl border border-line/90 bg-canvas p-4">
    <span className="block text-[10px] font-semibold uppercase text-ink-subtle">{label}</span>
    <div className={`mt-1 text-xl font-extrabold ${tone === "danger" ? "text-danger" : "text-ink"}`}>{value}</div>
    <span className="block min-h-[14px] text-[10px] font-medium text-ink-muted">{caption}</span>
  </div>
);

export const FacultyAnalyticsModal: React.FC<FacultyAnalyticsModalProps> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<TabId>("OVERVIEW");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [nudges, setNudges] = useState<Record<string, "sending" | "sent">>({});
  const { analytics, isLoading, error, refetch } = useCohortAnalytics();

  const metrics = analytics?.metrics;
  const atRisk = analytics?.atRiskLearners ?? [];
  const items = analytics?.itemAnalysis ?? [];
  const bloom = analytics?.bloomsMastery ?? [];
  const hasLearners = !!metrics && metrics.totalEnrolled > 0;
  const share = metrics ? activeShare(metrics) : null;

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const nudgeKey = (s: AtRiskLearner) => `${s.id}:${s.courseId ?? ""}`;

  const sendNudge = async (student: AtRiskLearner) => {
    if (!student.courseId) return;
    const key = nudgeKey(student);
    setNudges((n) => ({ ...n, [key]: "sending" }));
    try {
      await api.post("/api/v1/analytics/at-risk/nudge", { courseId: student.courseId, userId: student.id });
      setNudges((n) => ({ ...n, [key]: "sent" }));
      setNotice({ kind: "ok", text: `Nudge sent to ${student.name}.` });
    } catch (e) {
      setNudges((n) => {
        const { [key]: _gone, ...rest } = n;
        return rest;
      });
      setNotice({ kind: "error", text: errorMessage(e, "Could not send the nudge.") });
    }
  };

  const exportReport = () => {
    if (!analytics) return;
    downloadCsv(cohortReportFilename(), cohortReportCsv(analytics));
    setNotice({ kind: "ok", text: "Report downloaded." });
  };

  const tabs: { id: TabId; label: string }[] = [
    { id: "OVERVIEW", label: "Bloom's Cognitive Distribution" },
    { id: "AT_RISK", label: `Early-Warning Radar${analytics ? ` (${atRisk.length})` : ""}` },
    { id: "ITEM_ANALYSIS", label: "Assessment Item Difficulty Analysis" },
  ];

  let body: React.ReactNode;
  if (isLoading) {
    body = (
      <p role="status" className="py-16 text-center text-xs text-ink-muted">
        Loading cohort analytics…
      </p>
    );
  } else if (error || !analytics) {
    body = (
      <div role="alert" className="mx-auto max-w-md rounded-2xl border border-danger/30 bg-danger/10 p-6 text-center">
        <p className="text-sm font-bold text-danger">Could not load the analytics</p>
        <p className="mt-1.5 text-xs text-ink-muted">{error ?? "No data was returned."}</p>
        <button
          onClick={refetch}
          className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-raised"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Try again
        </button>
      </div>
    );
  } else if (activeTab === "OVERVIEW") {
    body = (
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h4 className="text-sm font-bold text-ink">Cohort Mastery Across Bloom&apos;s Cognitive Taxonomy</h4>
          <p className="mt-1 text-xs text-ink-muted">Average score on graded quiz questions tagged with a Bloom's level.</p>
        </div>
        {bloom.length === 0 ? (
          <EmptyState title="No Bloom's taxonomy data yet">
            Mastery per level appears once quiz questions have a Bloom level (set it in the Question Bank) and learners have answered them.
          </EmptyState>
        ) : (
          <div className="space-y-3.5">
            {bloom.map((b) => (
              <div key={b.level} className="space-y-2 rounded-2xl border border-line bg-canvas p-4">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-ink">{b.level}</span>
                  <span className="font-bold text-orchid">{b.score}% Cohort Mastery</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full border border-line bg-surface">
                  <div className="h-2.5 rounded-full bg-gradient-to-r from-purple-500 to-brand-hover transition-all duration-700" style={{ width: `${b.score}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  } else if (activeTab === "AT_RISK") {
    body = (
      <div className="space-y-4">
        <div>
          <h4 className="text-sm font-bold text-ink">Predictive At-Risk Student Intervention Queue</h4>
          <p className="mt-1 text-xs text-ink-muted">Learners automatically flagged by heuristic rules: low engagement, streak drops, or failed milestones.</p>
        </div>
        {atRisk.length === 0 ? (
          <EmptyState title="No learners are flagged right now">
            {hasLearners
              ? "Nobody in your courses currently matches the early-warning rules. This list updates as engagement and scores change."
              : "There are no learners enrolled in your courses yet."}
          </EmptyState>
        ) : (
          <div className="space-y-3">
            {atRisk.map((student) => {
              const state = nudges[nudgeKey(student)];
              return (
                <div key={nudgeKey(student)} className="flex flex-col justify-between gap-4 rounded-2xl border border-danger/30 bg-canvas p-5 shadow-lg md:flex-row md:items-center">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-sm text-ink">{student.name}</strong>
                      <span className="text-xs text-ink-muted">({student.email})</span>
                      <span className="rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-[10px] font-bold text-danger">{student.riskFactor} RISK</span>
                      <span className="text-xs text-ink-subtle">• {student.course}</span>
                    </div>
                    <div className="space-y-1">
                      {student.reasons.map((r, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-xs text-ink-muted">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-accent" />
                          <span>{r}</span>
                        </div>
                      ))}
                    </div>
                    <div className="text-[11px] font-medium text-orchid">Recommended Action: {student.suggestedAction}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => sendNudge(student)}
                      disabled={!student.courseId || state !== undefined}
                      title={student.courseId ? "Sends the learner a notification" : "This entry has no course"}
                      className="flex items-center gap-1.5 rounded-xl bg-purple-600 px-4 py-2 text-xs font-bold text-on-brand shadow-md shadow-purple-500/20 transition-all hover:bg-purple-500 disabled:opacity-60"
                    >
                      {state === "sent" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                      <span>{state === "sent" ? "Nudge sent" : state === "sending" ? "Sending…" : "Send Nudge"}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  } else {
    body = (
      <div className="space-y-4">
        <div>
          <h4 className="text-sm font-bold text-ink">Curriculum & Assessment Item Diagnostics</h4>
          <p className="mt-1 text-xs text-ink-muted">Questions where student scores deviate significantly from the class baseline.</p>
        </div>
        {items.length === 0 ? (
          <EmptyState title="No question results to analyse yet">Item diagnostics appear once learners have submitted quizzes that contain questions.</EmptyState>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <div key={item.questionId} className="flex flex-col justify-between gap-4 rounded-2xl border border-line bg-canvas p-5 md:flex-row md:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm text-ink">{item.concept}</strong>
                    <span className="rounded border border-line bg-surface px-2 py-0.5 text-[10px] font-bold text-ink-muted">
                      {item.taxonomyLevel ? `Bloom: ${item.taxonomyLevel}` : (item.questionType ?? "Question")}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        item.averageScorePercent < 60
                          ? "border border-danger/30 bg-danger/10 text-danger"
                          : item.averageScorePercent < 75
                            ? "border border-accent/30 bg-accent/10 text-accent"
                            : "border border-success/30 bg-success/10 text-success"
                      }`}
                    >
                      {item.averageScorePercent}% Accuracy
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-ink-muted">
                    Faculty Pedagogical Recommendation: <strong className="text-ink">{item.recommendation}</strong>
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/85 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="cohort-h">
      <div className="relative flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-line bg-canvas px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-orchid/30 bg-orchid/20 text-orchid">
              <BarChart2 className="h-5 w-5" />
            </div>
            <div>
              <h3 id="cohort-h" className="text-base font-bold text-ink">
                Faculty Cohort Intelligence & Early-Warning Radar
              </h3>
              <p className="text-xs text-ink-muted">Learner retention, Bloom&apos;s cognitive taxonomy distribution, and item difficulty diagnostics for your courses.</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={exportReport}
              disabled={!analytics}
              className="flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-raised disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5 text-orchid" />
              <span>Export CSV Report</span>
            </button>
            <button onClick={onClose} aria-label="Close" className="rounded-xl p-1 text-ink-muted transition-colors hover:bg-raised hover:text-ink">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {notice && (
          <div
            role={notice.kind === "error" ? "alert" : "status"}
            className={`absolute bottom-6 left-1/2 z-10 flex max-w-[90%] -translate-x-1/2 animate-fadeIn items-center gap-2 rounded-xl border bg-surface px-4 py-2.5 text-xs shadow-xl ${
              notice.kind === "ok" ? "border-success/40 text-success" : "border-danger/40 text-danger"
            }`}
          >
            {notice.kind === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            <span className="font-semibold">{notice.text}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 border-b border-line bg-canvas/40 p-6 md:grid-cols-4">
          <MetricCard
            label="Total Learners"
            value={metrics ? String(metrics.totalEnrolled) : "—"}
            caption={metrics ? (share === null ? "Nobody enrolled yet" : `${share}% active this week`) : undefined}
          />
          <MetricCard
            label="Average Completion"
            value={hasLearners ? `${metrics.averageProgress}%` : "—"}
            caption={hasLearners ? `${metrics.completionRate}% have finished` : undefined}
          />
          <MetricCard
            label="At-Risk Learners"
            value={analytics ? String(atRisk.length) : "—"}
            tone={atRisk.length > 0 ? "danger" : "default"}
            caption={analytics ? (atRisk.length > 0 ? "Early interventions pending" : "Nobody flagged right now") : undefined}
          />
          <MetricCard
            label="Cohort Average GPA"
            value={metrics && hasGpa(metrics) ? metrics.averageGpa.toFixed(2) : "—"}
            caption={metrics ? (hasGpa(metrics) ? "4.0 scale, approved grades" : "No approved grades yet") : undefined}
          />
        </div>

        <div role="tablist" aria-label="Analytics views" className="flex items-center gap-2 border-b border-line bg-canvas/60 px-6 py-2.5 text-xs font-bold">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-xl px-3 py-1.5 transition-all ${
                activeTab === tab.id ? "bg-purple-600 text-on-brand shadow-md shadow-purple-500/20" : "text-ink-muted hover:bg-surface hover:text-ink"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">{body}</div>
      </div>
    </div>
  );
};
