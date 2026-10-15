"use client";

import React, { useState } from "react";
import { Navigation } from "@/components/Navigation";
import { QuizTaker } from "@/components/QuizTaker";
import { LiveNow } from "@/components/LiveNow";
import { CertificateVerification } from "@/components/CertificateVerification";
import { CodeSandbox } from "@/components/CodeSandbox";
import { CourseCatalog } from "@/components/CourseCatalog";
import { LessonPlayer } from "@/components/LessonPlayer";
import { AcademicCalendar } from "@/components/AcademicCalendar";
import { DiscussionForum } from "@/components/DiscussionForum";
import { GamificationHub } from "@/components/GamificationHub";
import { MyAssignments } from "@/components/MyAssignments";
import { useAuth } from "@/context/AuthContext";
import { AiTutorModal } from "@/components/AiTutorModal";
import {
  BookOpen,
  GraduationCap,
  Award,
  Video,
  Clock,
  Sparkles,
  PlayCircle,
  CheckCircle2,
  Calendar,
  FileCheck,
  TrendingUp,
  BarChart,
  ArrowRight,
  Flame,
  Code,
  Wifi,
  Search,
  MessageSquare,
  Brain,
} from "lucide-react";
import { useMyEnrollments, useEnrollmentStats } from "@/hooks/useEnrollments";
import { useGamification } from "@/hooks/useEngagement";
import { api } from "@/lib/api";
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
  const [activeCodingLab, setActiveCodingLab] = useState<string | null>(null);
  const [certificate, setCertificate] = useState<{ studentName: string; courseTitle: string; certificateId: string } | null>(null);
  const [showCourseCatalog, setShowCourseCatalog] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showForum, setShowForum] = useState(false);
  const [showGamificationHub, setShowGamificationHub] = useState(false);
  const [showAssignments, setShowAssignments] = useState(false);
  const { user } = useAuth();
  const [showAiTutor, setShowAiTutor] = useState(false);
  const [activeLessonCourse, setActiveLessonCourse] = useState<{
    code: string;
    title: string;
    progress: number;
  } | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const [activeNavTab, setActiveNavTab] = useState<string>("courses");

  // Sync tab with URL hash if provided
  React.useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash;
      if (hash === "#exams") {
        setActiveNavTab("exams");
        const el = document.getElementById("exams-section");
        if (el) el.scrollIntoView({ behavior: "smooth" });
      } else if (hash === "#badges") {
        setActiveNavTab("badges");
        setShowGamificationHub(true);
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
    } else if (tabKey === "exams") {
      const el = document.getElementById("exams-section");
      if (el) {
        el.scrollIntoView({ behavior: "smooth" });
      } else {
        const first = todo.data?.data.find((i) => i.type === "QUIZ");
        if (first) setActiveQuizId(first.id);
      }
    } else if (tabKey === "badges") {
      setShowGamificationHub(true);
    }
  };

  const { enrollments, isLoading: isLoadingEnrollments } = useMyEnrollments();
  const { stats } = useEnrollmentStats();
  const { state: gameState } = useGamification(null);

  const todo = useApiData<{ data: TodoItem[] }>("/api/v1/enrollments/todo");

  // Records a real xAPI statement about the signed-in learner and only reports success if the LRS accepted it.
  const triggerXApi = async (verb: string, target: string) => {
    if (!user) return;
    try {
      await api.post("/api/v1/xapi/statements", {
        actor: { mbox: `mailto:${user.email}`, name: user.name },
        verb: { id: "http://adlnet.gov/expapi/verbs/experienced", display: { "en-US": verb } },
        object: { id: `${window.location.origin}/xapi/activities/${encodeURIComponent(target.toLowerCase().replace(/\s+/g, "-"))}`, definition: { name: { "en-US": target } } },
      });
      setNotification(`Recorded in your learning record: you ${verb} ${target}.`);
      setTimeout(() => setNotification(null), 4000);
    } catch {
      /* the activity itself still works if the record could not be stored */
    }
  };

  const openExamFor = (courseCode: string) => {
    const quiz = todo.data?.data.find((i) => i.type === "QUIZ" && i.course.code === courseCode);
    if (quiz) {
      triggerXApi("started", quiz.title);
      setActiveQuizId(quiz.id);
    } else {
      setNotification("There is no exam to take in this course right now.");
      setTimeout(() => setNotification(null), 4000);
    }
  };

  const displayCourses = (enrollments ?? [])
    .filter((e) => e.status !== "DROPPED")
    .map((e) => ({
      id: e.courseId,
      code: e.course?.code ?? "",
      title: e.course?.title ?? "Course",
      progress: Math.round(e.progressPercent || 0),
      status: String(e.status).replace(/_/g, " ").toLowerCase(),
      finalGrade: e.finalGrade ?? null,
      certificateNumber: (e as any).certificate?.certificateNumber as string | undefined,
    }));

  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col">
      <Navigation
        currentRole="student"
        activeNavTab={activeNavTab}
        onNavigateTab={handleNavigateTab}
      />

      {/* xAPI Real-time Notification Banner */}
      {notification && (
        <div className="bg-brand/10 border-b border-brand/30 text-brand-fg px-6 py-2 text-xs flex items-center justify-center gap-2 animate-fadeIn">
          <Sparkles className="h-3.5 w-3.5 animate-pulse" />
          <span>{notification}</span>
        </div>
      )}

      <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8 space-y-8">
        {/* Welcome Banner with Streak & GPA */}
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
            {/* Streak Widget */}
            <button
              onClick={() => setShowGamificationHub(true)}
              className="bg-surface/80 hover:bg-raised/80 border border-line hover:border-accent/40 rounded-2xl p-4 flex items-center gap-3 shadow-lg transition-all text-left group w-full sm:w-auto"
            >
              <div className="h-10 w-10 rounded-xl bg-accent/20 text-accent flex items-center justify-center border border-accent/30 group-hover:scale-105 transition-transform">
                <Flame className="h-6 w-6" />
              </div>
              <div>
                <div className="text-xs text-ink-muted font-medium">Study Streak</div>
                <div className="text-lg font-bold text-ink flex items-center gap-1.5">
                  <span>{gameState?.streakDays ?? 0} Days</span>
                  <span className="text-[10px] text-accent">🔥</span>
                </div>
              </div>
            </button>

            {/* Assignments & average grade */}
            <button
              onClick={() => setShowAssignments(true)}
              className="bg-surface/80 hover:bg-raised/80 border border-line hover:border-success/40 rounded-2xl p-4 flex items-center gap-3 shadow-lg transition-all text-left group w-full sm:w-auto"
            >
              <div className="h-10 w-10 rounded-xl bg-success/20 text-success flex items-center justify-center border border-success/30 group-hover:scale-105 transition-transform">
                <Award className="h-6 w-6" />
              </div>
              <div>
                <div className="text-xs text-ink-muted font-medium">Assignments · Average grade</div>
                <div className="text-lg font-bold text-ink">{stats && stats.averageGrade ? `${Math.round(stats.averageGrade)}%` : "–"}</div>
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
                <h2 className="text-lg font-bold text-ink">My Enrolled Courses</h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setShowForum(true)}
                  className="px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink hover:text-ink rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm"
                >
                  <MessageSquare className="h-3.5 w-3.5 text-orchid" />
                  <span>Course Forum</span>
                </button>
                <button
                  onClick={() => setShowCalendar(true)}
                  className="px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink hover:text-ink rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm"
                >
                  <Calendar className="h-3.5 w-3.5 text-brand-fg" />
                  <span>Academic Calendar</span>
                </button>
                <button
                  onClick={() => setShowCourseCatalog(true)}
                  className="px-3 py-1.5 bg-brand hover:bg-brand-hover text-on-brand rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md shadow-brand/20 transition-all"
                >
                  <Search className="h-3.5 w-3.5" />
                  <span>Browse Catalog</span>
                </button>
                <button
                  onClick={() => setShowGamificationHub(true)}
                  className="text-xs font-semibold text-accent hover:text-accent flex items-center gap-1.5 px-2 py-1"
                >
                  <Award className="h-4 w-4" />
                  <span>Badges & XP</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {isLoadingEnrollments && <p className="text-xs text-ink-subtle">Loading your courses…</p>}
              {!isLoadingEnrollments && displayCourses.length === 0 && (
                <div className="md:col-span-2 text-center text-xs text-ink-muted bg-surface border border-line rounded-2xl p-10">
                  You are not enrolled in any course yet. Use <strong>Browse Catalog</strong> to find one.
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
                          code: course.code,
                          title: course.title,
                          progress: course.progress,
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
                        onClick={() => openExamFor(course.code)}
                        className="py-2.5 bg-canvas hover:bg-brand text-ink hover:text-on-brand rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border border-line hover:border-brand transition-all shadow-md"
                      >
                        <PlayCircle className="h-4 w-4" />
                        <span>Exam</span>
                      </button>

                      <button
                        onClick={() => setAssignmentsCourse(course.id)}
                        className="py-2.5 bg-canvas hover:bg-emerald-600 text-ink hover:text-on-brand rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border border-line hover:border-success transition-all shadow-md"
                      >
                        <FileCheck className="h-4 w-4 text-success" />
                        <span>Assignments</span>
                      </button>
                    </div>
                    {course.certificateNumber && (
                      <button
                        onClick={() => setCertificate({ studentName: user?.name ?? "", courseTitle: course.title, certificateId: course.certificateNumber! })}
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

          {/* Right Sidebar: Upcoming Deadlines & AI Tutor */}
          <div className="space-y-6">
            {/* Upcoming Schedule / Exams & Assignments */}
            <div id="exams-section" className="bg-surface border border-line rounded-2xl p-5 space-y-4 shadow-lg scroll-mt-20">
              <div className="flex items-center justify-between border-b border-line pb-3">
                <div className="flex items-center gap-2 text-sm font-bold text-ink">
                  <FileCheck className="h-4 w-4 text-brand-fg" />
                  <span>Assignments & Exams</span>
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
                      onClick={() => (quiz ? (triggerXApi("started", item.title), setActiveQuizId(item.id)) : setAssignmentsCourse(item.course.id))}
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

            {/* AI Learning Assistant */}
            <div className="bg-gradient-to-br from-brand/15 via-brand/10 to-surface border border-brand/30 rounded-2xl p-5 space-y-3 shadow-lg">
              <div className="flex items-center gap-2 text-brand-fg font-bold text-sm">
                <Sparkles className="h-4 w-4 text-brand-fg" />
                <span>AI Personalized Tutor</span>
              </div>
              <p className="text-xs text-ink leading-relaxed">
                Ask the tutor to explain a topic you are studying and it will walk you through it step by step, then give you a short practice drill.
              </p>
              <button
                onClick={() => {
                  triggerXApi("opened", "the AI tutor");
                  setShowAiTutor(true);
                }}
                className="w-full py-2.5 bg-gradient-to-r from-brand to-brand-hover hover:from-brand-hover hover:to-brand text-on-brand rounded-xl text-xs font-bold transition-all shadow-md shadow-brand/20 flex items-center justify-center gap-1.5"
              >
                <Brain className="h-4 w-4" />
                <span>Launch AI Socratic Tutor</span>
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Modals */}
      {activeQuizId && (
        <QuizTaker
          quizId={activeQuizId}
          onClose={() => { setActiveQuizId(null); todo.reload(); }}
        />
      )}

      {certificate && (
        <CertificateVerification
          studentName={certificate.studentName}
          courseTitle={certificate.courseTitle}
          certificateId={certificate.certificateId}
          onClose={() => setCertificate(null)}
        />
      )}

      {/* Interactive Cloud Coding Sandbox Modal */}
      {activeCodingLab && (
        <CodeSandbox
          assignmentTitle={activeCodingLab}
          onClose={() => setActiveCodingLab(null)}
          onSubmit={(score) => {
            triggerXApi(`submitted code lab with score ${score}%`, activeCodingLab);
          }}
        />
      )}

      {/* Course Catalog Modal */}
      {showCourseCatalog && (
        <CourseCatalog
          onClose={() => setShowCourseCatalog(false)}
          onEnrolled={(courseId) => {
            triggerXApi(`enrolled in course ${courseId}`, "Catalog");
          }}
        />
      )}

      {/* Interactive Lesson Curriculum Player Modal */}
      {activeLessonCourse && (
        <LessonPlayer
          courseCode={activeLessonCourse.code}
          courseTitle={activeLessonCourse.title}
          initialProgress={activeLessonCourse.progress}
          onClose={() => setActiveLessonCourse(null)}
          onProgressUpdated={(newPercent) => {
            triggerXApi(`advanced course progress to ${newPercent}%`, activeLessonCourse.title);
          }}
          onOpenExam={() => {
            openExamFor(activeLessonCourse.code);
            setActiveLessonCourse(null);
          }}
          onOpenCodeLab={() => {
            setActiveCodingLab(`${activeLessonCourse.code}: Distributed Lab`);
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
          courseCode="CS-101"
          onClose={() => setShowForum(false)}
        />
      )}

      {showAssignments && <MyAssignments onClose={() => setShowAssignments(false)} />}
      {assignmentsCourse && <MyAssignments courseId={assignmentsCourse} onClose={() => { setAssignmentsCourse(undefined); todo.reload(); }} />}

      {/* Gamification, Badges & XP Hub */}
      {showGamificationHub && (
        <GamificationHub
          onClose={() => setShowGamificationHub(false)}
        />
      )}

      {/* AI Socratic Academic Tutor Modal */}
      {showAiTutor && (
        <AiTutorModal
          courseTitle="Advanced Distributed Systems (CS-101)"
          initialTopic="Raft Consensus & Split-Brain Quorum"
          onClose={() => setShowAiTutor(false)}
          onDrillCompleted={(score, boost) => {
            triggerXApi(`completed adaptive drill with score ${score}% (+${boost}% readiness boost)`, "AI Tutor");
          }}
        />
      )}
    </div>
  );
}
