"use client";

import React, { useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { QuizTaker } from "@/components/QuizTaker";
import { LiveNow } from "@/components/LiveNow";
import { CertificateVerification } from "@/components/CertificateVerification";
import { CodeSandbox } from "@/components/CodeSandbox";
import { CourseCatalog } from "@/components/CourseCatalog";
import { LessonPlayer } from "@/components/LessonPlayer";
import { AcademicCalendar } from "@/components/AcademicCalendar";
import { DiscussionForum } from "@/components/DiscussionForum";
import { MyAssignments } from "@/components/MyAssignments";
import { MyGrades } from "@/components/MyGrades";
import { useAuth } from "@/context/AuthContext";
import { AiTutorModal } from "@/components/AiTutorModal";
import { useAiStatus } from "@/hooks/useAi";
import { BookOpen, Award, Sparkles, FileCheck, Search, MessageSquare, Brain } from "lucide-react";
import { useMyEnrollments, useEnrollmentStats } from "@/hooks/useEnrollments";
import { api } from "@/lib/api";
import { useOpenIntent } from "@/hooks/useOpenIntent";
import { useApiData } from "@/hooks/useApiData";

interface TodoItem {
  type: "ASSIGNMENT" | "QUIZ";
  id: string;
  title: string;
  course: { id: string; code: string; title: string };
  dueAt: string | null;
  overdue?: boolean;
  submitted?: boolean;
  requireProctoring?: boolean;
  attemptsRemaining?: number;
  hasOpenAttempt?: boolean;
}

export default function StudentDashboard() {
  const [activeQuizId, setActiveQuizId] = useState<string | null>(null);
  const [assignmentsCourse, setAssignmentsCourse] = useState<string | undefined>(undefined);
  const [activeCodingLab, setActiveCodingLab] = useState<{ title: string; instructions: string } | null>(null);
  const [certificate, setCertificate] = useState<string | null>(null);
  const [showCourseCatalog, setShowCourseCatalog] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [showCalendar, setShowCalendar] = useState(false);
  const [showForum, setShowForum] = useState(false);
  const [forumCourseId, setForumCourseId] = useState<string | null>(null);
  const [showAssignments, setShowAssignments] = useState(false);
  const { user } = useAuth();
  const [showAiTutor, setShowAiTutor] = useState(false);
  const [activeLessonCourse, setActiveLessonCourse] = useState<{
    id: string;
    code: string;
    title: string;
  } | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [activeNavTab, setActiveNavTab] = useState<string>("courses");

  // Sync tab with URL hash if provided
  React.useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash;
      if (hash === "#grades") {
        setActiveNavTab("grades");
      } else if (hash === "#exams") {
        setActiveNavTab("exams");
        const el = document.getElementById("exams-section");
        if (el) el.scrollIntoView({ behavior: "smooth" });
      } else {
        setActiveNavTab("courses");
      }
    };
    handleHash();
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, []);

  const openCatalog = (query: string) => {
    setCatalogQuery(query);
    setShowCourseCatalog(true);
  };

  const handleNavigateTab = (tabKey: string) => {
    setActiveNavTab(tabKey);
    if (tabKey === "courses" || tabKey === "grades") {
      window.history.replaceState(null, "", tabKey === "grades" ? "#grades" : window.location.pathname);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (tabKey === "exams") {
      const el = document.getElementById("exams-section");
      if (el) {
        el.scrollIntoView({ behavior: "smooth" });
      } else {
        const first = todo.data?.data.find((i) => i.type === "QUIZ");
        if (first) setActiveQuizId(first.id);
      }
    }
  };

  const { enrollments, isLoading: isLoadingEnrollments, refetch: refetchEnrollments } = useMyEnrollments();
  const { stats } = useEnrollmentStats();
  const ai = useAiStatus();

  const todo = useApiData<{ data: TodoItem[] }>("/api/v1/enrollments/todo");

  /** The next quiz this learner can take in a course, if any (from the to-do list). */
  const nextQuizIn = (courseId: string) => todo.data?.data.find((i) => i.type === "QUIZ" && i.course.id === courseId) ?? null;

  const leaveCourse = async (enrollmentId: string, title: string) => {
    setLeaveBusy(true);
    try {
      await api.delete(`/api/v1/enrollments/${enrollmentId}`);
      setNotification(`You left ${title}. Your progress is kept if you rejoin.`);
      setLeaving(null);
      await refetchEnrollments();
    } catch (e) {
      setNotification(e instanceof Error ? e.message : "Could not leave the course.");
    } finally {
      setLeaveBusy(false);
      setTimeout(() => setNotification(null), 6000);
    }
  };

  const displayCourses = (enrollments ?? [])
    .filter((e) => e.status !== "DROPPED")
    .map((e) => ({
      id: e.courseId,
      enrollmentId: e.id,
      open: e.status === "ENROLLED" || e.status === "IN_PROGRESS",
      code: e.course?.code ?? "",
      title: e.course?.title ?? "Course",
      progress: Math.round(e.progressPercent || 0),
      status: String(e.status).replace(/_/g, " ").toLowerCase(),
      finalGrade: e.finalGrade ?? null,
      certificateNumber: (e as any).certificate?.certificateNumber as string | undefined,
    }));

  // A link from a notification or email can ask for a panel (see lib/deeplink).
  useOpenIntent(!isLoadingEnrollments, {
    course: (id) => {
      const c = displayCourses.find((x) => x.id === id && x.open);
      if (c) setActiveLessonCourse({ id: c.id, code: c.code, title: c.title });
    },
    forum: (id) => {
      setForumCourseId(id);
      setShowForum(true);
    },
    assignments: (id) => {
      if (id && displayCourses.some((x) => x.id === id)) setAssignmentsCourse(id);
      else setShowAssignments(true);
    },
  });

  return (
    <AppShell
      area="student"
      activeKey={activeNavTab}
      onNavigate={handleNavigateTab}
      search={{ placeholder: "Search courses…", onSubmit: (q) => openCatalog(q) }}
      actions={{
        catalog: () => openCatalog(""),
        forum: () => setShowForum(true),
        calendar: () => setShowCalendar(true),
        ...(ai.enabled ? { tutor: () => setShowAiTutor(true) } : {}),
      }}
    >

      {notification && (
        <div role="status" className="bg-brand/10 border-b border-brand/30 text-ink px-6 py-2 text-xs text-center">
          {notification}
        </div>
      )}

      {activeNavTab === "grades" ? (
        <main className="flex-1 max-w-5xl w-full mx-auto p-6 md:p-8">
          <MyGrades onOpenAssignments={(id) => setAssignmentsCourse(id)} />
        </main>
      ) : (
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8 space-y-8">
        {/* Welcome banner */}
        <div className="bg-gradient-to-r from-brand/15 via-surface to-brand/10 border border-line rounded-3xl p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6 relative overflow-hidden shadow-2xl">
          <div className="space-y-2 z-10">
            <div className="flex items-center gap-2">
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-brand/15 text-brand-fg border border-brand/50 font-semibold">
                Student
              </span>
              <span className="text-xs text-ink-muted">{user?.tenantName}</span>
            </div>
            <h1 className="text-3xl font-extrabold text-ink tracking-tight">
              Welcome back{user ? `, ${user.name.split(" ")[0]}` : ""}!
            </h1>
            <p className="text-sm text-ink max-w-xl">
              {stats
                ? <>You have <strong>{stats.inProgress} course{stats.inProgress === 1 ? "" : "s"} in progress</strong> and <strong>{stats.completed} completed</strong>. Open your assignments to submit work and see feedback.</>
                : "Loading your progress…"}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 z-10 w-full md:w-auto">
            {/* Assignments & average grade */}
            <button
              onClick={() => setShowAssignments(true)}
              className="bg-surface/80 hover:bg-raised/80 border border-line hover:border-success/40 rounded-2xl p-4 flex items-center gap-3 shadow-lg transition-all text-left group w-full sm:w-auto"
            >
              <div className="h-10 w-10 rounded-xl bg-success/20 text-success flex items-center justify-center border border-success/30 group-hover:scale-105 transition-transform">
                <Award className="h-6 w-6" />
              </div>
              <div>
                <div className="text-xs text-ink-muted font-medium">Assignments and exams to do</div>
                <div className="text-lg font-bold text-ink">{todo.data ? todo.data.data.filter((i) => !i.submitted).length : "–"}</div>
              </div>
            </button>
          </div>
        </div>

        <LiveNow />

        {/* Courses & Schedule Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Courses Column */}
          <div className="lg:col-span-2 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-brand-fg" />
                <h2 className="text-lg font-bold text-ink">My courses</h2>
              </div>
              <button
                onClick={() => openCatalog("")}
                className="px-3 py-1.5 bg-brand hover:bg-brand-hover text-on-brand rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md shadow-brand/20"
              >
                <Search className="h-3.5 w-3.5" />
                <span>Browse catalogue</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {isLoadingEnrollments && <p className="text-xs text-ink-subtle">Loading your courses…</p>}
              {!isLoadingEnrollments && displayCourses.length === 0 && (
                <div className="md:col-span-2 text-center text-xs text-ink-muted bg-surface border border-line rounded-2xl p-10">
                  You are not enrolled in any course yet. Use <strong>Browse catalogue</strong> to find one.
                </div>
              )}
              {displayCourses.map((course) => (
                <div
                  key={course.id}
                  className="bg-surface border border-line hover:border-line rounded-2xl p-5 flex flex-col justify-between transition-all group shadow-lg"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold px-2.5 py-0.5 rounded-lg bg-brand/15 text-brand-fg border border-brand/50">
                        {course.code}
                      </span>
                      <span className="text-[10px] text-ink-muted bg-canvas px-2 py-0.5 rounded-md border border-line capitalize">
                        {course.status}
                      </span>
                    </div>

                    <div>
                      <h3 className="font-bold text-base text-ink group-hover:text-brand-fg transition-colors">
                        {course.title}
                      </h3>
                      {course.finalGrade !== null && <p className="text-xs text-success mt-0.5">Final grade: {Math.round(course.finalGrade)}%</p>}
                    </div>

                    <button
                      onClick={() =>
                        setActiveLessonCourse({
                          id: course.id,
                          code: course.code,
                          title: course.title,
                        })
                      }
                      className="w-full text-left bg-canvas hover:bg-surface rounded-xl p-2.5 border border-line/80 hover:border-brand/50 text-xs transition-colors group/les"
                    >
                      <div className="flex items-center justify-between text-[10px] text-ink-subtle uppercase font-semibold">
                        <span>Continue Lesson</span>
                        <span className="text-brand-fg group-hover/les:translate-x-0.5 transition-transform flex items-center gap-0.5 font-bold">
                          Start →
                        </span>
                      </div>
                      <div className="text-ink font-medium truncate mt-0.5">Open the course lessons</div>
                    </button>
                  </div>

                  <div className="pt-4 space-y-3">
                    <div>
                      <div className="flex justify-between text-xs mb-1 font-medium">
                        <span className="text-ink-muted">Course Progress</span>
                        <span className="text-ink">{course.progress}%</span>
                      </div>
                      <div className="w-full bg-canvas rounded-full h-2 overflow-hidden border border-line">
                        <div
                          className="bg-gradient-to-r from-brand to-brand-hover h-2 rounded-full transition-all"
                          style={{ width: `${course.progress}%` }}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => {
                          setForumCourseId(course.id);
                          setShowForum(true);
                        }}
                        className="py-2.5 bg-canvas hover:bg-raised text-ink rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border border-line transition-all"
                      >
                        <MessageSquare className="h-4 w-4 text-orchid" />
                        <span>Forum</span>
                      </button>

                      <button
                        onClick={() => setAssignmentsCourse(course.id)}
                        className="py-2.5 bg-canvas hover:bg-emerald-600 text-ink hover:text-on-brand rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border border-line hover:border-success transition-all shadow-md"
                      >
                        <FileCheck className="h-4 w-4 text-success" />
                        <span>Assignments</span>
                      </button>
                    </div>
                    {course.open &&
                      (leaving === course.enrollmentId ? (
                        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-xs">
                          <span className="text-ink">Leave {course.code}? You lose access to it, and your progress is kept if you rejoin.</span>
                          <button
                            onClick={() => leaveCourse(course.enrollmentId, course.title)}
                            disabled={leaveBusy}
                            className="rounded-lg bg-danger px-3 py-1 text-[11px] font-bold text-on-brand disabled:opacity-50"
                          >
                            {leaveBusy ? "Leaving…" : "Leave course"}
                          </button>
                          <button onClick={() => setLeaving(null)} className="rounded-lg border border-line bg-surface px-3 py-1 text-[11px] font-semibold text-ink">
                            Stay
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setLeaving(course.enrollmentId)} className="text-[11px] font-semibold text-ink-subtle underline-offset-2 hover:text-danger hover:underline" aria-label={`Leave ${course.code}`}>
                          Leave course
                        </button>
                      ))}
                    {course.certificateNumber && (
                      <button
                        onClick={() => setCertificate(course.certificateNumber!)}
                        className="w-full py-2 bg-accent/10 hover:bg-accent/10 text-accent border border-accent/30 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <Award className="h-4 w-4" />
                        <span>View certificate</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* To do and study tutor */}
          <div className="space-y-6">
            {/* Upcoming Schedule / Exams & Assignments */}
            <div id="exams-section" className="bg-surface border border-line rounded-2xl p-5 space-y-4 shadow-lg scroll-mt-20">
              <div className="flex items-center justify-between border-b border-line pb-3">
                <div className="flex items-center gap-2 text-sm font-bold text-ink">
                  <FileCheck className="h-4 w-4 text-brand-fg" />
                  <span>To do</span>
                </div>
                <span className="text-[11px] text-ink-subtle">{todo.data ? `${todo.data.data.length} to do` : ""}</span>
              </div>

              <div className="space-y-3">
                {todo.isLoading && <p className="text-xs text-ink-subtle">Loading…</p>}
                {todo.error && <p role="alert" className="text-xs text-danger">{todo.error}</p>}
                {todo.data && todo.data.data.length === 0 && <p className="text-xs text-ink-subtle text-center p-4">You are all caught up.</p>}
                {(todo.data?.data ?? []).map((item) => {
                  const quiz = item.type === "QUIZ";
                  return (
                    <button
                      key={`${item.type}-${item.id}`}
                      onClick={() => (quiz ? setActiveQuizId(item.id) : setAssignmentsCourse(item.course.id))}
                      className="w-full text-left p-3 bg-canvas hover:bg-surface/90 rounded-xl border border-line/80 hover:border-brand/50 space-y-2 transition-all group shadow-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-ink group-hover:text-brand-fg transition-colors">{item.title}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${quiz ? (item.requireProctoring ? "bg-danger/10 text-danger border-danger/30" : "bg-orchid/15 text-orchid border-orchid/30") : "bg-brand/15 text-brand-fg border-brand/30"}`}>
                          {quiz ? (item.requireProctoring ? "PROCTORED QUIZ" : "QUIZ") : "ASSIGNMENT"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-ink-muted">
                        <span>{item.course.code} · {item.course.title}</span>
                        <span className={item.overdue ? "text-danger font-medium" : "text-accent font-medium"}>
                          {item.submitted ? "Submitted" : item.overdue ? "Overdue" : item.dueAt ? `Due ${new Date(item.dueAt).toLocaleDateString()}` : quiz ? (item.hasOpenAttempt ? "In progress" : `${item.attemptsRemaining} attempt${item.attemptsRemaining === 1 ? "" : "s"} left`) : ""}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {ai.enabled && (
              <div className="bg-gradient-to-br from-brand/15 via-brand/10 to-surface border border-brand/30 rounded-2xl p-5 space-y-3 shadow-lg">
                <div className="flex items-center gap-2 text-brand-fg font-bold text-sm">
                  <Sparkles className="h-4 w-4 text-brand-fg" />
                  <span>Study tutor</span>
                </div>
                <p className="text-xs text-ink leading-relaxed">
                  Ask about anything in your courses. The tutor reads your lessons, explains step by step and can quiz you.
                </p>
                <button
                  onClick={() => setShowAiTutor(true)}
                  className="w-full py-2.5 bg-brand hover:bg-brand-hover text-on-brand rounded-xl text-xs font-bold transition-all shadow-md shadow-brand/20 flex items-center justify-center gap-1.5"
                >
                  <Brain className="h-4 w-4" />
                  <span>Ask the tutor</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
      )}

      {/* Modals */}
      {activeQuizId && (
        <QuizTaker
          quizId={activeQuizId}
          onClose={() => { setActiveQuizId(null); todo.reload(); }}
        />
      )}

      {certificate && (
        <CertificateVerification certificateNumber={certificate} onClose={() => setCertificate(null)} />
      )}

      {/* Interactive Cloud Coding Sandbox Modal */}
      {activeCodingLab && (
        <CodeSandbox title={activeCodingLab.title} instructions={activeCodingLab.instructions} onClose={() => setActiveCodingLab(null)} />
      )}

      {/* Course Catalog Modal */}
      {showCourseCatalog && (
        <CourseCatalog
          initialQuery={catalogQuery}
          onClose={() => setShowCourseCatalog(false)}
          onEnrolled={() => {
            refetchEnrollments();
            todo.reload();
          }}
        />
      )}

      {/* Interactive Lesson Curriculum Player Modal */}
      {activeLessonCourse && (
        <LessonPlayer
          courseId={activeLessonCourse.id}
          courseCode={activeLessonCourse.code}
          courseTitle={activeLessonCourse.title}
          onClose={() => {
            setActiveLessonCourse(null);
            refetchEnrollments();
          }}
          onOpenExam={
            nextQuizIn(activeLessonCourse.id)
              ? () => {
                  setActiveQuizId(nextQuizIn(activeLessonCourse.id)!.id);
                  setActiveLessonCourse(null);
                }
              : undefined
          }
          onOpenCodeLab={(lab) => {
            setActiveCodingLab({ title: `${activeLessonCourse.code}: ${lab.title}`, instructions: lab.instructions });
            setActiveLessonCourse(null);
          }}
        />
      )}

      {/* Academic Calendar Modal */}
      {showCalendar && (
        <AcademicCalendar
          onClose={() => setShowCalendar(false)}
        />
      )}

      {/* Course Collaboration Forum Modal */}
      {showForum && (
        <DiscussionForum
          courseCode={displayCourses[0]?.code}
          courseId={forumCourseId}
          onClose={() => {
            setShowForum(false);
            setForumCourseId(null);
          }}
        />
      )}

      {showAssignments && <MyAssignments onClose={() => setShowAssignments(false)} />}
      {assignmentsCourse && <MyAssignments courseId={assignmentsCourse} onClose={() => { setAssignmentsCourse(undefined); todo.reload(); }} />}

      {showAiTutor && (
        <AiTutorModal
          courses={displayCourses.filter((c) => c.open || c.status === "completed").map((c) => ({ id: c.id, code: c.code, title: c.title }))}
          onClose={() => setShowAiTutor(false)}
        />
      )}
    </AppShell>
  );
}
