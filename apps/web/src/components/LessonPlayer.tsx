'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { X, CheckCircle2, PlayCircle, FileText, Code, ArrowRight, ArrowLeft, ExternalLink, Award, Home, Clock } from 'lucide-react';
import { VideoPlayer } from './VideoPlayer';
import { ScormFrame } from './ScormFrame';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { errorMessage, useApiData } from '@/hooks/useApiData';
import { useLocale } from '@/lib/i18n';

interface LessonPlayerProps {
  courseId: string;
  courseCode: string;
  courseTitle: string;
  onClose: () => void;
  /** Called with the new course percentage after a lesson is recorded as finished. */
  onProgressUpdated?: (newPercent: number) => void;
  onOpenExam?: () => void;
  onOpenCodeLab?: (lesson: { title: string; instructions: string }) => void;
  /** "home" opens on the course home (overview, syllabus, upcoming work); default is the next lesson. */
  startOn?: 'home' | 'lesson';
  /** The learner's upcoming work in this course, shown on the course home. */
  upcoming?: UpcomingWork[];
  onOpenWork?: (item: UpcomingWork) => void;
}

export interface UpcomingWork {
  type: 'ASSIGNMENT' | 'QUIZ';
  id: string;
  title: string;
  dueAt: string | null;
  overdue?: boolean;
}

type Completion = 'LESSONS_REMAINING' | 'AWAITING_GRADE' | 'BELOW_PASS_MARK' | 'MANUAL' | 'COMPLETED' | 'FAILED' | 'NOT_ENROLLED';

interface CourseDetail {
  description: string | null;
  syllabus: string | null;
  instructors: { isPrimary: boolean; user: { id: string; firstName: string; lastName: string } }[];
}

