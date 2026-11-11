'use client';

import React from 'react';
import { Award, CheckCircle2, Home, PlayCircle } from 'lucide-react';
import { useLocale } from '@/lib/i18n';
import type { CourseModule } from './types';

export const LessonSidebar: React.FC<{
  view: 'home' | 'lesson';
  modules: CourseModule[];
  activeLessonId: string | null;
  done: Set<string>;
  onSelectHome: () => void;
  onSelectLesson: (id: string) => void;
  onOpenExam?: () => void;
}> = ({ view, modules, activeLessonId, done, onSelectHome, onSelectLesson, onOpenExam }) => {
  const { t } = useLocale();
  return (
    <div className="w-full space-y-5 overflow-y-auto border-t border-line bg-canvas/60 p-4 md:w-80 md:border-l md:border-t-0">
      <button
        onClick={onSelectHome}
        aria-current={view === 'home'}
        className={`flex w-full items-center gap-2 rounded-xl p-2.5 text-left text-xs font-bold transition-all ${
          view === 'home' ? 'border border-brand/40 bg-brand/20 text-brand-fg' : 'border border-line bg-surface text-ink hover:bg-raised'
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
                  onClick={() => onSelectLesson(lesson.id)}
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
  );
};
