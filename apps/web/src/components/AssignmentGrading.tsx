'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useApiData } from '@/hooks/useApiData';
import { useStaffCourses } from '@/hooks/useStaffCourses';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useT } from '@/lib/i18n';
import { RubricInputs } from './grading/assignment/RubricInputs';
import { SubmissionsTab } from './grading/assignment/SubmissionsTab';
import { RubricEditorTab } from './grading/assignment/RubricEditorTab';
import { AppealsTab } from './grading/assignment/AppealsTab';
import { inputClass, type Assignment, type Criterion } from './grading/assignment/types';

export { RubricInputs };
export type { Criterion };

export const AssignmentGrading: React.FC<{
  onClose: () => void;
  /** Open on this course when the person may use it. */ initialCourseId?: string | null;
}> = ({ onClose, initialCourseId }) => {
  const t = useT();
  useEscapeKey(onClose);
  const { user } = useAuth();
  const { courses, isLoading } = useStaffCourses();
  const [courseId, setCourseId] = useState('');
  const [assignmentId, setAssignmentId] = useState('');
  const [tab, setTab] = useState<'submissions' | 'rubric' | 'appeals'>('submissions');

  useEffect(() => {
    if (!courseId && courses.length) {
      setCourseId(initialCourseId && courses.some((c) => c.id === initialCourseId) ? initialCourseId : courses[0].id);
    }
  }, [courses, courseId, initialCourseId]);

  const assignments = useApiData<{ data: Assignment[] }>(courseId ? `/api/v1/courses/${courseId}/assignments` : null);
  const list = useMemo(() => assignments.data?.data ?? [], [assignments.data]);
  useEffect(() => {
    setAssignmentId((cur) => (list.some((a) => a.id === cur) ? cur : (list[0]?.id ?? '')));
  }, [list]);
  const assignment = useMemo(() => list.find((a) => a.id === assignmentId), [list, assignmentId]);

  const isAdmin = user?.role === 'TENANT_ADMIN' || user?.role === 'SUPER_ADMIN';
  const isEditor = isAdmin || user?.role === 'INSTRUCTOR';

  return (
    <div
      className="fixed inset-0 z-50 bg-canvas/85 backdrop-blur-md flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('grading.as.title')}
    >
      <div className="bg-surface border border-line rounded-3xl w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="bg-canvas border-b border-line px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-brand/20 border border-brand/30 flex items-center justify-center text-brand-fg">
              <ClipboardCheck className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-ink">{t('grading.as.title')}</h3>
              <p className="text-xs text-ink-muted">{t('grading.as.subtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select className={inputClass} aria-label={t('grading.course')} value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.title}
                </option>
              ))}
            </select>
            <select
              className={inputClass}
              aria-label={t('grading.as.assignment')}
              value={assignmentId}
              onChange={(e) => setAssignmentId(e.target.value)}
            >
              {list.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
            <button
              onClick={onClose}
              aria-label={t('grading.close')}
              className="p-1 rounded-xl hover:bg-raised text-ink-muted hover:text-ink"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="bg-canvas/60 border-b border-line px-6 py-2.5 flex gap-2">
          {(['submissions', 'rubric', 'appeals'] as const).map((id) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold ${tab === id ? 'bg-brand text-on-brand' : 'text-ink-muted hover:bg-surface'}`}
            >
              {t(`grading.as.tab.${id}`)}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="text-xs text-ink-subtle">{t('grading.loading')}</div>
          ) : !courseId ? (
            <div className="text-xs text-ink-subtle p-10 text-center">{t('grading.noCourse')}</div>
          ) : tab === 'appeals' ? (
            <AppealsTab key={courseId} courseId={courseId} canResolve={isEditor} />
          ) : !assignment ? (
            <div className="text-xs text-ink-subtle p-10 text-center">{t('grading.as.noAssignments')}</div>
          ) : tab === 'submissions' ? (
            <SubmissionsTab key={assignment.id} assignment={assignment} canGrade />
          ) : (
            <RubricEditorTab key={assignment.id} assignment={assignment} canEdit={isEditor} onSaved={assignments.reload} />
          )}
        </div>
      </div>
    </div>
  );
};
