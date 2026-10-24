'use client';

import React, { useEffect, useState } from 'react';
import { X, ArrowUp, ArrowDown, Trash2, Plus, Save, CheckCircle2, AlertTriangle, Package } from 'lucide-react';
import { UPLOAD_ACCEPT, uploadFile } from '@/lib/upload';
import { api } from '@/lib/api';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { errorMessage, useApiData } from '@/hooks/useApiData';
import { useStaffCourses, type StaffCourse } from '@/hooks/useStaffCourses';
import { useT } from '@/lib/i18n';
import { LessonFields, blankLesson, lessonProblem, type LessonDraft, type LessonType } from './LessonFields';

interface ApiLesson {
  id: string;
  title: string;
  orderIndex: number;
  contentType: LessonType;
  bodyContent: string | null;
  mediaUrl: string | null;
  ltiToolLaunchUrl: string | null;
  estimatedMinutes: number;
  updatedAt: string;
}

interface ApiModule {
  id: string;
  title: string;
  orderIndex: number;
  updatedAt: string;
  lessons: ApiLesson[];
}

type Notice = { kind: 'ok' | 'error'; text: string };

/** The statuses in menu order; their names and the "done" messages come from the catalogue (builder.status.*, builder.editor.statusDone.*). */
const STATUSES: StaffCourse['status'][] = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];
const STATUS_ENGLISH: Record<StaffCourse['status'], string> = { DRAFT: 'Draft', PUBLISHED: 'Published', ARCHIVED: 'Archived' };

const toDraft = (l: ApiLesson): LessonDraft => ({
  id: l.id,
  title: l.title,
  type: l.contentType,
  minutes: l.estimatedMinutes,
  body: l.bodyContent ?? '',
  url: (l.contentType === 'EXTERNAL_LTI_TOOL' ? l.ltiToolLaunchUrl : l.mediaUrl) ?? '',
});

/** The fields to send for a lesson. A SCORM lesson's type and package are never touched here. */
const toPayload = (d: LessonDraft) => {
  const url = d.url.trim();
  const isTool = d.type === 'EXTERNAL_LTI_TOOL';
  const scorm = d.type === 'SCORM_PACKAGE';
  return {
    title: d.title.trim(),
    estimatedMinutes: d.minutes,
    bodyContent: d.body.trim() || null,
    ...(scorm ? {} : { contentType: d.type, mediaUrl: isTool ? null : url || null, ltiToolLaunchUrl: isTool ? url || null : null }),
  };
};

const sameDraft = (a: LessonDraft, b: LessonDraft) =>
  a.title === b.title && a.type === b.type && a.minutes === b.minutes && a.body === b.body && a.url === b.url;

const iconBtn = 'rounded-lg p-1 text-ink-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-40';
const smallBtn =
  'rounded-lg border border-line bg-surface px-2.5 py-1 text-[11px] font-semibold text-ink transition-colors hover:bg-raised disabled:opacity-50';
const primaryBtn =
  'flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[11px] font-bold text-on-brand transition-colors hover:bg-brand-hover disabled:opacity-50';

/** Delete with a confirmation step in place of a browser dialog. */
const ConfirmDelete: React.FC<{ label: string; warning: string; busy: boolean; onConfirm: () => void }> = ({
  label,
  warning,
  busy,
  onConfirm,
}) => {
  const t = useT();
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button onClick={() => setAsking(true)} disabled={busy} aria-label={label} className={`${iconBtn} hover:text-danger`}>
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-[11px]">
      <span className="text-danger">{warning}</span>
      <button onClick={onConfirm} disabled={busy} className="rounded-lg bg-danger px-2 py-1 font-bold text-on-brand disabled:opacity-50">
        {t('builder.common.delete')}
      </button>
      <button onClick={() => setAsking(false)} className={smallBtn}>
        {t('builder.common.keep')}
      </button>
    </span>
  );
};

interface LessonRowProps {
  lesson: ApiLesson;
  label: string;
  busy: boolean;
  canUp: boolean;
  canDown: boolean;
  onSave: (draft: LessonDraft) => void;
  onMove: (delta: number) => void;
  onDelete: () => void;
  courseId: string;
}

