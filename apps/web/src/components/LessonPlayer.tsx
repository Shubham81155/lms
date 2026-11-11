'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { errorMessage, useApiData } from '@/hooks/useApiData';
import { useLocale } from '@/lib/i18n';
import { CourseHome } from './course/lesson/CourseHome';
import { LessonBody } from './course/lesson/LessonBody';
import { LessonSidebar } from './course/lesson/LessonSidebar';
import {
  TYPE_LABEL,
  type Completion,
  type CourseDetail,
  type CourseModule,
  type LessonPlayerProps,
  type ProgressResponse,
  type UpcomingWork,
} from './course/lesson/types';

export type { UpcomingWork };

export const LessonPlayer: React.FC<LessonPlayerProps> = ({
  courseId,
  courseCode,
  courseTitle,
  onClose,
  onProgressUpdated,
  onOpenExam,
  onOpenCodeLab,
  startOn = 'lesson',
  upcoming = [],
  onOpenWork,
}) => {
  const { user } = useAuth();
  const { t } = useLocale();
  const [view, setView] = useState<'home' | 'lesson'>(startOn);
  const courseReq = useApiData<{ data: CourseDetail }>(`/api/v1/courses/${courseId}`);
  const modulesReq = useApiData<{ data: CourseModule[] }>(`/api/v1/courses/${courseId}/modules`);
  const progressReq = useApiData<ProgressResponse>(`/api/v1/courses/${courseId}/progress`);

  const modules = useMemo(() => modulesReq.data?.data ?? [], [modulesReq.data]);
  const lessons = useMemo(() => modules.flatMap((m) => m.lessons), [modules]);

  const [done, setDone] = useState<Set<string>>(new Set());
  const [percent, setPercent] = useState(0);
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** Where the course stands after the last lesson recorded in this session. */
  const [completion, setCompletion] = useState<Completion | null>(null);

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
  const nextLesson = lessons.find((l) => !done.has(l.id)) ?? null;
  const openLesson = (id: string) => {
    setActiveLessonId(id);
    setSaveError(null);
    setView('lesson');
  };

  const markComplete = async () => {
    if (!current || isDone || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api.post<{ data: { progressPercent: number; completion: Completion } }>(
        `/api/v1/courses/${courseId}/lessons/${current.id}/complete`,
        {}
      );
      setDone((d) => new Set(d).add(current.id));
      setPercent(res.data.progressPercent);
      setCompletion(res.data.completion);
      onProgressUpdated?.(res.data.progressPercent);
    } catch (e) {
      setSaveError(errorMessage(e, t('learn.lesson.saveFailed')));
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

  /** A SCORM package reported completion: the API has recorded the lesson, so catch up with its progress. */
  const scormCompleted = async (lessonId: string) => {
    setDone((d) => new Set(d).add(lessonId));
    try {
      const res = await api.get<ProgressResponse>(`/api/v1/courses/${courseId}/progress`);
      setDone(new Set(res.data.completedLessonIds));
      setPercent(res.data.progressPercent);
      onProgressUpdated?.(res.data.progressPercent);
    } catch {
      /* the next visit shows it */
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/90 p-3 backdrop-blur-md md:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={t('learn.lesson.dialog')}
    >
      <div className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-line bg-canvas px-6 py-3.5">
          <div className="flex items-center gap-3">
            <span className="rounded-lg border border-brand/50 bg-brand/15 px-2.5 py-0.5 text-xs font-bold text-brand-fg">
              {courseCode}
            </span>
            <div>
              <h3 className="line-clamp-1 text-sm font-bold text-ink">{courseTitle}</h3>
              <p className="text-[11px] text-ink-muted">
                {isLoading || loadError ? '' : t.plural('learn.lesson.completedSummary', lessons.length, { done: done.size, percent })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden items-center gap-2 sm:flex">
              <div className="h-2 w-28 overflow-hidden rounded-full border border-line bg-surface">
                <div
                  className="h-2 rounded-full bg-gradient-to-r from-brand to-brand-hover transition-all duration-500"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <span className="text-xs font-bold text-ink">{percent}%</span>
            </div>
            <button
              onClick={onClose}
              aria-label={t('common.close')}
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-line bg-surface text-ink-muted transition-colors hover:bg-raised hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {isLoading ? (
          <p role="status" className="py-24 text-center text-xs text-ink-muted">
            {t('learn.lesson.loadingCourse')}
          </p>
        ) : loadError ? (
          <div role="alert" className="mx-auto mt-16 max-w-md rounded-2xl border border-danger/30 bg-danger/10 p-6 text-center">
            <p className="text-sm font-bold text-danger">{t('learn.lesson.loadFailed')}</p>
            <p className="mt-1.5 text-xs text-ink-muted">{loadError}</p>
            <button
              onClick={() => {
                modulesReq.reload();
                progressReq.reload();
              }}
              className="mt-4 rounded-xl border border-line bg-surface px-3.5 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-raised"
            >
              {t('learn.lesson.tryAgain')}
            </button>
          </div>
        ) : lessons.length === 0 ? (
          <div className="mx-auto mt-16 max-w-md rounded-2xl border border-dashed border-line px-6 py-12 text-center">
            <p className="text-sm font-bold text-ink">{t('learn.lesson.emptyTitle')}</p>
            <p className="mt-1.5 text-xs text-ink-muted">{t('learn.lesson.emptyBody')}</p>
          </div>
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
            <div className="flex flex-1 flex-col justify-between space-y-6 overflow-y-auto p-6 md:p-8">
              {view === 'home' ? (
                <CourseHome
                  detail={courseReq.data?.data ?? null}
                  detailError={courseReq.error}
                  completed={done.size}
                  total={lessons.length}
                  next={nextLesson}
                  first={lessons[0]}
                  upcoming={upcoming}
                  onOpenLesson={openLesson}
                  onOpenWork={onOpenWork}
                />
              ) : (
                current && (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between gap-4 border-b border-line pb-4">
                      <div>
                        <div className="mb-1.5 flex items-center gap-2">
                          <span className="rounded border border-brand/30 bg-brand/15 px-2 py-0.5 text-[10px] font-bold text-brand-fg">
                            {t.dyn(`learn.lesson.type.${current.contentType}`, TYPE_LABEL[current.contentType])}
                          </span>
                          <span className="text-xs text-ink-muted">
                            {t('learn.lesson.aboutMinutes', { minutes: current.estimatedMinutes })}
                          </span>
                        </div>
                        <h2 className="text-xl font-extrabold text-ink">{current.title}</h2>
                      </div>

                      {current.contentType === 'SCORM_PACKAGE' ? (
                        <span
                          className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold ${isDone ? 'border border-success/30 bg-success/10 text-success' : 'text-ink-muted'}`}
                        >
                          {isDone && <CheckCircle2 className="h-4 w-4" />}
                          <span>{isDone ? t('learn.lesson.completed') : t('learn.lesson.completesWhen')}</span>
                        </span>
                      ) : (
                        <button
                          onClick={markComplete}
                          disabled={isDone || saving}
                          className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                            isDone
                              ? 'border border-success/30 bg-success/10 text-success'
                              : 'bg-brand text-on-brand shadow-md shadow-brand/20 hover:bg-brand-hover disabled:opacity-60'
                          }`}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          <span>
                            {isDone ? t('learn.lesson.completed') : saving ? t('learn.lesson.saving') : t('learn.lesson.markComplete')}
                          </span>
                        </button>
                      )}
                    </div>

                    {lessons.length > 0 && done.size === lessons.length && (
                      <p
                        role="status"
                        className="rounded-xl border border-success/30 bg-success/10 px-4 py-2.5 text-xs font-semibold text-success"
                      >
                        {completion === 'COMPLETED'
                          ? t('learn.lesson.done.COMPLETED')
                          : completion === 'AWAITING_GRADE'
                            ? t('learn.lesson.done.AWAITING_GRADE')
                            : completion === 'BELOW_PASS_MARK' || completion === 'FAILED'
                              ? t('learn.lesson.done.BELOW_PASS_MARK')
                              : t('learn.lesson.done.default')}
                      </p>
                    )}

                    {saveError && (
                      <p
                        role="alert"
                        className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-2.5 text-xs font-semibold text-danger"
                      >
                        {saveError}
                      </p>
                    )}

                    <LessonBody lesson={current} userEmail={user?.email} onScormCompleted={scormCompleted} onOpenCodeLab={onOpenCodeLab} />
                  </div>
                )
              )}

              {view === 'lesson' && (
                <div className="flex items-center justify-between border-t border-line pt-6">
                  <button
                    onClick={() => go(-1)}
                    disabled={index <= 0}
                    className="flex items-center gap-2 rounded-xl border border-line bg-canvas px-4 py-2 text-xs font-bold text-ink transition-colors hover:bg-raised disabled:opacity-40"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    <span>{t('learn.lesson.previous')}</span>
                  </button>
                  <button
                    onClick={() => go(1)}
                    disabled={index < 0 || index >= lessons.length - 1}
                    className="flex items-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-xs font-bold text-on-brand shadow-lg shadow-brand/20 transition-all hover:bg-brand-hover disabled:opacity-40"
                  >
                    <span>{t('learn.lesson.next')}</span>
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>

            <LessonSidebar
              view={view}
              modules={modules}
              activeLessonId={activeLessonId}
              done={done}
              onSelectHome={() => setView('home')}
              onSelectLesson={openLesson}
              onOpenExam={onOpenExam}
            />
          </div>
        )}
      </div>
    </div>
  );
};
