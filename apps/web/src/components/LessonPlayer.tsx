"use client";

import React, { useState } from "react";
import {
  X,
  CheckCircle2,
  PlayCircle,
  FileText,
  Code,
  Shield,
  ArrowRight,
  ArrowLeft,
  BookOpen,
  ChevronRight,
  Lock,
  Sparkles,
  Download,
  Award,
} from "lucide-react";
import { SecureVideoPlayer } from "./SecureVideoPlayer";
import { useUpdateProgress } from "@/hooks/useEnrollments";

interface LessonPlayerProps {
  courseCode: string;
  courseTitle: string;
  enrollmentId?: string;
  initialProgress?: number;
  onClose: () => void;
  onProgressUpdated?: (newPercent: number) => void;
  onOpenExam?: () => void;
  onOpenCodeLab?: () => void;
}

interface LessonItem {
  id: string;
  title: string;
  duration: string;
  type: "VIDEO" | "RICHTEXT" | "CODE" | "DOCUMENT";
  isCompleted: boolean;
  content: string;
}

interface ModuleSection {
  id: string;
  title: string;
  lessons: LessonItem[];
}

export const LessonPlayer: React.FC<LessonPlayerProps> = ({
  courseCode,
  courseTitle,
  enrollmentId = "enr_demo_01",
  initialProgress = 78,
  onClose,
  onProgressUpdated,
  onOpenExam,
  onOpenCodeLab,
}) => {
  const [modules, setModules] = useState<ModuleSection[]>([
    {
      id: "mod_1",
      title: "Module 1: Foundations of Distributed Consensus",
      lessons: [
        {
          id: "les_1_1",
          title: "1.1 The Byzantine Generals Problem & Fault Tolerance",
          duration: "18 min",
          type: "VIDEO",
          isCompleted: true,
          content: "In distributed computing, achieving consensus among independent nodes in the presence of arbitrary failures (Byzantine faults) requires at least 3f + 1 nodes to tolerate f faulty or malicious actors.",
        },
        {
          id: "les_1_2",
          title: "1.2 Safety vs. Liveness Properties in Asynchronous Networks",
          duration: "25 min",
          type: "RICHTEXT",
          isCompleted: true,
          content: "The FLP Impossibility Theorem (Fischer, Lynch, Paterson, 1985) establishes that no deterministic asynchronous algorithm can guarantee consensus if even a single node is subject to unannounced crash failure.",
        },
      ],
    },
    {
      id: "mod_2",
      title: "Module 2: Raft Consensus Protocol in Production",
      lessons: [
        {
          id: "les_2_1",
          title: "2.1 Leader Election, Randomized Timers & Heartbeats",
          duration: "30 min",
          type: "VIDEO",
          isCompleted: true,
          content: "Raft structures consensus around an elected leader. Nodes transition between Follower, Candidate, and Leader states. Randomized election timeouts (150-300ms) prevent split-vote scenarios.",
        },
        {
          id: "les_2_2",
          title: "2.2 Log Replication & Quorum Commitment",
          duration: "40 min",
          type: "CODE",
          isCompleted: false,
          content: "A log entry is committed once replicated across a strict majority (quorum) of nodes. The leader maintains matchIndex and nextIndex for every follower.",
        },
      ],
    },
    {
      id: "mod_3",
      title: "Module 3: Zero-Trust Network Policies & Data Security",
      lessons: [
        {
          id: "les_3_1",
          title: "3.1 Field-Level Encryption & Mutual TLS Handshakes",
          duration: "35 min",
          type: "DOCUMENT",
          isCompleted: false,
          content: "Enterprise architectures must enforce mTLS using Ephemeral Elliptic Curve Diffie-Hellman keys and AES-256-GCM authenticated encryption for all student PII under FERPA regulatory mandates.",
        },
        {
          id: "les_3_2",
          title: "3.2 Dynamic Forensic Watermarking & Screen Capture Protection",
          duration: "20 min",
          type: "VIDEO",
          isCompleted: false,
          content: "To deter illicit lecture sharing and academic integrity leaks, videos embed dynamic floating forensic watermarks containing the student's unique institutional ID and timestamp.",
        },
      ],
    },
  ]);

  const [activeLessonId, setActiveLessonId] = useState<string>("les_2_2");
  const [showSecureVideoModal, setShowSecureVideoModal] = useState(false);
  const { updateProgress } = useUpdateProgress();

  // Find active lesson and module
  const currentLesson =
    modules.flatMap((m) => m.lessons).find((l) => l.id === activeLessonId) ||
    modules[0].lessons[0];

  const totalLessons = modules.flatMap((m) => m.lessons).length;
  const completedLessons = modules.flatMap((m) => m.lessons).filter((l) => l.isCompleted).length;
  const calculatedProgress = Math.round((completedLessons / totalLessons) * 100);

  const handleToggleComplete = async () => {
    const updated = modules.map((mod) => ({
      ...mod,
      lessons: mod.lessons.map((les) =>
        les.id === activeLessonId ? { ...les, isCompleted: !les.isCompleted } : les
      ),
    }));

    setModules(updated);

    const newCompleted = updated.flatMap((m) => m.lessons).filter((l) => l.isCompleted).length;
    const newPercent = Math.round((newCompleted / totalLessons) * 100);

    try {
      await updateProgress(enrollmentId, newPercent);
    } catch (e) {
      // Local fallback
    }

    if (onProgressUpdated) onProgressUpdated(newPercent);
  };

  const handleNextLesson = () => {
    const all = modules.flatMap((m) => m.lessons);
    const currIndex = all.findIndex((l) => l.id === activeLessonId);
    if (currIndex < all.length - 1) {
      setActiveLessonId(all[currIndex + 1].id);
    }
  };

  const handlePrevLesson = () => {
    const all = modules.flatMap((m) => m.lessons);
    const currIndex = all.findIndex((l) => l.id === activeLessonId);
    if (currIndex > 0) {
      setActiveLessonId(all[currIndex - 1].id);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-canvas/90 backdrop-blur-md flex items-center justify-center p-3 md:p-6">
      <div className="bg-surface border border-line rounded-3xl w-full max-w-6xl h-[92vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Top Navbar */}
        <div className="bg-canvas border-b border-line px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold px-2.5 py-0.5 rounded-lg bg-brand/15 text-brand-fg border border-brand/50">
              {courseCode}
            </span>
            <div>
              <h3 className="font-bold text-sm text-ink line-clamp-1">{courseTitle}</h3>
              <p className="text-[11px] text-ink-muted">
                {completedLessons} of {totalLessons} Lessons Completed ({calculatedProgress}%)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Progress Pill */}
            <div className="hidden sm:flex items-center gap-2">
              <div className="w-28 bg-surface rounded-full h-2 overflow-hidden border border-line">
                <div
                  className="bg-gradient-to-r from-brand to-brand-hover h-2 rounded-full transition-all duration-500"
                  style={{ width: `${calculatedProgress}%` }}
                />
              </div>
              <span className="text-xs font-bold text-ink">{calculatedProgress}%</span>
            </div>

            <button
              onClick={onClose}
              className="h-8 w-8 rounded-xl bg-surface hover:bg-raised border border-line flex items-center justify-center text-ink-muted hover:text-ink transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content & Sidebar Grid */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Main Lesson Body Left */}
          <div className="flex-1 p-6 md:p-8 overflow-y-auto space-y-6 flex flex-col justify-between">
            <div className="space-y-6">
              {/* Lesson Title & Type Badge */}
              <div className="flex items-center justify-between border-b border-line pb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-brand/15 text-brand-fg border border-brand/30">
                      {currentLesson.type}
                    </span>
                    <span className="text-xs text-ink-muted">Duration: {currentLesson.duration}</span>
                  </div>
                  <h2 className="text-xl font-extrabold text-ink">{currentLesson.title}</h2>
                </div>

                <button
                  onClick={handleToggleComplete}
                  className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${
                    currentLesson.isCompleted
                      ? "bg-success/10 text-success border border-success/30"
                      : "bg-brand hover:bg-brand-hover text-on-brand shadow-md shadow-brand/20"
                  }`}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>{currentLesson.isCompleted ? "Marked as Done" : "Mark as Complete"}</span>
                </button>
              </div>

              {/* Lesson Media / Body Content Display */}
              {currentLesson.type === "VIDEO" && (
                <div className="space-y-4">
                  <div className="relative rounded-2xl overflow-hidden border border-line bg-canvas aspect-video flex flex-col items-center justify-center p-6 text-center shadow-xl">
                    <div className="h-16 w-16 rounded-full bg-brand/30 border border-brand/50 flex items-center justify-center text-brand-fg mb-4 animate-pulse">
                      <PlayCircle className="h-8 w-8" />
                    </div>
                    <h4 className="font-bold text-base text-ink">{currentLesson.title}</h4>
                    <p className="text-xs text-ink-muted max-w-md mt-1">
                      Adaptive HLS / DRM-protected stream with dynamic anti-piracy forensic watermarking.
                    </p>
                    <button
                      onClick={() => setShowSecureVideoModal(true)}
                      className="mt-4 px-5 py-2.5 bg-brand hover:bg-brand-hover text-on-brand rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-brand/30 transition-all"
                    >
                      <PlayCircle className="h-4 w-4" />
                      <span>Launch Secure Video Player</span>
                    </button>
                  </div>

                  <div className="bg-canvas border border-line rounded-2xl p-5 space-y-2">
                    <h5 className="font-bold text-xs uppercase tracking-wider text-ink">
                      Lecture Summary & Key Concepts
                    </h5>
                    <p className="text-xs text-ink leading-relaxed">{currentLesson.content}</p>
                  </div>
                </div>
              )}

              {currentLesson.type === "RICHTEXT" && (
                <div className="bg-canvas border border-line rounded-2xl p-6 md:p-8 space-y-4 shadow-xl">
                  <h3 className="font-bold text-base text-ink">Academic Deep Dive</h3>
                  <p className="text-sm text-ink leading-relaxed">{currentLesson.content}</p>

                  <div className="bg-brand/15 border border-brand/30 p-4 rounded-xl text-xs text-brand-fg space-y-1">
                    <strong className="block text-ink">Core Architectural Takeaway:</strong>
                    <span>
                      FLP impossibility does not imply distributed algorithms cannot make progress in practice; it simply implies partial synchrony assumptions or randomized consensus oracles (such as Paxos or Raft) are mandatory for termination.
                    </span>
                  </div>
                </div>
              )}

              {currentLesson.type === "CODE" && (
                <div className="space-y-4">
                  <div className="bg-canvas border border-line rounded-2xl p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-success font-bold text-sm">
                        <Code className="h-5 w-5" />
                        <span>Interactive Hands-On Lab</span>
                      </div>
                      <span className="text-[11px] text-ink-muted font-mono">Environment: Node.js / V8 Sandbox</span>
                    </div>

                    <p className="text-xs text-ink">{currentLesson.content}</p>

                    <div className="bg-surface border border-line rounded-xl p-4 font-mono text-xs text-ink">
                      <code>
                        {`// Target Exercise: Implement Raft Split-Brain Quorum Check
function hasMajorityQuorum(clusterSize, respondingNodes) {
  const majorityNeeded = Math.floor(clusterSize / 2) + 1;
  return respondingNodes >= majorityNeeded;
}`}
                      </code>
                    </div>

                    {onOpenCodeLab && (
                      <button
                        onClick={onOpenCodeLab}
                        className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-on-brand rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-500/20 transition-all"
                      >
                        <Code className="h-4 w-4" />
                        <span>Launch In-Browser Code Sandbox</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {currentLesson.type === "DOCUMENT" && (
                <div className="bg-canvas border border-line rounded-2xl p-6 space-y-4">
                  <div className="flex items-center justify-between border-b border-line pb-3">
                    <div className="flex items-center gap-2 text-orchid font-bold text-sm">
                      <FileText className="h-5 w-5" />
                      <span>Regulatory Standards Reference Document</span>
                    </div>
                    <button
                      onClick={() => alert("Downloading PDF documentation package...")}
                      className="text-xs text-brand-fg hover:text-brand-fg flex items-center gap-1 font-semibold"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>Download PDF</span>
                    </button>
                  </div>
                  <p className="text-xs text-ink leading-relaxed">{currentLesson.content}</p>
                </div>
              )}
            </div>

            {/* Bottom Lesson Navigation Bar */}
            <div className="pt-6 border-t border-line flex items-center justify-between">
              <button
                onClick={handlePrevLesson}
                className="px-4 py-2 bg-canvas hover:bg-raised border border-line text-ink rounded-xl text-xs font-bold flex items-center gap-2 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Previous Lesson</span>
              </button>

              <button
                onClick={handleNextLesson}
                className="px-5 py-2.5 bg-brand hover:bg-brand-hover text-on-brand rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-brand/20 transition-all"
              >
                <span>Next Lesson</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Module & Lesson Syllabus Sidebar Right */}
          <div className="w-full md:w-80 border-t md:border-t-0 md:border-l border-line bg-canvas/60 overflow-y-auto p-4 space-y-5">
            <div>
              <h4 className="font-bold text-xs uppercase tracking-wider text-ink-muted mb-1">
                Course Syllabus
              </h4>
              <p className="text-[11px] text-ink-subtle">Select any lesson to navigate</p>
            </div>

            <div className="space-y-4">
              {modules.map((module) => (
                <div key={module.id} className="space-y-2">
                  <h5 className="font-bold text-xs text-ink">{module.title}</h5>
                  <div className="space-y-1">
                    {module.lessons.map((lesson) => {
                      const isActive = lesson.id === activeLessonId;
                      return (
                        <button
                          key={lesson.id}
                          onClick={() => setActiveLessonId(lesson.id)}
                          className={`w-full text-left p-2.5 rounded-xl text-xs transition-all flex items-center justify-between ${
                            isActive
                              ? "bg-brand/20 text-brand-fg border border-brand/40"
                              : "text-ink-muted hover:text-ink hover:bg-surface"
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0 pr-2">
                            {lesson.isCompleted ? (
                              <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                            ) : (
                              <PlayCircle className="h-4 w-4 text-ink-subtle shrink-0" />
                            )}
                            <span className="truncate">{lesson.title}</span>
                          </div>
                          <span className="text-[10px] text-ink-subtle shrink-0">{lesson.duration}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Quick Exam / Lab launcher in sidebar */}
            <div className="pt-4 border-t border-line space-y-2">
              <h5 className="text-[10px] font-bold text-ink-subtle uppercase tracking-wider">
                Module Assessments
              </h5>
              {onOpenExam && (
                <button
                  onClick={onOpenExam}
                  className="w-full py-2 bg-surface hover:bg-brand text-ink hover:text-on-brand rounded-xl text-xs font-bold transition-all border border-line flex items-center justify-center gap-1.5"
                >
                  <Award className="h-3.5 w-3.5 text-accent" />
                  <span>Launch Proctored Quiz</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Embedded Secure Video Player Modal */}
      {showSecureVideoModal && (
        <SecureVideoPlayer
          lessonTitle={currentLesson.title}
          studentEmail="alex.chen@harvard.edu"
          onClose={() => setShowSecureVideoModal(false)}
        />
      )}
    </div>
  );
};
