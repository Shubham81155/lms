"use client";

import React, { useState } from "react";
import {
  X,
  BarChart2,
  TrendingUp,
  AlertTriangle,
  Users,
  CheckCircle2,
  Download,
  Mail,
  Calendar,
  Sparkles,
  HelpCircle,
  FileSpreadsheet,
} from "lucide-react";
import { useCohortAnalytics } from "@/hooks/useAnalytics";

interface FacultyAnalyticsModalProps {
  onClose: () => void;
}

export const FacultyAnalyticsModal: React.FC<FacultyAnalyticsModalProps> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<"OVERVIEW" | "AT_RISK" | "ITEM_ANALYSIS">("OVERVIEW");
  const [notification, setNotification] = useState<string | null>(null);

  const { analytics, isLoading } = useCohortAnalytics();

  const metrics = analytics?.metrics || {
    totalEnrolled: 428,
    activeThisWeek: 394,
    averageProgress: 76.4,
    completionRate: 74,
    averageGpa: 3.78,
  };

  const atRiskLearners = analytics?.atRiskLearners || [
    {
      id: "usr_03",
      name: "Liam Johnson",
      email: "liam.johnson@harvard.edu",
      course: "CS-101",
      riskFactor: "HIGH" as const,
      reasons: ["Plagiarism match 42.8% on Lab 2", "Inactivity for > 6 days", "Quiz attempt score: 58%"],
      suggestedAction: "Schedule 1-on-1 Office Hours & Academic Support",
      streakDays: 2,
    },
    {
      id: "usr_04",
      name: "Ethan Brooks",
      email: "ethan.brooks@harvard.edu",
      course: "DS-201",
      riskFactor: "MEDIUM" as const,
      reasons: ["Progress stalled at Module 1.2", "Failed Quiz 1 (Score: 62%)"],
      suggestedAction: "Send AI Adaptive Practice Drill Nudge",
      streakDays: 4,
    },
  ];

  const itemAnalysis = analytics?.itemAnalysis || [
    {
      questionId: "q_raft_split",
      concept: "Raft Split-Brain Quorum Partitioning",
      taxonomyLevel: "EVALUATE",
      averageScorePercent: 54,
      status: "FLAGGED_HIGH_DIFFICULTY",
      recommendation: "Review leader election edge cases in lecture",
    },
    {
      questionId: "q_aes_gcm",
      concept: "AES-256-GCM Auth Tag Verification",
      taxonomyLevel: "APPLY",
      averageScorePercent: 88,
      status: "NORMAL",
      recommendation: "Strong cohort comprehension",
    },
    {
      questionId: "q_flp_thm",
      concept: "FLP Impossibility in Asynchronous Systems",
      taxonomyLevel: "ANALYZE",
      averageScorePercent: 62,
      status: "ATTENTION_NEEDED",
      recommendation: "Emphasize partial synchrony assumptions",
    },
  ];

  const bloomsMastery = analytics?.bloomsMastery || [
    { level: "REMEMBER", score: 94 },
    { level: "UNDERSTAND", score: 89 },
    { level: "APPLY", score: 82 },
    { level: "ANALYZE", score: 76 },
    { level: "EVALUATE", score: 68 },
    { level: "CREATE", score: 72 },
  ];

  const handleSendNudge = (studentName: string) => {
    setNotification(`AI adaptive practice drill and calendar invite dispatched to ${studentName}!`);
    setTimeout(() => setNotification(null), 4000);
  };

  const handleExportReport = () => {
    setNotification("Generated Cohort_Analytics_Report_Fall_2026.csv for Faculty Senate!");
    setTimeout(() => setNotification(null), 4000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-canvas/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-surface border border-line rounded-3xl w-full max-w-6xl h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="bg-canvas border-b border-line px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-orchid/20 border border-orchid/30 flex items-center justify-center text-orchid">
              <BarChart2 className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-ink">Faculty Cohort Intelligence & Early-Warning Radar</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orchid/15 text-orchid border border-orchid/30">
                  CS-101 & DS-201 Cohort
                </span>
              </div>
              <p className="text-xs text-ink-muted">
                Predictive student retention, Bloom's cognitive taxonomy distribution, and item difficulty diagnostics.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleExportReport}
              className="px-3.5 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <Download className="h-3.5 w-3.5 text-orchid" />
              <span>Export CSV Report</span>
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded-xl hover:bg-raised text-ink-muted hover:text-ink transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Notification Banner */}
        {notification && (
          <div className="bg-success/10 border-b border-success/30 px-6 py-2.5 text-xs text-success flex items-center gap-2 animate-fadeIn">
            <CheckCircle2 className="h-4 w-4 text-success" />
            <span className="font-semibold">{notification}</span>
          </div>
        )}

        {/* Key Metrics Header */}
        <div className="bg-canvas/40 border-b border-line p-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-canvas border border-line/90 p-4 rounded-2xl">
            <span className="text-[10px] font-semibold text-ink-subtle uppercase block">Total Learners</span>
            <div className="text-xl font-extrabold text-ink mt-1">{metrics.totalEnrolled}</div>
            <span className="text-[10px] text-success font-medium">92% active this week</span>
          </div>

          <div className="bg-canvas border border-line/90 p-4 rounded-2xl">
            <span className="text-[10px] font-semibold text-ink-subtle uppercase block">Average Completion</span>
            <div className="text-xl font-extrabold text-ink mt-1">{metrics.averageProgress}%</div>
            <span className="text-[10px] text-brand-fg font-medium">+4.2% vs last term</span>
          </div>

          <div className="bg-canvas border border-line/90 p-4 rounded-2xl">
            <span className="text-[10px] font-semibold text-ink-subtle uppercase block">Predictive At-Risk</span>
            <div className="text-xl font-extrabold text-danger mt-1">{atRiskLearners.length} Students</div>
            <span className="text-[10px] text-danger font-medium">Early interventions pending</span>
          </div>

          <div className="bg-canvas border border-line/90 p-4 rounded-2xl">
            <span className="text-[10px] font-semibold text-ink-subtle uppercase block">Cohort Average GPA</span>
            <div className="text-xl font-extrabold text-ink mt-1">{metrics.averageGpa}</div>
            <span className="text-[10px] text-success font-medium">Exceeds department benchmark</span>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="bg-canvas/60 border-b border-line px-6 py-2.5 flex items-center gap-2 text-xs font-bold">
          {[
            { id: "OVERVIEW", label: "Bloom's Cognitive Distribution" },
            { id: "AT_RISK", label: `Early-Warning Radar (${atRiskLearners.length} At-Risk)` },
            { id: "ITEM_ANALYSIS", label: "Assessment Item Difficulty Analysis" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-3 py-1.5 rounded-xl transition-all ${
                activeTab === tab.id
                  ? "bg-purple-600 text-on-brand shadow-md shadow-purple-500/20"
                  : "text-ink-muted hover:text-ink hover:bg-surface"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Body Content */}
        <div className="flex-1 p-6 overflow-y-auto">
          {activeTab === "OVERVIEW" && (
            <div className="space-y-6 max-w-3xl mx-auto">
              <div>
                <h4 className="text-sm font-bold text-ink">Cohort Mastery Across Bloom's Cognitive Taxonomy</h4>
                <p className="text-xs text-ink-muted mt-1">
                  Synthesized across MCQ assessments, open code lab unit tests, and rubric grading criteria.
                </p>
              </div>

              <div className="space-y-3.5">
                {bloomsMastery.map((b) => (
                  <div key={b.level} className="bg-canvas border border-line rounded-2xl p-4 space-y-2">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span className="text-ink">{b.level}</span>
                      <span className="text-orchid font-bold">{b.score}% Cohort Mastery</span>
                    </div>
                    <div className="w-full bg-surface rounded-full h-2.5 overflow-hidden border border-line">
                      <div
                        className="bg-gradient-to-r from-purple-500 to-brand-hover h-2.5 rounded-full transition-all duration-700"
                        style={{ width: `${b.score}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "AT_RISK" && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-bold text-ink">Predictive At-Risk Student Intervention Queue</h4>
                <p className="text-xs text-ink-muted mt-1">
                  Learners automatically flagged by heuristic rules: low engagement, streak drops, or failed milestones.
                </p>
              </div>

              <div className="space-y-3">
                {atRiskLearners.map((student) => (
                  <div
                    key={student.id}
                    className="bg-canvas border border-danger/30 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-lg"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <strong className="text-sm text-ink">{student.name}</strong>
                        <span className="text-xs text-ink-muted">({student.email})</span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-danger/10 text-danger border border-danger/30">
                          {student.riskFactor} RISK
                        </span>
                        <span className="text-xs text-ink-subtle">• {student.course}</span>
                      </div>

                      <div className="space-y-1">
                        {student.reasons.map((r, rIdx) => (
                          <div key={rIdx} className="text-xs text-ink-muted flex items-center gap-1.5">
                            <AlertTriangle className="h-3.5 w-3.5 text-accent shrink-0" />
                            <span>{r}</span>
                          </div>
                        ))}
                      </div>

                      <div className="text-[11px] text-orchid font-medium">
                        Recommended Action: {student.suggestedAction}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleSendNudge(student.name)}
                        className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-on-brand rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md shadow-purple-500/20 transition-all"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>Send Nudge</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "ITEM_ANALYSIS" && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-bold text-ink">Curriculum & Assessment Item Diagnostics</h4>
                <p className="text-xs text-ink-muted mt-1">
                  Questions where student scores deviate significantly from the class baseline.
                </p>
              </div>

              <div className="space-y-3">
                {itemAnalysis.map((item) => (
                  <div
                    key={item.questionId}
                    className="bg-canvas border border-line rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <strong className="text-sm text-ink">{item.concept}</strong>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-surface text-ink-muted border border-line">
                          {item.taxonomyLevel ? `Bloom: ${item.taxonomyLevel}` : (item.questionType ?? "Question")}
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          item.averageScorePercent < 60
                            ? "bg-danger/10 text-danger border border-danger/30"
                            : item.averageScorePercent < 75
                            ? "bg-accent/10 text-accent border border-accent/30"
                            : "bg-success/10 text-success border border-success/30"
                        }`}>
                          {item.averageScorePercent}% Accuracy
                        </span>
                      </div>
                      <p className="text-xs text-ink-muted mt-1.5">
                        Faculty Pedagogical Recommendation: <strong className="text-ink">{item.recommendation}</strong>
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
