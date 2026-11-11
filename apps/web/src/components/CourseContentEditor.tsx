'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Plus, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { errorMessage, useApiData } from '@/hooks/useApiData';
import { useStaffCourses, type StaffCourse } from '@/hooks/useStaffCourses';
import { useT } from '@/lib/i18n';
import { CourseStatusBar } from './course/editor/CourseStatusBar';
import { ModuleCard } from './course/editor/ModuleCard';
import { primaryBtn, smallBtn, type ApiModule, type Notice } from './course/editor/types';

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
  const [reviewMessage, setReviewMessage] = useState('');

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
              <CourseStatusBar
                course={course}
                busy={busy}
                needsApproval={needsApproval}
                pendingStatus={pendingStatus}
                reviewMessage={reviewMessage}
                onChangePendingStatus={setPendingStatus}
                onChangeStatus={changeStatus}
                onChangeReviewMessage={setReviewMessage}
                onSubmitForReview={submitForReview}
              />
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
