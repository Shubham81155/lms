"use client";

import React, { useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { CourseBuilder } from "@/components/CourseBuilder";
import { CourseContentEditor } from "@/components/CourseContentEditor";
import { CourseSettings } from "@/components/CourseSettings";
import { CourseAnnouncements } from "@/components/CourseAnnouncements";
import { CourseRoster } from "@/components/CourseRoster";
import { useOpenIntent } from "@/hooks/useOpenIntent";
import { AssessmentManager } from "@/components/AssessmentManager";
import { CalendarManager } from "@/components/CalendarManager";
import { CourseGradebook } from "@/components/CourseGradebook";
import { QuestionBank } from "@/components/QuestionBank";
import { AssignmentGrading } from "@/components/AssignmentGrading";
import { LiveClasses } from "@/components/LiveClasses";
import { LiveNow } from "@/components/LiveNow";
import { StaffCourseList, type CourseTool } from "@/components/StaffCourseList";
import { Users, FileCheck, Plus, ShieldAlert, TrendingUp, ChevronRight } from "lucide-react";
import { createCourseWithCurriculum } from "@/hooks/useCourses";
import { DiscussionForum } from "@/components/DiscussionForum";
import { FacultyAnalyticsModal } from "@/components/FacultyAnalyticsModal";
import { useAuth } from "@/context/AuthContext";
import { useApiData } from "@/hooks/useApiData";
import { useCohortAnalytics } from "@/hooks/useAnalytics";
import { timeAgo } from "@/hooks/useNotifications";
import { plural } from "@/lib/plural";

/** Which dialog is open, and on which course. */
type Open = { tool: CourseTool | "builder" | "questionbank" | "analytics"; courseId: string | null } | null;

export default function TeacherDashboard() {
  const [open, setOpen] = useState<Open>(null);
  const [coursesVersion, setCoursesVersion] = useState(0);
  const { user } = useAuth();
  const show = (tool: NonNullable<Open>["tool"], courseId: string | null = null) => setOpen({ tool, courseId });
  const close = () => setOpen(null);

  // A link from a notification or email can ask for a tool, on a particular course (see lib/deeplink).
  useOpenIntent(!!user, {
    forum: (id) => show("forum", id),
    live: (id) => show("live", id),
    grading: (id) => show("grading", id),
    assessments: (id) => show("assessments", id),
    learners: (id) => show("learners", id),
    gradebook: (id) => show("gradebook", id),
    announcements: (id) => show("announcements", id),
  });

  const canEditCourses = user?.role === "INSTRUCTOR" || user?.role === "TENANT_ADMIN" || user?.role === "SUPER_ADMIN";
  const { analytics, refetch: analyticsReload } = useCohortAnalytics();
  const proctoring = useApiData<{
    openAttempts: number;
    data: { id: string; student: string; quiz: string; eventType: string; severity: string; timestamp: string }[];
  }>("/api/v1/analytics/proctoring", { limit: 5 });
  const pending = useApiData<{
    total: number;
    data: { id: string; student: string; assignment: string; course: string; courseId: string; plagiarismScore: number | null }[];
  }>("/api/v1/analytics/pending-grading", { limit: 6 });

  const onClose = (then?: () => void) => () => {
    close();
    then?.();
  };

  return (
    <AppShell
      area="teacher"
      activeKey="courses"
      onNavigate={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      actions={{
        builder: () => show("builder"),
        grading: () => show("grading"),
        questionbank: () => show("questionbank"),
        calendar: () => show("calendar"),
        analytics: () => show("analytics"),
      }}
    >
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8 space-y-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs text-ink-muted">{user?.tenantName}</p>
            <h1 className="text-3xl font-extrabold text-ink tracking-tight">Teaching</h1>
            <p className="text-sm text-ink-muted">
              Welcome{user ? `, ${user.name}` : ""}
              {analytics ? ` · ${plural(analytics.metrics.totalEnrolled, "enrolment")}` : ""}
            </p>
          </div>
          {user?.role === "INSTRUCTOR" && (
            <button
              onClick={() => show("builder")}
              className="self-start md:self-auto px-4 py-2.5 bg-brand hover:bg-brand-hover text-on-brand rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-brand/20"
            >
              <Plus className="h-4 w-4" />
              <span>Create course</span>
            </button>
          )}
        </div>

        <LiveNow />

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Learners", value: analytics ? String(analytics.metrics.totalEnrolled) : "…", sub: analytics ? `${analytics.metrics.activeThisWeek} active this week` : "", icon: Users, color: "text-brand-fg" },
            { label: "Waiting for a grade", value: pending.data ? String(pending.data.total) : "…", sub: "Assignment submissions", icon: FileCheck, color: "text-success" },
            { label: "At risk", value: analytics ? String(analytics.atRiskLearners.length) : "…", sub: "See learner analytics", icon: ShieldAlert, color: "text-danger" },
            { label: "Completion rate", value: analytics ? `${analytics.metrics.completionRate}%` : "…", sub: analytics ? `Average progress ${Math.round(analytics.metrics.averageProgress)}%` : "", icon: TrendingUp, color: "text-orchid" },
          ].map((stat) => {
            const Icon = stat.icon;
            return (
              <div key={stat.label} className="bg-surface border border-line rounded-2xl p-5 space-y-3">
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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <StaffCourseList
              title="My courses"
              canEdit={canEditCourses}
              tools={["content", "settings", "announcements", "learners", "assessments", "grading", "gradebook", "forum", "live"]}
              onOpen={(tool, id) => show(tool, id)}
              emptyText={user?.role === "INSTRUCTOR" ? "You do not teach any course yet. Create one, or ask an administrator to assign you." : "You are not assigned to any course yet."}
              refreshKey={coursesVersion}
            />
          </div>

          <div className="space-y-6">
            <section className="bg-surface border border-line rounded-2xl p-5 space-y-3" aria-labelledby="pending-h">
              <div className="flex items-center justify-between">
                <h3 id="pending-h" className="font-bold text-sm text-ink">Waiting for a grade</h3>
                {pending.data && pending.data.total > 0 && <span className="text-xs text-ink-muted">{pending.data.total}</span>}
              </div>
              {pending.data?.data.length === 0 && <p className="text-xs text-ink-subtle">Nothing is waiting for a grade.</p>}
              {(pending.data?.data ?? []).map((s) => {
                const flagged = (s.plagiarismScore ?? 0) >= 30;
                return (
                  <button
                    key={s.id}
                    onClick={() => show("grading", s.courseId)}
                    className="w-full text-left bg-canvas rounded-xl p-3 border border-line hover:border-brand/40 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-ink truncate">{s.student}</div>
                      <div className="text-[11px] text-ink-muted truncate">
                        {s.assignment} · {s.course}
                      </div>
                    </div>
                    {s.plagiarismScore !== null && (
                      <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded ${flagged ? "bg-danger/10 text-danger" : "bg-success/10 text-success"}`}>
                        {Math.round(s.plagiarismScore)}% match
                      </span>
                    )}
                    <ChevronRight className="h-4 w-4 shrink-0 text-ink-subtle" />
                  </button>
                );
              })}
            </section>

            <section className="bg-surface border border-line rounded-2xl p-5 space-y-3" aria-labelledby="proctoring-h">
              <div>
                <h3 id="proctoring-h" className="font-bold text-sm text-ink">Recent proctoring events</h3>
                <p className="text-[11px] text-ink-muted">
                  Reported by learners' browsers during proctored quizzes. {proctoring.data ? `${plural(proctoring.data.openAttempts, "attempt")} in progress.` : ""}
                </p>
              </div>
              {proctoring.data?.data.length === 0 && <p className="text-xs text-ink-subtle">No events reported.</p>}
              {(proctoring.data?.data ?? []).map((log) => (
                <div key={log.id} className="text-xs flex items-start justify-between gap-2 border-t border-line pt-2 first:border-0 first:pt-0">
                  <div className="min-w-0">
                    <div className="font-semibold text-ink truncate">{log.student}</div>
                    <div className="text-[11px] text-ink-muted truncate">
                      {log.eventType.replace(/_/g, " ").toLowerCase()} · {log.quiz}
                    </div>
                  </div>
                  <span className="shrink-0 text-[10px] text-ink-subtle">{timeAgo(log.timestamp)}</span>
                </div>
              ))}
            </section>
          </div>
        </div>
      </main>

      {open?.tool === "builder" && (
        <CourseBuilder
          onClose={close}
          onSave={async (draft) => {
            try {
              await createCourseWithCurriculum(draft);
            } finally {
              setCoursesVersion((v) => v + 1);
            }
          }}
        />
      )}
      {open?.tool === "content" && <CourseContentEditor initialCourseId={open.courseId} onClose={onClose(() => setCoursesVersion((v) => v + 1))} />}
      {open?.tool === "announcements" && open.courseId && <CourseAnnouncements courseId={open.courseId} canPost onClose={close} />}
      {open?.tool === "settings" && open.courseId && <CourseSettings courseId={open.courseId} onClose={close} onSaved={() => setCoursesVersion((v) => v + 1)} />}
      {open?.tool === "assessments" && <AssessmentManager initialCourseId={open.courseId} onClose={onClose(pending.reload)} />}
      {open?.tool === "calendar" && <CalendarManager onClose={close} />}
      {open?.tool === "learners" && <CourseRoster initialCourseId={open.courseId} onClose={onClose(() => { analyticsReload(); setCoursesVersion((v) => v + 1); })} />}
      {open?.tool === "gradebook" && <CourseGradebook initialCourseId={open.courseId} onClose={close} />}
      {open?.tool === "questionbank" && <QuestionBank onClose={close} />}
      {open?.tool === "grading" && <AssignmentGrading initialCourseId={open.courseId} onClose={onClose(pending.reload)} />}
      {open?.tool === "live" && <LiveClasses initialCourseId={open.courseId} onClose={close} />}
      {open?.tool === "forum" && <DiscussionForum courseId={open.courseId} onClose={close} />}
      {open?.tool === "analytics" && <FacultyAnalyticsModal onClose={close} />}
    </AppShell>
  );
}
