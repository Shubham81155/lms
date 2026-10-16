"use client";

import React, { useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { CourseBuilder } from "@/components/CourseBuilder";
import { CourseContentEditor } from "@/components/CourseContentEditor";
import { CourseRoster } from "@/components/CourseRoster";
import { useOpenIntent } from "@/hooks/useOpenIntent";
import { AssessmentManager } from "@/components/AssessmentManager";
import { CalendarManager } from "@/components/CalendarManager";
import { CourseGradebook } from "@/components/CourseGradebook";
import { QuestionBank } from "@/components/QuestionBank";
import { AssignmentGrading } from "@/components/AssignmentGrading";
import { LiveClasses } from "@/components/LiveClasses";
import { LiveNow } from "@/components/LiveNow";
import {
  BookOpen,
  Users,
  FileCheck,
  AlertTriangle,
  Video,
  Plus,
  BarChart2,
  CheckCircle2,
  Clock,
  Sparkles,
  TrendingUp,
  ShieldAlert,
  Search,
  MessageSquare,
  Activity,
  Library,
  ClipboardCheck,
  ClipboardList,
  CalendarDays,
} from "lucide-react";
import { createCourseWithCurriculum } from "@/hooks/useCourses";
import { useStaffCourses } from "@/hooks/useStaffCourses";
import { DiscussionForum } from "@/components/DiscussionForum";
import { FacultyAnalyticsModal } from "@/components/FacultyAnalyticsModal";
import { LrsAnalyticsViewer } from "@/components/LrsAnalyticsViewer";
import { useAuth } from "@/context/AuthContext";
import { useApiData } from "@/hooks/useApiData";
import { useCohortAnalytics } from "@/hooks/useAnalytics";
import { timeAgo } from "@/hooks/useNotifications";
import { plural } from "@/lib/plural";

export default function TeacherDashboard() {
  const [showCourseBuilder, setShowCourseBuilder] = useState(false);
  const [showContentEditor, setShowContentEditor] = useState(false);
  const [showRoster, setShowRoster] = useState(false);
  const [showAssessments, setShowAssessments] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showGradebook, setShowGradebook] = useState(false);
  const [showQuestionBank, setShowQuestionBank] = useState(false);
  const [showAssignmentGrading, setShowAssignmentGrading] = useState(false);
  const [showLiveClasses, setShowLiveClasses] = useState(false);
  const [showForum, setShowForum] = useState(false);
  const [focusCourse, setFocusCourse] = useState<string | null>(null);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showLrsStream, setShowLrsStream] = useState(false);
  const [activeNavTab, setActiveNavTab] = useState<string>("courses");

  React.useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash;
      if (hash === "#gradebook") {
        setActiveNavTab("gradebook");
        setShowGradebook(true);
      } else if (hash === "#proctoring") {
        setActiveNavTab("proctoring");
        const el = document.getElementById("proctoring-radar");
        if (el) el.scrollIntoView({ behavior: "smooth" });
      } else {
        setActiveNavTab("courses");
      }
    };
    handleHash();
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, []);

  const handleNavigateTab = (tabKey: string) => {
    setActiveNavTab(tabKey);
    if (tabKey === "courses") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (tabKey === "gradebook") {
      setShowGradebook(true);
    } else if (tabKey === "proctoring") {
      const el = document.getElementById("proctoring-radar");
      if (el) el.scrollIntoView({ behavior: "smooth" });
    }
  };

  // The courses this person teaches (every course, for an administrator), not everything they can see.
  const { courses, reload: refetchCourses } = useStaffCourses();

  const { user } = useAuth();

  // A link from a notification or email can ask for a tool, on a particular course (see lib/deeplink).
  useOpenIntent(!!user, {
    forum: (id) => { setFocusCourse(id); setShowForum(true); },
    live: (id) => { setFocusCourse(id); setShowLiveClasses(true); },
    grading: (id) => { setFocusCourse(id); setShowAssignmentGrading(true); },
    assessments: (id) => { setFocusCourse(id); setShowAssessments(true); },
    learners: (id) => { setFocusCourse(id); setShowRoster(true); },
    gradebook: (id) => { setFocusCourse(id); setShowGradebook(true); },
  });
  const canEditCourses = user?.role === "INSTRUCTOR";
  const { analytics, refetch: analyticsReload } = useCohortAnalytics();
  const proctoring = useApiData<{
    openAttempts: number;
    data: { id: string; student: string; quiz: string; eventType: string; severity: string; timestamp: string }[];
  }>("/api/v1/analytics/proctoring", { limit: 10 });
  const pending = useApiData<{
    total: number;
    data: { id: string; student: string; assignment: string; course: string; plagiarismScore: number | null }[];
  }>("/api/v1/analytics/pending-grading", { limit: 5 });
  const proctorLogs = proctoring.data?.data ?? [];

  return (
    <AppShell
      area="teacher"
      activeKey={activeNavTab}
      onNavigate={handleNavigateTab}
      actions={{
        builder: () => setShowCourseBuilder(true),
        grading: () => setShowAssignmentGrading(true),
        questionbank: () => setShowQuestionBank(true),
        live: () => setShowLiveClasses(true),
        forum: () => setShowForum(true),
        analytics: () => setShowAnalytics(true),
        lrs: () => setShowLrsStream(true),
      }}
    >

      <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8 space-y-8">
        {/* Teacher Header & Quick Actions */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-orchid/15 text-orchid border border-orchid/50 font-semibold">
                {user?.tenantName || "Faculty"}
              </span>
            </div>
            <h1 className="text-3xl font-extrabold text-ink tracking-tight">
              Faculty Command Center
            </h1>
            <p className="text-sm text-ink-muted">
              Welcome{user ? `, ${user.name}` : ""} • {courses.length} {courses.length === 1 ? "Course" : "Courses"}{analytics ? ` • ${plural(analytics.metrics.totalEnrolled, "Enrolment")}` : ""}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {canEditCourses && (
            <button
              onClick={() => setShowCourseBuilder(true)}
              className="px-4 py-2.5 bg-brand hover:bg-brand-hover text-on-brand rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-brand/20 transition-all"
            >
              <Plus className="h-4 w-4" />
              <span>Create course</span>
            </button>
            )}

            {canEditCourses && (
            <button
              onClick={() => setShowContentEditor(true)}
              className="px-4 py-2.5 bg-surface hover:bg-raised text-ink rounded-xl text-xs font-bold flex items-center gap-2 border border-line transition-colors"
            >
              <BookOpen className="h-4 w-4 text-brand-fg" />
              <span>Course Content</span>
            </button>
            )}

            <button
              onClick={() => setShowAssessments(true)}
              className="px-4 py-2.5 bg-surface hover:bg-raised text-ink rounded-xl text-xs font-bold flex items-center gap-2 border border-line transition-colors"
            >
              <ClipboardList className="h-4 w-4 text-accent" />
              <span>Quizzes &amp; Assignments</span>
            </button>

            <button
              onClick={() => setShowCalendar(true)}
              className="px-4 py-2.5 bg-surface hover:bg-raised text-ink rounded-xl text-xs font-bold flex items-center gap-2 border border-line transition-colors"
            >
              <CalendarDays className="h-4 w-4 text-orchid" />
              <span>Calendar Events</span>
            </button>

            <button
              onClick={() => setShowRoster(true)}
              className="px-4 py-2.5 bg-surface hover:bg-raised text-ink rounded-xl text-xs font-bold flex items-center gap-2 border border-line transition-colors"
            >
              <Users className="h-4 w-4 text-success" />
              <span>Learners</span>
            </button>

            <button
              onClick={() => setShowGradebook(true)}
              className="px-4 py-2.5 bg-surface hover:bg-raised text-ink rounded-xl text-xs font-bold flex items-center gap-2 border border-line transition-colors"
            >
              <FileCheck className="h-4 w-4 text-success" />
              <span>Gradebook</span>
            </button>

            <button
              onClick={() => setShowAssignmentGrading(true)}
              className="px-4 py-2.5 bg-surface hover:bg-raised text-ink rounded-xl text-xs font-bold flex items-center gap-2 border border-line transition-colors"
            >
              <ClipboardCheck className="h-4 w-4 text-brand-fg" />
              <span>Grade Assignments</span>
            </button>

            <button
              onClick={() => setShowQuestionBank(true)}
              className="px-4 py-2.5 bg-surface hover:bg-raised text-ink rounded-xl text-xs font-bold flex items-center gap-2 border border-line transition-colors"
            >
              <Library className="h-4 w-4 text-orchid" />
              <span>Question Bank</span>
            </button>

            <button
              onClick={() => setShowAnalytics(true)}
              className="px-4 py-2.5 bg-purple-600 hover:bg-purple-500 text-on-brand rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-purple-600/20 transition-all"
            >
              <BarChart2 className="h-4 w-4" />
              <span>Cohort Intelligence</span>
            </button>

            <button
              onClick={() => setShowLrsStream(true)}
              className="px-4 py-2.5 bg-surface hover:bg-raised text-ink rounded-xl text-xs font-bold flex items-center gap-2 border border-line transition-colors"
            >
              <Activity className="h-4 w-4 text-cyan-400" />
              <span>xAPI LRS Stream</span>
            </button>

            <button
              onClick={() => setShowForum(true)}
              className="px-4 py-2.5 bg-surface hover:bg-raised text-ink rounded-xl text-xs font-bold flex items-center gap-2 border border-line transition-colors"
            >
              <MessageSquare className="h-4 w-4 text-orchid" />
              <span>Course Q&A Forum</span>
            </button>

            <button
              onClick={() => setShowLiveClasses(true)}
              className="px-4 py-2.5 bg-rose-600 hover:bg-rose-500 text-on-brand rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-rose-600/20 transition-all"
            >
              <Video className="h-4 w-4" />
              <span>Live Classes</span>
            </button>
          </div>
        </div>

        <LiveNow />

        {/* Metric Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {[
            {
              label: "Enrolled Learners",
              value: analytics ? String(analytics.metrics.totalEnrolled) : "…",
              sub: analytics ? `${analytics.metrics.activeThisWeek} active this week` : "",
              icon: Users,
              color: "text-brand-fg",
            },
            {
              label: "Pending Submissions",
              value: pending.data ? String(pending.data.total) : "…",
              sub: "Waiting for a grade",
              icon: FileCheck,
              color: "text-success",
            },
            {
              label: "Open Proctored Attempts",
              value: proctoring.data ? String(proctoring.data.openAttempts) : "…",
              sub: "In progress right now",
              icon: ShieldAlert,
              color: "text-danger",
            },
            {
              label: "Completion Rate",
              value: analytics ? `${analytics.metrics.completionRate}%` : "…",
              sub: analytics ? `${plural(analytics.atRiskLearners.length, "learner")} at risk` : "",
              icon: TrendingUp,
              color: "text-orchid",
            },
          ].map((stat, idx) => {
            const Icon = stat.icon;
            return (
              <div key={idx} className="bg-surface border border-line rounded-2xl p-5 space-y-3 shadow-lg">
                <div className="flex items-center justify-between text-ink-muted">
                  <span className="text-xs font-semibold">{stat.label}</span>
                  <Icon className={`h-5 w-5 ${stat.color}`} />
                </div>
                <div>
                  <div className="text-2xl font-bold text-ink">{stat.value}</div>
                  <div className="text-[11px] text-ink-subtle mt-0.5">{stat.sub}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Two-Column Section: Active Proctoring Feed & Courses Taught */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Proctoring events reported by the quiz screen */}
          <div id="proctoring-radar" className="lg:col-span-2 bg-surface border border-line rounded-3xl p-6 space-y-5 shadow-xl scroll-mt-20">
            <div className="flex items-center justify-between border-b border-line pb-4">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-xl bg-danger/20 text-danger border border-danger/30 flex items-center justify-center">
                  <AlertTriangle className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-ink">Proctoring events</h3>
                  <p className="text-xs text-ink-muted">Integrity events reported by exam takers' browsers</p>
                </div>
              </div>

              <span className="text-xs text-success bg-success/10 border border-success/30 px-3 py-1 rounded-full font-medium flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                {proctoring.data?.openAttempts ?? 0} open attempt(s)
              </span>
            </div>

            <div className="space-y-3">
              {proctoring.isLoading && <p className="text-xs text-ink-subtle">Loading…</p>}
              {!proctoring.isLoading && proctorLogs.length === 0 && (
                <p className="text-xs text-ink-subtle p-6 text-center">No integrity events have been reported.</p>
              )}
              {proctorLogs.map((log) => (
                <div
                  key={log.id}
                  className="bg-canvas border border-line/90 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs hover:border-line transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <strong className="text-ink text-sm">{log.student}</strong>
                      <span className="text-ink-muted">({log.quiz})</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                          log.severity === "HIGH"
                            ? "bg-danger/10 text-danger border border-danger/30"
                            : log.severity === "MEDIUM"
                            ? "bg-accent/10 text-accent border border-accent/30"
                            : "bg-brand/15 text-brand-fg border border-brand/30"
                        }`}
                      >
                        {log.eventType.replace(/_/g, " ")}
                      </span>
                    </div>
                    <p className="text-ink-muted">Severity: {log.severity.toLowerCase()}</p>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-ink-subtle font-mono">{timeAgo(log.timestamp)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Grading & Courses Sidepanel */}
          <div className="space-y-6">
            <div className="bg-surface border border-line rounded-3xl p-6 space-y-4 shadow-xl">
              <div className="flex items-center justify-between border-b border-line pb-3">
                <h3 className="font-bold text-sm text-ink">Pending Submissions</h3>
                <span className="text-xs text-brand-fg font-semibold">{pending.data?.total ?? 0} to review</span>
              </div>

              <div className="space-y-3">
                {pending.data && pending.data.data.length === 0 && (
                  <p className="text-xs text-ink-subtle text-center p-4">Nothing is waiting for a grade.</p>
                )}
                {(pending.data?.data ?? []).map((s) => {
                  const flagged = (s.plagiarismScore ?? 0) >= 30;
                  return (
                    <div key={s.id} className="bg-canvas rounded-2xl p-3.5 border border-line/80 space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-ink">{s.student}</span>
                        {s.plagiarismScore !== null && (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${flagged ? "bg-danger/10 text-danger" : "bg-success/10 text-success"}`}>
                            {Math.round(s.plagiarismScore)}% match
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-ink-muted">
                        {s.assignment} <span className="text-ink-subtle">· {s.course}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Modals */}
      {showCourseBuilder && (
        <CourseBuilder
          onClose={() => setShowCourseBuilder(false)}
          onSave={async (draft) => {
            try {
              await createCourseWithCurriculum(draft);
            } finally {
              refetchCourses();
            }
          }}
        />
      )}

      {showContentEditor && <CourseContentEditor onClose={() => setShowContentEditor(false)} />}

      {showAssessments && <AssessmentManager initialCourseId={focusCourse} onClose={() => { setShowAssessments(false); pending.reload(); }} />}

      {showCalendar && <CalendarManager onClose={() => setShowCalendar(false)} />}

      {showRoster && (
        <CourseRoster
          initialCourseId={focusCourse}
          onClose={() => {
            setShowRoster(false);
            analyticsReload();
          }}
        />
      )}

      {showGradebook && (
        <CourseGradebook initialCourseId={focusCourse} onClose={() => setShowGradebook(false)} />
      )}

      {showQuestionBank && <QuestionBank onClose={() => setShowQuestionBank(false)} />}

      {showAssignmentGrading && <AssignmentGrading initialCourseId={focusCourse} onClose={() => { setShowAssignmentGrading(false); pending.reload(); }} />}

      {showLiveClasses && <LiveClasses initialCourseId={focusCourse} onClose={() => setShowLiveClasses(false)} />}

      {showForum && (
        <DiscussionForum
          courseId={focusCourse}
          onClose={() => setShowForum(false)}
        />
      )}

      {/* Faculty Cohort Analytics & Predictive At-Risk Radar */}
      {showAnalytics && (
        <FacultyAnalyticsModal
          onClose={() => setShowAnalytics(false)}
        />
      )}

      {/* xAPI Learning Record Store (LRS) Statement Stream */}
      {showLrsStream && (
        <LrsAnalyticsViewer
          onClose={() => setShowLrsStream(false)}
        />
      )}
    </AppShell>
  );
}
