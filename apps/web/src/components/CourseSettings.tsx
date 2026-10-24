'use client';

import React, { useEffect, useState } from 'react';
import { X, Settings2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { Banner } from '@/components/admin/IdentityPanels';
import { useT } from '@/lib/i18n';

interface CourseDetail {
  id: string;
  code: string;
  title: string;
  description: string | null;
  syllabus: string | null;
  passingGradePercent: number;
  allowSelfEnroll: boolean;
  departmentId: string | null;
  termId: string | null;
}

interface Term {
  id: string;
  name: string;
}

interface Department {
  id: string;
  name: string;
  code: string;
  campus: string;
}

const field =
  'w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand';
const label = 'text-xs font-semibold text-ink-muted';

/** Edit a course's catalogue details and rules after it was created (PUT /courses/:id). */
export const CourseSettings: React.FC<{ courseId: string; onClose: () => void; onSaved?: () => void }> = ({
  courseId,
  onClose,
  onSaved,
}) => {
  const t = useT();
  useEscapeKey(onClose);
  const course = useApiData<{ data: CourseDetail }>(`/api/v1/courses/${courseId}`);
  const departments = useApiData<{ data: Department[] }>('/api/v1/courses/departments');
  const terms = useApiData<{ data: Term[] }>('/api/v1/terms');
  const { busy, error, run } = useAction();
  const [draft, setDraft] = useState<CourseDetail | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (course.data) setDraft(course.data.data);
  }, [course.data]);

  const set = (patch: Partial<CourseDetail>) => {
    setSaved(false);
    setDraft((d) => (d ? { ...d, ...patch } : d));
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    run(async () => {
      await api.put(`/api/v1/courses/${courseId}`, {
        title: draft.title.trim(),
        code: draft.code.trim(),
        description: draft.description ?? '',
        syllabus: draft.syllabus ?? '',
        passingGradePercent: draft.passingGradePercent,
        allowSelfEnroll: draft.allowSelfEnroll,
        departmentId: draft.departmentId,
        termId: draft.termId,
      });
      setSaved(true);
      await course.reload();
      onSaved?.();
    });
  };

  const invalid = !draft || draft.title.trim().length < 3 || draft.code.trim().length < 2;

  return (
    <div
      className="fixed inset-0 z-50 bg-canvas/85 backdrop-blur-md flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="course-settings-h"
    >
      <form
        onSubmit={save}
        className="bg-surface border border-line rounded-3xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl"
      >
        <div className="bg-canvas border-b border-line px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Settings2 className="h-5 w-5 text-brand-fg" />
            <h3 id="course-settings-h" className="font-bold text-sm text-ink">
              {draft ? t('builder.settings.titleWithCode', { code: draft.code }) : t('builder.settings.title')}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('builder.common.close')}
            className="p-1 rounded-xl hover:bg-raised text-ink-muted hover:text-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {course.error && <Banner kind="error">{course.error}</Banner>}
          {error && <Banner kind="error">{error}</Banner>}
          {saved && <Banner kind="ok">{t('builder.settings.saved')}</Banner>}
          {!draft && !course.error && <p className="text-xs text-ink-muted">{t('builder.common.loading')}</p>}
          {draft && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="sm:col-span-2 space-y-1.5">
                  <span className={label}>{t('builder.settings.fieldTitle')}</span>
                  <input className={field} value={draft.title} maxLength={255} onChange={(e) => set({ title: e.target.value })} />
                </label>
                <label className="space-y-1.5">
                  <span className={label}>{t('builder.settings.fieldCode')}</span>
                  <input
                    className={`${field} font-mono`}
                    value={draft.code}
                    maxLength={50}
                    onChange={(e) => set({ code: e.target.value })}
                  />
                </label>
              </div>
              <label className="block space-y-1.5">
                <span className={label}>{t('builder.settings.description')}</span>
                <textarea
                  className={field}
                  rows={3}
                  maxLength={20000}
                  value={draft.description ?? ''}
                  onChange={(e) => set({ description: e.target.value })}
                />
              </label>
              <label className="block space-y-1.5">
                <span className={label}>{t('builder.settings.syllabus')}</span>
                <textarea
                  className={field}
                  rows={8}
                  maxLength={50000}
                  value={draft.syllabus ?? ''}
                  onChange={(e) => set({ syllabus: e.target.value })}
                  placeholder={t('builder.settings.syllabusPlaceholder')}
                />
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <label className="space-y-1.5">
                  <span className={label}>{t('builder.settings.term')}</span>
                  <select className={field} value={draft.termId ?? ''} onChange={(e) => set({ termId: e.target.value || null })}>
                    <option value="">{t('builder.settings.noTerm')}</option>
                    {(terms.data?.data ?? []).map((term) => (
                      <option key={term.id} value={term.id}>
                        {term.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className={label}>{t('builder.settings.department')}</span>
                  <select
                    className={field}
                    value={draft.departmentId ?? ''}
                    onChange={(e) => set({ departmentId: e.target.value || null })}
                  >
                    <option value="">{t('builder.settings.noDepartment')}</option>
                    {(departments.data?.data ?? []).map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.campus})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className={label}>{t('builder.settings.passMark')}</span>
                  <input
                    className={field}
                    type="number"
                    min={0}
                    max={100}
                    value={draft.passingGradePercent}
                    onChange={(e) => set({ passingGradePercent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-ink pt-6 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.allowSelfEnroll}
                    onChange={(e) => set({ allowSelfEnroll: e.target.checked })}
                    className="rounded border-line"
                  />
                  {t('builder.settings.selfEnrol')}
                </label>
              </div>
            </>
          )}
        </div>

        <div className="bg-canvas border-t border-line px-6 py-3.5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-line bg-surface hover:bg-raised text-xs font-semibold text-ink"
          >
            {t('builder.common.close')}
          </button>
          <button
            disabled={busy || invalid}
            className="px-4 py-2 rounded-xl bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand text-xs font-bold"
          >
            {busy ? t('builder.settings.saving') : t('builder.settings.save')}
          </button>
        </div>
      </form>
    </div>
  );
};
