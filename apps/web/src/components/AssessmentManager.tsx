'use client';

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useT } from '@/lib/i18n';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useStaffCourses } from '@/hooks/useStaffCourses';
import { AssignmentPanel } from './assessments/AssignmentPanel';
import { QuizPanel } from './assessments/QuizPanel';

type Tab = 'quizzes' | 'assignments';

/**
 * Quizzes and assignments of a course: create and edit them, write questions, review attempts and
 * grade essay and code answers. Assistants can review and grade; only instructors and
 * administrators can create, change or delete.
 */
export const AssessmentManager: React.FC<{
  onClose: () => void;
  /** Open on this course when the person may use it. */ initialCourseId?: string | null;
}> = ({ onClose, initialCourseId }) => {
  useEscapeKey(onClose);
  const t = useT();
  const { user } = useAuth();
  const { courses, isLoading } = useStaffCourses();
  const [courseId, setCourseId] = useState('');
  const [tab, setTab] = useState<Tab>('quizzes');
  const canEdit = user?.role === 'INSTRUCTOR' || user?.role === 'TENANT_ADMIN' || user?.role === 'SUPER_ADMIN';

  useEffect(() => {
    if (!courseId && courses.length > 0)
      setCourseId(initialCourseId && courses.some((c) => c.id === initialCourseId) ? initialCourseId : courses[0].id);
  }, [courses, courseId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/85 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={t('assess.mgr.dialog')}
    >
      <div className="flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-line bg-canvas px-6 py-4">
          <div>
            <h3 className="text-base font-bold text-ink">{t('assess.mgr.dialog')}</h3>
            <p className="text-xs text-ink-muted">{canEdit ? t('assess.mgr.subEdit') : t('assess.mgr.subView')}</p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              aria-label={t('assess.common.course')}
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
              aria-label={t('assess.common.close')}
              className="rounded-xl p-1 text-ink-muted transition-colors hover:bg-raised hover:text-ink"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div
          role="tablist"
          aria-label={t('assess.mgr.tabs')}
          className="flex gap-2 border-b border-line bg-canvas/60 px-6 py-2.5 text-xs font-bold"
        >
          {(['quizzes', 'assignments'] as Tab[]).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              tabIndex={tab === k ? 0 : -1}
              onClick={() => setTab(k)}
              className={`rounded-xl px-3 py-1.5 capitalize transition-all ${tab === k ? 'bg-brand text-on-brand' : 'text-ink-muted hover:bg-surface hover:text-ink'}`}
            >
              {t(`assess.mgr.tab.${k}`)}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <p role="status" className="py-16 text-center text-xs text-ink-muted">
              {t('assess.common.loading')}
            </p>
          ) : courses.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line px-6 py-12 text-center text-xs text-ink-muted">
              {t('assess.mgr.noCourses')}
            </p>
          ) : courseId ? (
            tab === 'quizzes' ? (
              <QuizPanel key={courseId} courseId={courseId} canEdit={canEdit} />
            ) : (
              <AssignmentPanel key={courseId} courseId={courseId} canEdit={canEdit} />
            )
          ) : null}
        </div>
      </div>
    </div>
  );
};
