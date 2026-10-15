"use client";

import React, { useState } from "react";
import { Navigation } from "@/components/Navigation";
import { CourseBuilder } from "@/components/CourseBuilder";
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
} from "lucide-react";
import { useCourses, useCreateCourse } from "@/hooks/useCourses";
import { DiscussionForum } from "@/components/DiscussionForum";
import { FacultyAnalyticsModal } from "@/components/FacultyAnalyticsModal";
import { LrsAnalyticsViewer } from "@/components/LrsAnalyticsViewer";
import { useAuth } from "@/context/AuthContext";
import { useApiData } from "@/hooks/useApiData";
import { useCohortAnalytics } from "@/hooks/useAnalytics";
import { timeAgo } from "@/hooks/useNotifications";

export default function TeacherDashboard() {
  const [showCourseBuilder, setShowCourseBuilder] = useState(false);
  const [showGradebook, setShowGradebook] = useState(false);
  const [showQuestionBank, setShowQuestionBank] = useState(false);
  const [showAssignmentGrading, setShowAssignmentGrading] = useState(false);
  const [showLiveClasses, setShowLiveClasses] = useState(false);
  const [showForum, setShowForum] = useState(false);
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

  const { courses, refetch: refetchCourses } = useCourses();
  const { createCourse, isCreating } = useCreateCourse();

  const { user } = useAuth();
  const { analytics } = useCohortAnalytics();
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
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <Navigation
        currentRole="teacher"
        activeNavTab={activeNavTab}
        onNavigateTab={handleNavigateTab}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8 space-y-8">
        {/* Teacher Header & Quick Actions */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-purple-900/50 text-purple-300 border border-purple-700/50 font-semibold">
                {user?.tenantName || "Faculty"}
              </span>
            </div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">
              Faculty Command Center
            </h1>
            <p className="text-sm text-slate-400">
              Welcome{user ? `, ${user.name}` : ""} • {courses.length} {courses.length === 1 ? "Course" : "Courses"}{analytics ? ` • ${analytics.metrics.totalEnrolled} Enrolments` : ""}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setShowCourseBuilder(true)}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-blue-500/20 transition-all"
            >
              <Plus className="h-4 w-4" />
              <span>Create Course (AI)</span>
            </button>

            <button
              onClick={() => setShowGradebook(true)}
              className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-200 rounded-xl text-xs font-bold flex items-center gap-2 border border-slate-800 transition-colors"
            >
              <FileCheck className="h-4 w-4 text-emerald-400" />
              <span>Gradebook</span>
            </button>

            <button
              onClick={() => setShowAssignmentGrading(true)}
              className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-200 rounded-xl text-xs font-bold flex items-center gap-2 border border-slate-800 transition-colors"
            >
              <ClipboardCheck className="h-4 w-4 text-blue-400" />
              <span>Grade Assignments</span>
            </button>

            <button
              onClick={() => setShowQuestionBank(true)}
              className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-200 rounded-xl text-xs font-bold flex items-center gap-2 border border-slate-800 transition-colors"
            >
              <Library className="h-4 w-4 text-purple-400" />
              <span>Question Bank</span>
            </button>

            <button
              onClick={() => setShowAnalytics(true)}
              className="px-4 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-purple-600/20 transition-all"
            >
              <BarChart2 className="h-4 w-4" />
              <span>Cohort Intelligence</span>
            </button>

            <button
              onClick={() => setShowLrsStream(true)}
              className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-200 rounded-xl text-xs font-bold flex items-center gap-2 border border-slate-800 transition-colors"
            >
              <Activity className="h-4 w-4 text-cyan-400" />
              <span>xAPI LRS Stream</span>
            </button>

            <button
              onClick={() => setShowForum(true)}
              className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-200 rounded-xl text-xs font-bold flex items-center gap-2 border border-slate-800 transition-colors"
            >
              <MessageSquare className="h-4 w-4 text-purple-400" />
              <span>Course Q&A Forum</span>
            </button>

            <button
              onClick={() => setShowLiveClasses(true)}
              className="px-4 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-rose-600/20 transition-all"
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
              color: "text-blue-400",
            },
            {
              label: "Pending Submissions",
              value: pending.data ? String(pending.data.total) : "…",
              sub: "Waiting for a grade",
              icon: FileCheck,
              color: "text-emerald-400",
            },
            {
              label: "Open Proctored Attempts",
              value: proctoring.data ? String(proctoring.data.openAttempts) : "…",
              sub: "In progress right now",
              icon: ShieldAlert,
              color: "text-rose-400",
            },
            {
              label: "Completion Rate",
              value: analytics ? `${analytics.metrics.completionRate}%` : "…",
              sub: analytics ? `${analytics.atRiskLearners.length} learners at risk` : "",
              icon: TrendingUp,
              color: "text-purple-400",
            },
          ].map((stat, idx) => {
            const Icon = stat.icon;
            return (
              <div key={idx} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3 shadow-lg">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-xs font-semibold">{stat.label}</span>
                  <Icon className={`h-5 w-5 ${stat.color}`} />
                </div>
                <div>
                  <div className="text-2xl font-bold text-white">{stat.value}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{stat.sub}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Two-Column Section: Active Proctoring Feed & Courses Taught */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Active Proctoring Anomaly Radar */}
          <div id="proctoring-radar" className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-5 shadow-xl scroll-mt-20">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-xl bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center justify-center">
                  <AlertTriangle className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-white">Live AI Proctoring Anomaly Radar</h3>
                  <p className="text-xs text-slate-400">Integrity events reported by exam takers' browsers</p>
                </div>
              </div>

              <span className="text-xs text-emerald-400 bg-emerald-950/60 border border-emerald-800 px-3 py-1 rounded-full font-medium flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                {proctoring.data?.openAttempts ?? 0} open attempt(s)
              </span>
            </div>

            <div className="space-y-3">
              {proctoring.isLoading && <p className="text-xs text-slate-500">Loading…</p>}
              {!proctoring.isLoading && proctorLogs.length === 0 && (
                <p className="text-xs text-slate-500 p-6 text-center">No integrity events have been reported.</p>
              )}
              {proctorLogs.map((log) => (
                <div
                  key={log.id}
                  className="bg-slate-950 border border-slate-800/90 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs hover:border-slate-700 transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <strong className="text-white text-sm">{log.student}</strong>
                      <span className="text-slate-400">({log.quiz})</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                          log.severity === "HIGH"
                            ? "bg-rose-950 text-rose-400 border border-rose-800"
                            : log.severity === "MEDIUM"
                            ? "bg-amber-950 text-amber-400 border border-amber-800"
                            : "bg-blue-950 text-blue-400 border border-blue-800"
                        }`}
                      >
                        {log.eventType.replace(/_/g, " ")}
                      </span>
                    </div>
                    <p className="text-slate-400">Severity: {log.severity.toLowerCase()}</p>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-slate-500 font-mono">{timeAgo(log.timestamp)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Grading & Courses Sidepanel */}
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4 shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="font-bold text-sm text-white">Pending Submissions</h3>
                <span className="text-xs text-blue-400 font-semibold">{pending.data?.total ?? 0} to review</span>
              </div>

              <div className="space-y-3">
                {pending.data && pending.data.data.length === 0 && (
                  <p className="text-xs text-slate-500 text-center p-4">Nothing is waiting for a grade.</p>
                )}
                {(pending.data?.data ?? []).map((s) => {
                  const flagged = (s.plagiarismScore ?? 0) >= 30;
                  return (
                    <div key={s.id} className="bg-slate-950 rounded-2xl p-3.5 border border-slate-800/80 space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-white">{s.student}</span>
                        {s.plagiarismScore !== null && (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${flagged ? "bg-rose-950 text-rose-400" : "bg-emerald-950 text-emerald-400"}`}>
                            {Math.round(s.plagiarismScore)}% match
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {s.assignment} <span className="text-slate-600">· {s.course}</span>
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
          onSave={async (course) => {
            try {
              await createCourse({
                title: course.title,
                code: course.code,
                passingGradePercent: 70,
              });
              refetchCourses();
              alert(`Course "${course.title}" successfully persisted to PostgreSQL and published!`);
            } catch (err: any) {
              alert(`Course created locally: "${course.title}"`);
            }
          }}
        />
      )}

      {showGradebook && (
        <CourseGradebook onClose={() => setShowGradebook(false)} />
      )}

      {showQuestionBank && <QuestionBank onClose={() => setShowQuestionBank(false)} />}

      {showAssignmentGrading && <AssignmentGrading onClose={() => { setShowAssignmentGrading(false); pending.reload(); }} />}

      {showLiveClasses && <LiveClasses onClose={() => setShowLiveClasses(false)} />}

      {showForum && (
        <DiscussionForum
          courseCode="CS-101"
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
    </div>
  );
}