const LessonRow: React.FC<LessonRowProps> = ({ lesson, label, busy, canUp, canDown, onSave, onMove, onDelete, courseId }) => {
  const t = useT();
  const saved = toDraft(lesson);
  const [draft, setDraft] = useState(saved);
  const dirty = !sameDraft(draft, saved);
  const problem = lessonProblem(draft, t);

  return (
    <div className="space-y-1.5">
      <LessonFields
        lesson={draft}
        label={label}
        disabled={busy}
        courseId={courseId}
        onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
        onDelete={() => undefined}
        hideDelete
      />
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-1">
          <button
            onClick={() => onMove(-1)}
            disabled={busy || !canUp || dirty}
            aria-label={t('builder.editor.aria.moveUp', { label })}
            className={iconBtn}
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onMove(1)}
            disabled={busy || !canDown || dirty}
            aria-label={t('builder.editor.aria.moveDown', { label })}
            className={iconBtn}
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <ConfirmDelete
            label={t('builder.editor.aria.delete', { label })}
            warning={t('builder.editor.removeLessonWarning')}
            busy={busy}
            onConfirm={onDelete}
          />
        </div>
        <div className="flex items-center gap-2">
          {problem && dirty && <span className="text-[11px] font-semibold text-accent">{problem}</span>}
          {dirty && !problem && <span className="text-[11px] text-ink-muted">{t('builder.editor.unsaved')}</span>}
          <button
            onClick={() => onSave(draft)}
            disabled={busy || !dirty || !!problem}
            aria-label={t('builder.editor.aria.save', { label })}
            className={primaryBtn}
          >
            <Save className="h-3 w-3" />
            <span>{t('builder.common.save')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

interface ModuleCardProps {
  module: ApiModule;
  index: number;
  count: number;
  busy: boolean;
  act: (work: () => Promise<unknown>, okText: string) => Promise<boolean>;
  courseId: string;
  onMoveModule: (delta: number) => void;
}

const ModuleCard: React.FC<ModuleCardProps> = ({ module, index, count, busy, act, courseId, onMoveModule }) => {
  const t = useT();
  const [title, setTitle] = useState(module.title);
  const [adding, setAdding] = useState<LessonDraft | null>(null);
  const [uploadingScorm, setUploadingScorm] = useState(false);

  /** Upload a SCORM zip, unpack it into a package, and add a lesson that plays it. */
  const addScorm = async (file: File | undefined) => {
    if (!file) return;
    setUploadingScorm(true);
    try {
      await act(async () => {
        const up = await uploadFile(file, 'SCORM_PACKAGE', courseId);
        const pkg = await api.post<{ data: { id: string; title: string } }>(`/api/v1/courses/${courseId}/scorm-packages`, {
          fileId: up.id,
        });
        await api.post(`${base}/modules/${module.id}/lessons`, {
          title: pkg.data.title,
          contentType: 'SCORM_PACKAGE',
          scormPackageId: pkg.data.id,
        });
      }, t('builder.editor.scormAdded'));
    } finally {
      setUploadingScorm(false);
    }
  };
  const base = `/api/v1/courses/${courseId}`;
  const name = t('builder.label.module', { n: index + 1 });
  const titleDirty = title.trim() !== module.title && title.trim().length > 0;

  const moveLesson = (from: number, delta: number) => {
    const order = module.lessons.map((l) => l);
    const [moved] = order.splice(from, 1);
    order.splice(from + delta, 0, moved);
    return act(async () => {
      for (const [i, l] of order.entries()) {
        if (l.orderIndex !== i) await api.patch(`${base}/lessons/${l.id}`, { orderIndex: i });
      }
    }, t('builder.editor.lessonMoved'));
  };

  return (
    <div className="space-y-3 rounded-2xl border border-line bg-canvas p-4">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-xs font-bold text-ink-muted">{t('builder.editor.moduleN', { n: index + 1 })}</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('builder.editor.moduleTitlePlaceholder')}
          aria-label={t('builder.editor.aria.moduleTitle', { name })}
          maxLength={255}
          disabled={busy}
          className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-1.5 text-xs font-bold text-ink focus:border-brand focus:outline-none"
        />
        {titleDirty && (
          <button
            onClick={() => act(() => api.patch(`${base}/modules/${module.id}`, { title: title.trim() }), t('builder.editor.moduleRenamed'))}
            disabled={busy}
            aria-label={t('builder.editor.aria.saveTitle', { name })}
            className={primaryBtn}
          >
            <Save className="h-3 w-3" />
            <span>{t('builder.common.save')}</span>
          </button>
        )}
        <button
          onClick={() => onMoveModule(-1)}
          disabled={busy || index === 0}
          aria-label={t('builder.editor.aria.moveUp', { label: name })}
          className={iconBtn}
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => onMoveModule(1)}
          disabled={busy || index === count - 1}
          aria-label={t('builder.editor.aria.moveDown', { label: name })}
          className={iconBtn}
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
        <ConfirmDelete
          label={t('builder.editor.aria.delete', { label: name })}
          warning={t.plural('builder.editor.removeModuleWarning', module.lessons.length)}
          busy={busy}
          onConfirm={() => act(() => api.delete(`${base}/modules/${module.id}`), t('builder.editor.moduleDeleted'))}
        />
      </div>

      {module.lessons.length === 0 && !adding && <p className="text-[11px] text-ink-subtle">{t('builder.editor.noLessons')}</p>}

      <div className="space-y-4">
        {module.lessons.map((lesson, i) => (
          <LessonRow
            courseId={courseId}
            key={`${lesson.id}:${lesson.updatedAt}`}
            lesson={lesson}
            label={t('builder.label.lesson', { lesson: i + 1, module: name })}
            busy={busy}
            canUp={i > 0}
            canDown={i < module.lessons.length - 1}
            onSave={(d) => act(() => api.patch(`${base}/lessons/${lesson.id}`, toPayload(d)), t('builder.editor.lessonSaved'))}
            onMove={(delta) => moveLesson(i, delta)}
            onDelete={() => act(() => api.delete(`${base}/lessons/${lesson.id}`), t('builder.editor.lessonDeleted'))}
          />
        ))}
      </div>

      {adding ? (
        <div className="space-y-2 rounded-xl border border-dashed border-brand/50 p-2">
          <p className="px-1 text-[11px] font-bold text-brand-fg">{t('builder.editor.newLessonHeading')}</p>
          <LessonFields
            lesson={adding}
            label={t('builder.label.newLesson', { module: name })}
            disabled={busy}
            courseId={courseId}
            onChange={(patch) => setAdding((d) => (d ? { ...d, ...patch } : d))}
            onDelete={() => setAdding(null)}
          />
          <div className="flex items-center justify-end gap-2">
            {lessonProblem(adding, t) && adding.title.length > 0 && (
              <span className="text-[11px] font-semibold text-accent">{lessonProblem(adding, t)}</span>
            )}
            <button onClick={() => setAdding(null)} className={smallBtn}>
              {t('builder.common.cancel')}
            </button>
            <button
              onClick={async () => {
                const d = adding;
                const ok = await act(() => api.post(`${base}/modules/${module.id}/lessons`, toPayload(d)), t('builder.editor.lessonAdded'));
                if (ok) setAdding(null);
              }}
              disabled={busy || !!lessonProblem(adding, t)}
              aria-label={t('builder.editor.aria.addLessonTo', { name })}
              className={primaryBtn}
            >
              <Plus className="h-3 w-3" />
              <span>{t('builder.editor.addLesson')}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <button
            onClick={() => setAdding(blankLesson())}
            disabled={busy}
            className="text-[11px] font-semibold text-brand-fg hover:underline disabled:opacity-50"
          >
            {t('builder.editor.newLessonLink')}
          </button>
          <label
            className={`inline-flex cursor-pointer items-center gap-1 text-[11px] font-semibold text-brand-fg hover:underline ${busy || uploadingScorm ? 'pointer-events-none opacity-50' : ''}`}
          >
            <Package className="h-3 w-3" />
            {uploadingScorm ? t('builder.editor.uploading') : t('builder.editor.addScorm')}
            <input
              type="file"
              className="sr-only"
              accept={UPLOAD_ACCEPT.scorm}
              disabled={busy || uploadingScorm}
              aria-label={t('builder.editor.aria.addScormTo', { name })}
              onChange={(e) => {
                addScorm(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
};

export const CourseContentEditor: React.FC<{
  onClose: () => void;
  /** Open on this course when the person may edit it. */ initialCourseId?: string | null;
}> = ({ onClose, initialCourseId }) => {
  const t = useT();
  useEscapeKey(onClose);
  const { courses, isLoading: coursesLoading, reload: reloadCourses } = useStaffCourses({ editableOnly: true });
  const [pendingStatus, setPendingStatus] = useState<StaffCourse['status'] | null>(null);
  const [courseId, setCourseId] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [newModule, setNewModule] = useState('');

  useEffect(() => {
    if (!courseId && courses.length > 0) setCourseId((courses.find((c) => c.id === initialCourseId) ?? courses[0]).id);
  }, [courses, courseId, initialCourseId]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const content = useApiData<{ data: ApiModule[] }>(courseId ? `/api/v1/courses/${courseId}/modules` : null);
  const modules = content.data?.data ?? [];
  const base = `/api/v1/courses/${courseId}`;

  /** Runs one change, reloads the content, and reports the result. Resolves true on success. */
  const act = async (work: () => Promise<unknown>, okText: string) => {
    setBusy(true);
    try {
      await work();
      await content.reload();
      setNotice({ kind: 'ok', text: okText });
      return true;
    } catch (e) {
      setNotice({ kind: 'error', text: errorMessage(e, t('builder.editor.changeFailed')) });
      await content.reload();
      return false;
    } finally {
      setBusy(false);
    }
  };

  const moveModule = (from: number, delta: number) => {
    const ids = modules.map((m) => m.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(from + delta, 0, moved);
    return act(() => api.put(`${base}/modules-order`, { moduleIds: ids }), t('builder.editor.moduleMoved'));
  };

  const course = courses.find((c) => c.id === courseId);
  const detail = useApiData<{ data: { publishNeedsApproval: boolean } }>(courseId ? `/api/v1/courses/${courseId}` : null);
  const needsApproval = !!detail.data?.data.publishNeedsApproval && course?.status !== 'PUBLISHED';
  const [reviewMessage, setReviewMessage] = useState('');

  const submitForReview = () =>
    act(async () => {
      await api.post(`${base}/review/submit`, reviewMessage.trim() ? { message: reviewMessage.trim() } : {});
      setReviewMessage('');
      await reloadCourses();
    }, t('builder.editor.submitted'));

  const changeStatus = async (status: StaffCourse['status']) => {
    setPendingStatus(null);
    await act(
      async () => {
        await api.put(base, { status });
        await reloadCourses();
      },
      t.dyn(`builder.editor.statusDone.${status}`, '')
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/85 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={t('builder.editor.title')}
    >
      <div className="relative flex h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-line bg-canvas px-6 py-4">
          <div>
            <h3 className="text-base font-bold text-ink">{t('builder.editor.title')}</h3>
            <p className="text-xs text-ink-muted">{t('builder.editor.subtitle')}</p>
            {course && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <label htmlFor="course-status" className="font-semibold text-ink-muted">
                  {t('builder.editor.status')}
                </label>
                <select
                  id="course-status"
                  value={course.status}
                  onChange={(e) => {
                    const next = e.target.value as StaffCourse['status'];
                    if (next === 'ARCHIVED') setPendingStatus(next);
                    else changeStatus(next);
                  }}
                  disabled={busy}
                  className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink focus:border-brand focus:outline-none"
                >
                  {STATUSES.filter((s) => !(needsApproval && s === 'PUBLISHED')).map((s) => (
                    <option key={s} value={s}>
                      {t.dyn(`builder.status.${s}`, STATUS_ENGLISH[s])}
                    </option>
                  ))}
                </select>
                {course.status !== 'PUBLISHED' && <span className="text-ink-subtle">{t('builder.editor.hiddenFromLearners')}</span>}
                {needsApproval &&
                  course.status === 'DRAFT' &&
                  (course.reviewStatus === 'PENDING' ? (
                    <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 font-semibold text-accent">
                      {t('builder.editor.waitingReview')}
                    </span>
                  ) : (
                    <span className="flex flex-wrap items-center gap-1.5">
                      {course.reviewStatus === 'CHANGES_REQUESTED' && (
                        <span className="text-danger">
                          {course.reviewNote
                            ? t('builder.editor.changesRequestedNote', { note: course.reviewNote })
                            : t('builder.editor.changesRequested')}
                        </span>
                      )}
                      <input
                        value={reviewMessage}
                        onChange={(e) => setReviewMessage(e.target.value)}
                        maxLength={2000}
                        placeholder={t('builder.editor.reviewNotePlaceholder')}
                        aria-label={t('builder.editor.reviewNoteLabel')}
                        className="w-52 rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink focus:border-brand focus:outline-none"
                      />
                      <button
                        onClick={submitForReview}
                        disabled={busy}
                        className="rounded-lg bg-brand px-2 py-1 font-bold text-on-brand disabled:opacity-50"
                      >
                        {course.reviewStatus === 'CHANGES_REQUESTED' ? t('builder.editor.submitAgain') : t('builder.editor.submitReview')}
                      </button>
                    </span>
                  ))}
                {pendingStatus === 'ARCHIVED' && (
                  <span className="flex items-center gap-1.5">
                    <span className="text-danger">{t('builder.editor.archiveQuestion')}</span>
                    <button
                      onClick={() => changeStatus('ARCHIVED')}
                      disabled={busy}
                      className="rounded-lg bg-danger px-2 py-1 font-bold text-on-brand disabled:opacity-50"
                    >
                      {t('builder.editor.archive')}
                    </button>
                    <button onClick={() => setPendingStatus(null)} className={smallBtn}>
                      {t('builder.common.keep')}
                    </button>
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <select
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              aria-label={t('builder.editor.courseSelect')}
              disabled={busy}
              className="rounded-xl border border-line bg-surface px-3 py-1.5 text-xs text-ink focus:border-brand focus:outline-none"
            >
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.title}
                </option>
              ))}
            </select>
            <button
              onClick={onClose}
              aria-label={t('builder.common.close')}
              className="rounded-xl p-1 text-ink-muted transition-colors hover:bg-raised hover:text-ink"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {coursesLoading || (courseId && content.isLoading && !content.data) ? (
            <p role="status" className="py-16 text-center text-xs text-ink-muted">
              {t('builder.common.loading')}
            </p>
          ) : courses.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line px-6 py-12 text-center text-xs text-ink-muted">
              {t('builder.editor.noCourses')}
            </p>
          ) : content.error ? (
            <div role="alert" className="mx-auto max-w-md rounded-2xl border border-danger/30 bg-danger/10 p-6 text-center">
              <p className="text-sm font-bold text-danger">{t('builder.editor.loadFailed', { code: course?.code ?? '' })}</p>
              <p className="mt-1.5 text-xs text-ink-muted">{content.error}</p>
              <button onClick={content.reload} className={`${smallBtn} mt-4`}>
                {t('builder.editor.tryAgain')}
              </button>
            </div>
          ) : (
            <>
              {modules.length === 0 && (
                <p className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-xs text-ink-muted">
                  {t('builder.editor.noModules')}
                </p>
              )}

              {modules.map((m, i) => (
                <ModuleCard
                  key={`${m.id}:${m.updatedAt}`}
                  module={m}
                  index={i}
                  count={modules.length}
                  busy={busy}
                  act={act}
                  courseId={courseId}
                  onMoveModule={(d) => moveModule(i, d)}
                />
              ))}

              <form
                className="flex items-center gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const title = newModule.trim();
                  if (!title) return;
                  if (await act(() => api.post(`${base}/modules`, { title }), t('builder.editor.moduleAdded'))) setNewModule('');
                }}
              >
                <input
                  type="text"
                  value={newModule}
                  onChange={(e) => setNewModule(e.target.value)}
                  placeholder={t('builder.editor.newModuleTitle')}
                  aria-label={t('builder.editor.newModuleTitle')}
                  maxLength={255}
                  disabled={busy}
                  className="min-w-0 flex-1 rounded-xl border border-line bg-canvas px-3 py-2 text-xs text-ink focus:border-brand focus:outline-none"
                />
                <button type="submit" disabled={busy || !newModule.trim()} className={primaryBtn}>
                  <Plus className="h-3 w-3" />
                  <span>{t('builder.editor.addModule')}</span>
                </button>
              </form>
            </>
          )}
        </div>

        {notice && (
          <div
            role={notice.kind === 'error' ? 'alert' : 'status'}
            className={`absolute bottom-6 left-1/2 z-10 flex max-w-[90%] -translate-x-1/2 items-center gap-2 rounded-xl border bg-surface px-4 py-2.5 text-xs shadow-xl ${
              notice.kind === 'ok' ? 'border-success/40 text-success' : 'border-danger/40 text-danger'
            }`}
          >
            {notice.kind === 'ok' ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            <span className="font-semibold">{notice.text}</span>
          </div>
        )}
      </div>
    </div>
  );
};
