"use client";

import React, { useState } from "react";
import { Navigation } from "@/components/Navigation";
import { ScormQuizPlayer } from "@/components/ScormQuizPlayer";
import { LiveClassroom } from "@/components/LiveClassroom";
import { CertificateVerification } from "@/components/CertificateVerification";
import { CodeSandbox } from "@/components/CodeSandbox";
import { CourseCatalog } from "@/components/CourseCatalog";
import { LessonPlayer } from "@/components/LessonPlayer";
import { AcademicCalendar } from "@/components/AcademicCalendar";
import { DiscussionForum } from "@/components/DiscussionForum";
import { GamificationHub } from "@/components/GamificationHub";
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

export default function StudentDashboard() {
  const [activeQuizCourse, setActiveQuizCourse] = useState<string | null>(null);
  const [activeLiveClass, setActiveLiveClass] = useState<string | null>(null);
  const [activeCodingLab, setActiveCodingLab] = useState<string | null>(null);
  const [showCertificate, setShowCertificate] = useState(false);
  const [showCourseCatalog, setShowCourseCatalog] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showForum, setShowForum] = useState(false);
  const [showGamificationHub, setShowGamificationHub] = useState(false);
  const [showAiTutor, setShowAiTutor] = useState(false);
  const [activeLessonCourse, setActiveLessonCourse] = useState<{
    code: string;
    title: string;
    progress: number;
  } | null>(null);
  const [studyStreak, setStudyStreak] = useState(14);
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
        // Fallback: Launch the first exam
        setActiveQuizCourse("CS-101: Distributed Consensus Midterm");
      }
    } else if (tabKey === "badges") {
      setShowGamificationHub(true);
    }
  };

  const { enrollments, isLoading: isLoadingEnrollments } = useMyEnrollments();
  const { stats } = useEnrollmentStats();

  const triggerXApi = (verb: string, target: string) => {
    setNotification(`xAPI Statement: "Learner ${verb} ${target}" recorded in LRS.`);
    setTimeout(() => setNotification(null), 4000);
  };

  const enrolledCourses = [
    {
      code: "CS-101",
      title: "Advanced Distributed Systems & Microservices",
      instructor: "Prof. David Malan",
      progress: 78,
      nextLesson: "Module 4.2: Raft Consensus & Heartbeats",
      tag: "SCORM 2004",
      accent: "from-blue-600 to-indigo-600",
    },
    {
      code: "DS-201",
      title: "Enterprise Data Governance & FERPA Compliance",
      instructor: "Dr. Elena Rostova",
      progress: 45,
      nextLesson: "Module 2.1: Field-Level Encryption Protocols",
      tag: "xAPI / Cmi5",
      accent: "from-purple-600 to-pink-600",
    },
    {
      code: "AI-301",
      title: "Deep Learning Foundations & Neural Architectures",
      instructor: "Prof. Andrew Ng",
      progress: 92,
      nextLesson: "Module 6: Transformer Attention Mechanisms",
      tag: "LTI 1.3 Advantage",
      accent: "from-emerald-600 to-teal-600",
    },
  ];

  // Merge live backend enrollments with mock fallback
  const isLiveConnected = Boolean(enrollments && enrollments.length > 0);
  const displayCourses = isLiveConnected
    ? enrollments!.map((e, idx) => ({
        code: e.course?.code || `CRS-${idx + 1}`,
        title: e.course?.title || "Enrolled Course",
        instructor: "Assigned Faculty",
        progress: Math.round(e.progressPercent || 0),
        nextLesson: `Status: ${e.status.replace("_", " ")}`,
        tag: "PostgreSQL Live",
        accent: "from-blue-600 to-indigo-600",
      }))
    : enrolledCourses;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <Navigation
        currentRole="student"
        activeNavTab={activeNavTab}
        onNavigateTab={handleNavigateTab}
      />

      {/* xAPI Real-time Notification Banner */}
      {notification && (
        <div className="bg-blue-600/10 border-b border-blue-500/30 text-blue-400 px-6 py-2 text-xs flex items-center justify-center gap-2 animate-fadeIn">
          <Sparkles className="h-3.5 w-3.5 animate-pulse" />
          <span>{notification}</span>
        </div>
      )}

      <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8 space-y-8">
        {/* Welcome Banner with Streak & GPA */}
        <div className="bg-gradient-to-r from-blue-950/60 via-slate-900 to-indigo-950/60 border border-slate-800 rounded-3xl p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6 relative overflow-hidden shadow-2xl">
          <div className="space-y-2 z-10">
            <div className="flex items-center gap-2">
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-900/50 text-blue-300 border border-blue-700/50 font-semibold">
                Undergraduate Year 3
              </span>
              <span className="text-xs text-slate-400">Department of Computer Science</span>
            </div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">
              Welcome back, Alex!
            </h1>
            <p className="text-sm text-slate-300 max-w-xl">
              You are making stellar progress this semester. You have <strong>1 proctored exam</strong> scheduled for tomorrow and <strong>1 active live class</strong> in session.
            </p>
          </div>

          <div className="flex items-center gap-4 z-10">
            {/* Streak Widget */}
            <button
              onClick={() => setShowGamificationHub(true)}
              className="bg-slate-900/80 hover:bg-slate-800/80 border border-slate-800 hover:border-amber-500/40 rounded-2xl p-4 flex items-center gap-3 shadow-lg transition-all text-left group"
            >
              <div className="h-10 w-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30 group-hover:scale-105 transition-transform">
                <Flame className="h-6 w-6" />
              </div>
              <div>
                <div className="text-xs text-slate-400 font-medium">Study Streak</div>
                <div className="text-lg font-bold text-white flex items-center gap-1.5">
                  <span>{studyStreak} Days</span>
                  <span className="text-[10px] text-amber-400">🔥</span>
                </div>
              </div>
            </button>

            {/* GPA & Verified Badge */}
            <button
              onClick={() => setShowGamificationHub(true)}
              className="bg-slate-900/80 hover:bg-slate-800/80 border border-slate-800 hover:border-emerald-500/40 rounded-2xl p-4 flex items-center gap-3 shadow-lg transition-all text-left group"
            >
              <div className="h-10 w-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30 group-hover:scale-105 transition-transform">
                <Award className="h-6 w-6" />
              </div>
              <div>
                <div className="text-xs text-slate-400 font-medium">Cumulative GPA</div>
                <div className="text-lg font-bold text-white">3.92 / 4.0</div>
              </div>
            </button>
          </div>
        </div>

        {/* Live Lecture Banner */}
        <div className="bg-gradient-to-r from-rose-950/40 via-slate-900 to-slate-900 border border-rose-500/40 rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xl">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-2xl bg-rose-600 text-white flex items-center justify-center shadow-lg shadow-rose-600/30">
              <Video className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-rose-500 animate-ping" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-rose-400">Live WebRTC Session Active</span>
              </div>
              <h3 className="font-bold text-base text-white">CS-101: Distributed Consensus & Raft Protocol</h3>
              <p className="text-xs text-slate-400">Prof. David Malan • 128 Learners in room • Breakouts enabled</p>
            </div>
          </div>

          <button
            onClick={() => {
              triggerXApi("joined live lecture in", "CS-101");
              setActiveLiveClass("CS-101: Distributed Consensus");
            }}
            className="px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-rose-600/20 transition-all self-stretch sm:self-auto justify-center"
          >
            <Video className="h-4 w-4" />
            <span>Join Live Room</span>
          </button>
        </div>

        {/* Courses & Schedule Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Courses Column */}
          <div className="lg:col-span-2 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-blue-400" />
                <h2 className="text-lg font-bold text-white">My Enrolled Courses</h2>
                {isLiveConnected && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Live API
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setShowForum(true)}
                  className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm"
                >
                  <MessageSquare className="h-3.5 w-3.5 text-purple-400" />
                  <span>Course Forum</span>
                </button>
                <button
                  onClick={() => setShowCalendar(true)}
                  className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm"
                >
                  <Calendar className="h-3.5 w-3.5 text-blue-400" />
                  <span>Academic Calendar</span>
                </button>
                <button
                  onClick={() => setShowCourseCatalog(true)}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md shadow-blue-500/20 transition-all"
                >
                  <Search className="h-3.5 w-3.5" />
                  <span>Browse Catalog</span>
                </button>
                <button
                  onClick={() => setShowGamificationHub(true)}
                  className="text-xs font-semibold text-amber-400 hover:text-amber-300 flex items-center gap-1.5 px-2 py-1"
                >
                  <Award className="h-4 w-4" />
                  <span>Badges & XP</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {displayCourses.map((course) => (
                <div
                  key={course.code}
                  className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl p-5 flex flex-col justify-between transition-all group shadow-lg"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold px-2.5 py-0.5 rounded-lg bg-blue-900/50 text-blue-300 border border-blue-700/50">
                        {course.code}
                      </span>
                      <span className="text-[10px] text-slate-400 bg-slate-950 px-2 py-0.5 rounded-md border border-slate-800">
                        {course.tag}
                      </span>
                    </div>

                    <div>
                      <h3 className="font-bold text-base text-slate-100 group-hover:text-blue-400 transition-colors">
                        {course.title}
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">{course.instructor}</p>
                    </div>

                    <button
                      onClick={() =>
                        setActiveLessonCourse({
                          code: course.code,
                          title: course.title,
                          progress: course.progress,
                        })
                      }
                      className="w-full text-left bg-slate-950 hover:bg-slate-900 rounded-xl p-2.5 border border-slate-800/80 hover:border-blue-500/50 text-xs transition-colors group/les"
                    >
                      <div className="flex items-center justify-between text-[10px] text-slate-500 uppercase font-semibold">
                        <span>Continue Lesson</span>
                        <span className="text-blue-400 group-hover/les:translate-x-0.5 transition-transform flex items-center gap-0.5 font-bold">
                          Start →
                        </span>
                      </div>
                      <div className="text-slate-300 font-medium truncate mt-0.5">{course.nextLesson}</div>
                    </button>
                  </div>

                  <div className="pt-4 space-y-3">
                    <div>
                      <div className="flex justify-between text-xs mb-1 font-medium">
                        <span className="text-slate-400">Course Progress</span>
                        <span className="text-white">{course.progress}%</span>
                      </div>
                      <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
                        <div
                          className="bg-gradient-to-r from-blue-500 to-indigo-500 h-2 rounded-full transition-all"
                          style={{ width: `${course.progress}%` }}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => {
                          triggerXApi("launched proctored examination for", course.title);
                          setActiveQuizCourse(course.title);
                        }}
                        className="py-2.5 bg-slate-950 hover:bg-blue-600 text-slate-200 hover:text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border border-slate-800 hover:border-blue-500 transition-all shadow-md"
                      >
                        <PlayCircle className="h-4 w-4" />
                        <span>Exam</span>
                      </button>

                      <button
                        onClick={() => {
                          triggerXApi("opened interactive coding lab for", course.title);
                          setActiveCodingLab(`${course.code}: Distributed Quorum Engine Lab`);
                        }}
                        className="py-2.5 bg-slate-950 hover:bg-emerald-600 text-slate-200 hover:text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border border-slate-800 hover:border-emerald-500 transition-all shadow-md"
                      >
                        <Code className="h-4 w-4 text-emerald-400" />
                        <span>Code Lab</span>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right Sidebar: Upcoming Deadlines & AI Tutor */}
          <div className="space-y-6">
            {/* Upcoming Schedule / Exams & Assignments */}
            <div id="exams-section" className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg scroll-mt-20">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2 text-sm font-bold text-white">
                  <FileCheck className="h-4 w-4 text-blue-400" />
                  <span>Assignments & Exams</span>
                </div>
                <span className="text-[11px] text-slate-500">October 2026</span>
              </div>

              <div className="space-y-3">
                {[
                  {
                    title: "CS-101 Midterm Proctored Exam",
                    course: "Distributed Systems",
                    due: "Tomorrow, 2:00 PM",
                    type: "PROCTORED_EXAM",
                    action: () => {
                      triggerXApi("launched proctored examination for", "CS-101 Midterm");
                      setActiveQuizCourse("Advanced Distributed Systems: Proctored Midterm Exam");
                    },
                    badge: "bg-rose-950 text-rose-400 border-rose-800",
                    btnText: "Launch Exam",
                  },
                  {
                    title: "Lab 3: Zero-Trust Network Policies",
                    course: "Data Governance",
                    due: "Friday, 11:59 PM",
                    type: "ASSIGNMENT",
                    action: () => {
                      triggerXApi("opened interactive coding lab for", "Lab 3: Zero-Trust");
                      setActiveCodingLab("Lab 3: Zero-Trust Security Sandbox");
                    },
                    badge: "bg-blue-950 text-blue-400 border-blue-800",
                    btnText: "Open Lab",
                  },
                  {
                    title: "Transformer Architecture Quiz",
                    course: "Machine Learning",
                    due: "Sunday, 5:00 PM",
                    type: "QUIZ",
                    action: () => {
                      triggerXApi("launched quiz for", "Transformer Architecture");
                      setActiveQuizCourse("AI-301: Transformer Attention Architectures Quiz");
                    },
                    badge: "bg-purple-950 text-purple-400 border-purple-800",
                    btnText: "Start Quiz",
                  },
                ].map((item, idx) => (
                  <div
                    key={idx}
                    onClick={item.action}
                    className="p-3 bg-slate-950 hover:bg-slate-900/90 rounded-xl border border-slate-800/80 hover:border-blue-500/50 space-y-2 transition-all cursor-pointer group shadow-sm"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-200 group-hover:text-blue-400 transition-colors">
                        {item.title}
                      </span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${item.badge}`}>
                        {item.type.replace("_", " ")}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>{item.course}</span>
                      <span className="text-amber-400 font-medium">{item.due}</span>
                    </div>
                    <div className="flex items-center justify-end pt-1">
                      <span className="text-[11px] text-blue-400 group-hover:text-blue-300 font-bold flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                        {item.btnText} →
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* AI Learning Assistant */}
            <div className="bg-gradient-to-br from-blue-950/40 via-indigo-950/30 to-slate-900 border border-blue-800/40 rounded-2xl p-5 space-y-3 shadow-lg">
              <div className="flex items-center gap-2 text-blue-300 font-bold text-sm">
                <Sparkles className="h-4 w-4 text-blue-400" />
                <span>AI Personalized Tutor</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                "Hi Alex! Based on your recent quizzes in <em>Distributed Systems</em>, reviewing <strong>vector clocks</strong> and <strong>split-brain quorum</strong> will boost your midterm readiness by 18%."
              </p>
              <button
                onClick={() => {
                  triggerXApi("launched AI Socratic tutor in", "Distributed Systems");
                  setShowAiTutor(true);
                }}
                className="w-full py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-blue-500/20 flex items-center justify-center gap-1.5"
              >
                <Brain className="h-4 w-4" />
                <span>Launch AI Socratic Tutor</span>
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Modals */}
      {activeQuizCourse && (
        <ScormQuizPlayer
          courseTitle={activeQuizCourse}
          onClose={() => setActiveQuizCourse(null)}
          onComplete={(finalScore) => {
            triggerXApi(`completed ${activeQuizCourse} with score ${finalScore}%`, activeQuizCourse);
          }}
        />
      )}

      {activeLiveClass && (
        <LiveClassroom
          courseTitle={activeLiveClass}
          onClose={() => setActiveLiveClass(null)}
        />
      )}

      {showCertificate && (
        <CertificateVerification
          studentName="Alex Chen"
          courseTitle="Advanced Distributed Systems (CS-101)"
          certificateId="CERT-2026-HARV-8910"
          onClose={() => setShowCertificate(false)}
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
            setActiveQuizCourse(activeLessonCourse.title);
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

      {/* Gamification, Badges & XP Hub */}
      {showGamificationHub && (
        <GamificationHub
          streakDays={studyStreak}
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
