"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  X,
  CheckCircle2,
  PlayCircle,
  FileText,
  Code,
  ArrowRight,
  ArrowLeft,
  ExternalLink,
  Award,
} from "lucide-react";
import { SecureVideoPlayer } from "./SecureVideoPlayer";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { errorMessage, useApiData } from "@/hooks/useApiData";

interface LessonPlayerProps {
  courseId: string;
  courseCode: string;
  courseTitle: string;
  onClose: () => void;
  /** Called with the new course percentage after a lesson is recorded as finished. */
  onProgressUpdated?: (newPercent: number) => void;
  onOpenExam?: () => void;
  onOpenCodeLab?: (lesson: { title: string; instructions: string }) => void;
}

interface Lesson {
  id: string;
  title: string;
  contentType: "RICHTEXT" | "VIDEO" | "SCORM_PACKAGE" | "PDF_DOCUMENT" | "INTERACTIVE_CODE" | "EXTERNAL_LTI_TOOL";
  bodyContent: string | null;
  mediaUrl: string | null;
  ltiToolLaunchUrl: string | null;
  estimatedMinutes: number;
}

interface CourseModule {
  id: string;
  title: string;
  lessons: Lesson[];
}

interface ProgressResponse {
  data: { completedLessonIds: string[]; totalLessons: number; progressPercent: number };
}

const TYPE_LABEL: Record<Lesson["contentType"], string> = {
  RICHTEXT: "Reading",
  VIDEO: "Video",
  SCORM_PACKAGE: "SCORM module",
  PDF_DOCUMENT: "Document",
  INTERACTIVE_CODE: "Code lab",
  EXTERNAL_LTI_TOOL: "External tool",
};

const NoContent: React.FC = () => (
  <p className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-xs text-ink-muted">
    Your instructor has not added content to this lesson yet.
  </p>
);