interface Lesson {
  id: string;
  title: string;
  contentType: 'RICHTEXT' | 'VIDEO' | 'SCORM_PACKAGE' | 'PDF_DOCUMENT' | 'INTERACTIVE_CODE' | 'EXTERNAL_LTI_TOOL';
  bodyContent: string | null;
  mediaUrl: string | null;
  ltiToolLaunchUrl: string | null;
  scormPackageId: string | null;
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

const TYPE_LABEL: Record<Lesson['contentType'], string> = {
  RICHTEXT: 'Reading',
  VIDEO: 'Video',
  SCORM_PACKAGE: 'SCORM module',
  PDF_DOCUMENT: 'Document',
  INTERACTIVE_CODE: 'Code lab',
  EXTERNAL_LTI_TOOL: 'External tool',
};

const NoContent: React.FC = () => {
  const { t } = useLocale();
  return (
    <p className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-xs text-ink-muted">
      {t('learn.lesson.noContent')}
    </p>
  );
};

/** The course's front page: where the learner is, what to do next, and what the course is about. */
const CourseHome: React.FC<{
  detail: CourseDetail | null;
  detailError: string | null;
  completed: number;
  total: number;
  next: Lesson | null;
  first: Lesson | undefined;
  upcoming: UpcomingWork[];
  onOpenLesson: (id: string) => void;
  onOpenWork?: (item: UpcomingWork) => void;
}> = ({ detail, detailError, completed, total, next, first, upcoming, onOpenLesson, onOpenWork }) => {
  const { t, locale } = useLocale();
  // The browser's own time zone, as before; only the language of the weekday and month names follows the interface.
  const dueLabel = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN-u-nu-latn' : undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        }).format(new Date(iso))
      : t('learn.lesson.noDueDate');
  const target = next ?? first;
  const instructors = detail?.instructors ?? [];
  return (
    <div className="space-y-6">
      <div className="space-y-3 rounded-2xl border border-line bg-canvas p-6">
        <p className="text-xs text-ink-muted">
          {total === 0
            ? t('learn.lesson.home.noLessons')
            : completed === total
              ? t.plural('learn.lesson.home.allDone', total)
              : t.plural('learn.lesson.home.progress', total, { completed })}
        </p>
        {target && (
          <button
            onClick={() => onOpenLesson(target.id)}
            className="flex w-full items-center justify-between gap-3 rounded-xl bg-brand px-5 py-3 text-left text-sm font-bold text-on-brand shadow-lg shadow-brand/20 transition-all hover:bg-brand-hover"
          >
            <span className="min-w-0 truncate">
              {!next
                ? t('learn.lesson.home.reviewFromStart')
                : completed === 0
                  ? t('learn.lesson.home.start', { title: next.title })
                  : t('learn.lesson.home.continue', { title: next.title })}
            </span>
            <ArrowRight className="h-4 w-4 shrink-0" />
          </button>
        )}
      </div>

      {upcoming.length > 0 && (
        <section aria-labelledby="home-upcoming" className="space-y-2">
          <h4 id="home-upcoming" className="text-xs font-bold uppercase tracking-wider text-ink-muted">
            {t('learn.lesson.home.comingUp')}
          </h4>
          {upcoming.map((w) => (
            <button
              key={`${w.type}:${w.id}`}
              onClick={() => onOpenWork?.(w)}
              disabled={!onOpenWork}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-canvas px-4 py-2.5 text-left text-xs transition-colors hover:bg-raised disabled:hover:bg-canvas"
            >
              <span className="flex min-w-0 items-center gap-2">
                {w.type === 'QUIZ' ? (
                  <Award className="h-4 w-4 shrink-0 text-accent" />
                ) : (
                  <FileText className="h-4 w-4 shrink-0 text-success" />
                )}
                <span className="truncate text-ink">{w.title}</span>
              </span>
              <span className={`flex shrink-0 items-center gap-1 ${w.overdue ? 'font-bold text-danger' : 'text-ink-subtle'}`}>
                <Clock className="h-3 w-3" />
                {w.overdue ? `${t('learn.lesson.overdue')} · ` : ''}
                {dueLabel(w.dueAt)}
              </span>
            </button>
          ))}
        </section>
      )}

      {detailError && (
        <p role="alert" className="text-xs text-danger">
          {detailError}
        </p>
      )}
      {detail?.description && (
        <section aria-labelledby="home-about" className="space-y-2">
          <h4 id="home-about" className="text-xs font-bold uppercase tracking-wider text-ink-muted">
            {t('learn.lesson.home.about')}
          </h4>
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink">{detail.description}</p>
        </section>
      )}
      {instructors.length > 0 && (
        <p className="text-xs text-ink-muted">
          {t('learn.lesson.home.taughtBy')}{' '}
          <span className="text-ink">
            {[...instructors]
              .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
              .map((i) => `${i.user.firstName} ${i.user.lastName}`)
              .join(', ')}
          </span>
        </p>
      )}
      <section aria-labelledby="home-syllabus" className="space-y-2">
        <h4 id="home-syllabus" className="text-xs font-bold uppercase tracking-wider text-ink-muted">
          {t('learn.lesson.home.syllabus')}
        </h4>
        {detail?.syllabus?.trim() ? (
          <div className="whitespace-pre-line rounded-2xl border border-line bg-canvas p-6 text-sm leading-relaxed text-ink">
            {detail.syllabus}
          </div>
        ) : (
          <p className="text-xs text-ink-subtle">{detail ? t('learn.lesson.home.noSyllabus') : t('common.loading')}</p>
        )}
      </section>
    </div>
  );
};

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

  const modules = modulesReq.data?.data ?? [];
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

