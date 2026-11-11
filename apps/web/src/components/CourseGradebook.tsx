'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useStaffCourses } from '@/hooks/useStaffCourses';
import { ScormResults } from '@/components/ScormResults';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useT } from '@/lib/i18n';
import { GradebookSetup } from './grading/gradebook/GradebookSetup';
import { GradebookGrades } from './grading/gradebook/GradebookGrades';
import { GradebookGrid } from './grading/gradebook/GradebookGrid';
import { inputClass } from './grading/gradebook/types';

export const CourseGradebook: React.FC<{
  onClose: () => void;
  /** Open on this course when the person may use it. */ initialCourseId?: string | null;
}> = ({ onClose, initialCourseId }) => {
  const t = useT();
  useEscapeKey(onClose);
  const { user } = useAuth();
  const { courses, isLoading } = useStaffCourses();
  const [courseId, setCourseId] = useState<string>('');
  const [tab, setTab] = useState<'grades' | 'grid' | 'scorm' | 'setup'>('grades');

  useEffect(() => {
    if (!courseId && courses.length > 0) {
      setCourseId(initialCourseId && courses.some((c) => c.id === initialCourseId) ? initialCourseId : courses[0].id);
    }
  }, [courses, courseId, initialCourseId]);

  const isAdmin = user?.role === 'TENANT_ADMIN' || user?.role === 'SUPER_ADMIN';
  const canEdit = isAdmin || user?.role === 'INSTRUCTOR';
  const course = useMemo(() => courses.find((c) => c.id === courseId), [courses, courseId]);

  return (
    <div
      className="fixed inset-0 z-50 bg-canvas/85 backdrop-blur-md flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('grading.gb.title')}
    >
      <div className="bg-surface border border-line rounded-3xl w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="bg-canvas border-b border-line px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-success/20 border border-success/30 flex items-center justify-center text-success">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-ink">{t('grading.gb.title')}</h3>
              <p className="text-xs text-ink-muted">{t('grading.gb.subtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <select className={inputClass} aria-label={t('grading.course')} value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.title}
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
          {(['grades', 'grid', 'scorm', 'setup'] as const).map((id) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold ${tab === id ? 'bg-brand text-on-brand' : 'text-ink-muted hover:bg-surface'}`}
            >
              {t(`grading.gb.tab.${id}`)}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="text-xs text-ink-subtle">{t('grading.gb.loadingCourses')}</div>
          ) : !course ? (
            <div className="text-xs text-ink-subtle p-10 text-center">{t('grading.noCourse')}</div>
          ) : tab === 'grades' ? (
            <GradebookGrades key={course.id} courseId={course.id} canEdit={canEdit} isAdmin={isAdmin} />
          ) : tab === 'grid' ? (
            <GradebookGrid key={course.id} courseId={course.id} courseCode={course.code} />
          ) : tab === 'scorm' ? (
            <ScormResults key={course.id} courseId={course.id} />
          ) : (
            <GradebookSetup key={course.id} courseId={course.id} canEdit={canEdit} />
          )}
        </div>
      </div>
    </div>
  );
};