export const LessonPlayer: React.FC<LessonPlayerProps> = ({
  courseId,
  courseCode,
  courseTitle,
  onClose,
  onProgressUpdated,
  onOpenExam,
  onOpenCodeLab,
}) => {
  const { user } = useAuth();
  const modulesReq = useApiData<{ data: CourseModule[] }>(`/api/v1/courses/${courseId}/modules`);
  const progressReq = useApiData<ProgressResponse>(`/api/v1/courses/${courseId}/progress`);

  const modules = modulesReq.data?.data ?? [];
  const lessons = useMemo(() => modules.flatMap((m) => m.lessons), [modules]);

  const [done, setDone] = useState<Set<string>>(new Set());
  const [percent, setPercent] = useState(0);
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showSecureVideoModal, setShowSecureVideoModal] = useState(false);

  useEffect(() => {
    const p = progressReq.data?.data;
    if (!p) return;
    setDone(new Set(p.completedLessonIds));
    setPercent(p.progressPercent);
  }, [progressReq.data]);

  // Open on the first lesson that is not finished yet, else the first lesson.
  useEffect(() => {
    const finished = progressReq.data?.data.completedLessonIds;
    if (activeLessonId || lessons.length === 0 || !finished) return;
    setActiveLessonId((lessons.find((l) => !finished.includes(l.id)) ?? lessons[0]).id);
  }, [lessons, progressReq.data, activeLessonId]);

  const isLoading = modulesReq.isLoading || progressReq.isLoading;
  const loadError = modulesReq.error ?? progressReq.error;
  const current = lessons.find((l) => l.id === activeLessonId) ?? null;
  const index = current ? lessons.indexOf(current) : -1;
  const isDone = !!current && done.has(current.id);

  const markComplete = async () => {
    if (!current || isDone || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api.post<{ data: { progressPercent: number } }>(`/api/v1/courses/${courseId}/lessons/${current.id}/complete`, {});
      setDone((d) => new Set(d).add(current.id));
      setPercent(res.data.progressPercent);
      onProgressUpdated?.(res.data.progressPercent);
    } catch (e) {
      setSaveError(errorMessage(e, "Could not record this lesson."));
    } finally {
      setSaving(false);
    }
  };

  const go = (delta: number) => {
    const next = lessons[index + delta];
    if (next) {
      setActiveLessonId(next.id);
      setSaveError(null);
    }
  };

  const body = (lesson: Lesson) => {
    const text = lesson.bodyContent?.trim();
    const link = lesson.contentType === "EXTERNAL_LTI_TOOL" ? lesson.ltiToolLaunchUrl : lesson.mediaUrl;
    const paragraphs = text ? text.split(/\n{2,}/) : [];
    const textBlock = paragraphs.length > 0 && (
      <div className="space-y-3 rounded-2xl border border-line bg-canvas p-6 md:p-8">
        {paragraphs.map((p, i) => (
          <p key={i} className="whitespace-pre-line text-sm leading-relaxed text-ink">
            {p}
          </p>
        ))}
      </div>
    );

    if (lesson.contentType === "VIDEO") {
      return (
        <div className="space-y-4">
          {lesson.mediaUrl ? (
            <div className="flex aspect-video flex-col items-center justify-center rounded-2xl border border-line bg-canvas p-6 text-center">
              <PlayCircle className="mb-3 h-10 w-10 text-brand-fg" />
              <h4 className="text-base font-bold text-ink">{lesson.title}</h4>
              <button
                onClick={() => setShowSecureVideoModal(true)}
                className="mt-4 flex items-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-xs font-bold text-on-brand shadow-lg shadow-brand/30 transition-all hover:bg-brand-hover"
              >
                <PlayCircle className="h-4 w-4" />
                <span>Play video</span>
              </button>
            </div>
          ) : (
            !textBlock && <NoContent />
          )}
          {textBlock}
        </div>
      );
    }

    if (lesson.contentType === "INTERACTIVE_CODE") {
      return (
        <div className="space-y-4">
          {textBlock}
          {onOpenCodeLab && (
            <button
              onClick={() => onOpenCodeLab({ title: lesson.title, instructions: lesson.bodyContent ?? "" })}
              className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-on-brand shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-500"
            >
              <Code className="h-4 w-4" />
              <span>Open the code sandbox</span>
            </button>
          )}
          {!textBlock && !onOpenCodeLab && <NoContent />}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {textBlock}
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-xs font-bold text-ink transition-colors hover:bg-raised"
          >
            {lesson.contentType === "PDF_DOCUMENT" ? <FileText className="h-4 w-4 text-orchid" /> : <ExternalLink className="h-4 w-4 text-brand-fg" />}
            <span>{lesson.contentType === "PDF_DOCUMENT" ? "Open the document" : "Open in a new tab"}</span>
          </a>
        )}
        {!textBlock && !link && <NoContent />}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/90 p-3 backdrop-blur-md md:p-6" role="dialog" aria-modal="true" aria-label="Lesson player">
      <div className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-line bg-canvas px-6 py-3.5">
          <div className="flex items-center gap-3">
            <span className="rounded-lg border border-brand/50 bg-brand/15 px-2.5 py-0.5 text-xs font-bold text-brand-fg">{courseCode}</span>
            <div>
              <h3 className="line-clamp-1 text-sm font-bold text-ink">{courseTitle}</h3>
              <p className="text-[11px] text-ink-muted">
                {isLoading || loadError ? "" : `${done.size} of ${lessons.length} lessons completed (${percent}%)`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden items-center gap-2 sm:flex">
              <div className="h-2 w-28 overflow-hidden rounded-full border border-line bg-surface">
                <div className="h-2 rounded-full bg-gradient-to-r from-brand to-brand-hover transition-all duration-500" style={{ width: `${percent}%` }} />
              </div>
              <span className="text-xs font-bold text-ink">{percent}%</span>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-line bg-surface text-ink-muted transition-colors hover:bg-raised hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {isLoading ? (
          <p role="status" className="py-24 text-center text-xs text-ink-muted">
            Loading the course…
          </p>
        ) : loadError ? (
          <div role="alert" className="mx-auto mt-16 max-w-md rounded-2xl border border-danger/30 bg-danger/10 p-6 text-center">
            <p className="text-sm font-bold text-danger">Could not load this course</p>
            <p className="mt-1.5 text-xs text-ink-muted">{loadError}</p>
            <button
              onClick={() => {
                modulesReq.reload();
                progressReq.reload();
              }}
              className="mt-4 rounded-xl border border-line bg-surface px-3.5 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-raised"
            >
              Try again
            </button>
          </div>
        ) : lessons.length === 0 ? (
          <div className="mx-auto mt-16 max-w-md rounded-2xl border border-dashed border-line px-6 py-12 text-center">
            <p className="text-sm font-bold text-ink">No lessons yet</p>
            <p className="mt-1.5 text-xs text-ink-muted">This course has no lessons so far. Check back once your instructor adds some.</p>
          </div>
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
            <div className="flex flex-1 flex-col justify-between space-y-6 overflow-y-auto p-6 md:p-8">
              {current && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between gap-4 border-b border-line pb-4">
                    <div>
                      <div className="mb-1.5 flex items-center gap-2">
                        <span className="rounded border border-brand/30 bg-brand/15 px-2 py-0.5 text-[10px] font-bold text-brand-fg">{TYPE_LABEL[current.contentType]}</span>
                        <span className="text-xs text-ink-muted">About {current.estimatedMinutes} min</span>
                      </div>
                      <h2 className="text-xl font-extrabold text-ink">{current.title}</h2>
                    </div>

                    <button
                      onClick={markComplete}
                      disabled={isDone || saving}
                      className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                        isDone ? "border border-success/30 bg-success/10 text-success" : "bg-brand text-on-brand shadow-md shadow-brand/20 hover:bg-brand-hover disabled:opacity-60"
                      }`}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      <span>{isDone ? "Completed" : saving ? "Saving…" : "Mark as complete"}</span>
                    </button>
                  </div>

                  {saveError && (
                    <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-2.5 text-xs font-semibold text-danger">
                      {saveError}
                    </p>
                  )}

                  {body(current)}
                </div>
              )}

              <div className="flex items-center justify-between border-t border-line pt-6">
                <button
                  onClick={() => go(-1)}
                  disabled={index <= 0}
                  className="flex items-center gap-2 rounded-xl border border-line bg-canvas px-4 py-2 text-xs font-bold text-ink transition-colors hover:bg-raised disabled:opacity-40"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span>Previous lesson</span>
                </button>
                <button
                  onClick={() => go(1)}
                  disabled={index < 0 || index >= lessons.length - 1}
                  className="flex items-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-xs font-bold text-on-brand shadow-lg shadow-brand/20 transition-all hover:bg-brand-hover disabled:opacity-40"
                >
                  <span>Next lesson</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="w-full space-y-5 overflow-y-auto border-t border-line bg-canvas/60 p-4 md:w-80 md:border-l md:border-t-0">
              <div>
                <h4 className="mb-1 text-xs font-bold uppercase tracking-wider text-ink-muted">Course syllabus</h4>
                <p className="text-[11px] text-ink-subtle">Select any lesson to open it</p>
              </div>

              <div className="space-y-4">
                {modules.map((module) => (
                  <div key={module.id} className="space-y-2">
                    <h5 className="text-xs font-bold text-ink">{module.title}</h5>
                    {module.lessons.length === 0 && <p className="text-[11px] text-ink-subtle">No lessons in this module yet.</p>}
                    <div className="space-y-1">
                      {module.lessons.map((lesson) => (
                        <button
                          key={lesson.id}
                          onClick={() => {
                            setActiveLessonId(lesson.id);
                            setSaveError(null);
                          }}
                          aria-current={lesson.id === activeLessonId}
                          className={`flex w-full items-center justify-between rounded-xl p-2.5 text-left text-xs transition-all ${
                            lesson.id === activeLessonId ? "border border-brand/40 bg-brand/20 text-brand-fg" : "text-ink-muted hover:bg-surface hover:text-ink"
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-2 pr-2">
                            {done.has(lesson.id) ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" /> : <PlayCircle className="h-4 w-4 shrink-0 text-ink-subtle" />}
                            <span className="truncate">{lesson.title}</span>
                          </div>
                          <span className="shrink-0 text-[10px] text-ink-subtle">{lesson.estimatedMinutes} min</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {onOpenExam && (
                <div className="space-y-2 border-t border-line pt-4">
                  <h5 className="text-[10px] font-bold uppercase tracking-wider text-ink-subtle">Assessments</h5>
                  <button
                    onClick={onOpenExam}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-line bg-surface py-2 text-xs font-bold text-ink transition-all hover:bg-brand hover:text-on-brand"
                  >
                    <Award className="h-3.5 w-3.5 text-accent" />
                    <span>Take the exam</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {showSecureVideoModal && current && (
        <SecureVideoPlayer lessonTitle={current.title} studentEmail={user?.email} onClose={() => setShowSecureVideoModal(false)} />
      )}
    </div>
  );
};