  const body = (lesson: Lesson) => {
    if (lesson.contentType === 'SCORM_PACKAGE') {
      return lesson.scormPackageId ? (
        <ScormFrame key={lesson.id} packageId={lesson.scormPackageId} title={lesson.title} onCompleted={() => scormCompleted(lesson.id)} />
      ) : (
        <NoContent />
      );
    }

    const text = lesson.bodyContent?.trim();
    const link = lesson.contentType === 'EXTERNAL_LTI_TOOL' ? lesson.ltiToolLaunchUrl : lesson.mediaUrl;
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

    if (lesson.contentType === 'VIDEO') {
      return (
        <div className="space-y-4">
          {lesson.mediaUrl ? (
            <VideoPlayer key={lesson.id} url={lesson.mediaUrl} title={lesson.title} watermark={user?.email} />
          ) : (
            !textBlock && <NoContent />
          )}
          {textBlock}
        </div>
      );
    }

    if (lesson.contentType === 'INTERACTIVE_CODE') {
      return (
        <div className="space-y-4">
          {textBlock}
          {onOpenCodeLab && (
            <button
              onClick={() => onOpenCodeLab({ title: lesson.title, instructions: lesson.bodyContent ?? '' })}
              className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-on-brand shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-500"
            >
              <Code className="h-4 w-4" />
              <span>{t('learn.lesson.openSandbox')}</span>
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
            {lesson.contentType === 'PDF_DOCUMENT' ? (
              <FileText className="h-4 w-4 text-orchid" />
            ) : (
              <ExternalLink className="h-4 w-4 text-brand-fg" />
            )}
            <span>{lesson.contentType === 'PDF_DOCUMENT' ? t('learn.lesson.openDocument') : t('learn.lesson.openNewTab')}</span>
          </a>
        )}
        {!textBlock && !link && <NoContent />}
      </div>
    );
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

                    {body(current)}
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

            <div className="w-full space-y-5 overflow-y-auto border-t border-line bg-canvas/60 p-4 md:w-80 md:border-l md:border-t-0">
              <button
                onClick={() => setView('home')}
                aria-current={view === 'home'}
                className={`flex w-full items-center gap-2 rounded-xl p-2.5 text-left text-xs font-bold transition-all ${
                  view === 'home'
                    ? 'border border-brand/40 bg-brand/20 text-brand-fg'
                    : 'border border-line bg-surface text-ink hover:bg-raised'
                }`}
              >
                <Home className="h-4 w-4 shrink-0" />
                <span>{t('learn.lesson.courseHome')}</span>
              </button>

              <div>
                <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-ink-muted">{t('learn.lesson.lessons')}</h3>
                <p className="text-[11px] text-ink-subtle">{t('learn.lesson.selectAny')}</p>
              </div>

              <div className="space-y-4">
                {modules.map((module) => (
                  <div key={module.id} className="space-y-2">
                    <h4 className="text-xs font-bold text-ink">{module.title}</h4>
                    {module.lessons.length === 0 && <p className="text-[11px] text-ink-subtle">{t('learn.lesson.noLessonsInModule')}</p>}
                    <div className="space-y-1">
                      {module.lessons.map((lesson) => (
                        <button
                          key={lesson.id}
                          onClick={() => openLesson(lesson.id)}
                          aria-current={view === 'lesson' && lesson.id === activeLessonId}
                          className={`flex w-full items-center justify-between rounded-xl p-2.5 text-left text-xs transition-all ${
                            view === 'lesson' && lesson.id === activeLessonId
                              ? 'border border-brand/40 bg-brand/20 text-brand-fg'
                              : 'text-ink-muted hover:bg-surface hover:text-ink'
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-2 pr-2">
                            {done.has(lesson.id) ? (
                              <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                            ) : (
                              <PlayCircle className="h-4 w-4 shrink-0 text-ink-subtle" />
                            )}
                            <span className="truncate">{lesson.title}</span>
                          </div>
                          <span
                            className={`shrink-0 text-[10px] ${view === 'lesson' && lesson.id === activeLessonId ? 'text-brand-fg' : 'text-ink-subtle'}`}
                          >
                            {t('learn.lesson.minutes', { minutes: lesson.estimatedMinutes })}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {onOpenExam && (
                <div className="space-y-2 border-t border-line pt-4">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-ink-subtle">{t('learn.lesson.assessments')}</h4>
                  <button
                    onClick={onOpenExam}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-line bg-surface py-2 text-xs font-bold text-ink transition-all hover:bg-brand hover:text-on-brand"
                  >
                    <Award className="h-3.5 w-3.5 text-accent" />
                    <span>{t('learn.lesson.takeExam')}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
