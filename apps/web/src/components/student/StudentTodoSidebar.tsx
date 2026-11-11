'use client';

import React from 'react';
import { Brain, FileCheck, Megaphone, Sparkles } from 'lucide-react';
import { relativeTime } from '@/components/CourseAnnouncements';
import { useT } from '@/lib/i18n';
import type { AnnouncementItem, TodoItem } from './types';

export const StudentTodoSidebar: React.FC<{
  todoItems: TodoItem[] | null;
  todoLoading: boolean;
  todoError: string | null;
  announcements: AnnouncementItem[];
  aiEnabled: boolean;
  onOpenQuiz: (quizId: string) => void;
  onOpenAssignments: (courseId: string) => void;
  onOpenAnnouncements: (course: { id: string; label: string }) => void;
  onOpenAiTutor: () => void;
}> = ({
  todoItems,
  todoLoading,
  todoError,
  announcements,
  aiEnabled,
  onOpenQuiz,
  onOpenAssignments,
  onOpenAnnouncements,
  onOpenAiTutor,
}) => {
  const t = useT();
  return (
    <div className="space-y-6">
      <div id="exams-section" className="bg-surface border border-line rounded-2xl p-5 space-y-4 shadow-lg scroll-mt-20">
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div className="flex items-center gap-2 text-sm font-bold text-ink">
            <FileCheck className="h-4 w-4 text-brand-fg" />
            <span>{t('student.todo.title')}</span>
          </div>
          <span className="text-[11px] text-ink-subtle">{todoItems ? t('student.todo.count', { count: todoItems.length }) : ''}</span>
        </div>

        <div className="space-y-3">
          {todoLoading && <p className="text-xs text-ink-subtle">{t('common.loading')}</p>}
          {todoError && (
            <p role="alert" className="text-xs text-danger">
              {todoError}
            </p>
          )}
          {todoItems && todoItems.length === 0 && <p className="text-xs text-ink-subtle text-center p-4">{t('student.allCaughtUp')}</p>}
          {(todoItems ?? []).map((item) => {
            const quiz = item.type === 'QUIZ';
            return (
              <button
                key={`${item.type}-${item.id}`}
                onClick={() => (quiz ? onOpenQuiz(item.id) : onOpenAssignments(item.course.id))}
                className="w-full text-left p-3 bg-canvas hover:bg-surface/90 rounded-xl border border-line/80 hover:border-brand/50 space-y-2 transition-all group shadow-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-ink group-hover:text-brand-fg transition-colors">{item.title}</span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${quiz ? (item.requireProctoring ? 'bg-danger/10 text-danger border-danger/30' : 'bg-orchid/15 text-orchid border-orchid/30') : 'bg-brand/15 text-brand-fg border-brand/30'}`}
                  >
                    {quiz
                      ? item.requireProctoring
                        ? t('student.badge.proctored')
                        : t('student.badge.quiz')
                      : t('student.badge.assignment')}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-ink-muted">
                  <span>
                    {item.course.code} · {item.course.title}
                  </span>
                  <span className={item.overdue ? 'text-danger font-medium' : 'text-accent font-medium'}>
                    {item.submitted
                      ? t('student.todo.submitted')
                      : item.overdue
                        ? t('student.todo.overdue')
                        : item.opensAt
                          ? t('student.todo.opens', { date: t.date(item.opensAt) })
                          : item.dueAt
                            ? t(item.extended ? 'student.todo.dueExtended' : 'student.todo.due', { date: t.date(item.dueAt) })
                            : quiz
                              ? item.hasOpenAttempt
                                ? t('student.todo.inProgress')
                                : t.plural('student.todo.attemptsLeft', item.attemptsRemaining ?? 0)
                              : ''}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {announcements.length > 0 && (
        <div className="bg-surface border border-line rounded-2xl p-5 space-y-3 shadow-lg">
          <div className="flex items-center gap-2 text-sm font-bold text-ink border-b border-line pb-3">
            <Megaphone className="h-4 w-4 text-brand-fg" />
            <span>{t('student.announcements')}</span>
          </div>
          {announcements.map((a) => (
            <button
              key={a.id}
              onClick={() => onOpenAnnouncements({ id: a.course.id, label: a.course.code })}
              className="w-full text-left p-3 bg-canvas hover:bg-surface/90 rounded-xl border border-line/80 hover:border-brand/50 space-y-1"
            >
              <div className="flex items-center justify-between gap-2 text-[10px] text-ink-subtle">
                <span className="font-bold">{a.course.code}</span>
                <span>{relativeTime(t, a.createdAt)}</span>
              </div>
              <div className="text-xs font-bold text-ink">{a.title}</div>
              <p className="text-[11px] text-ink-muted line-clamp-2">{a.body}</p>
            </button>
          ))}
        </div>
      )}

      {aiEnabled && (
        <div className="bg-gradient-to-br from-brand/15 via-brand/10 to-surface border border-brand/30 rounded-2xl p-5 space-y-3 shadow-lg">
          <div className="flex items-center gap-2 text-brand-fg font-bold text-sm">
            <Sparkles className="h-4 w-4 text-brand-fg" />
            <span>{t('student.tutor')}</span>
          </div>
          <p className="text-xs text-ink leading-relaxed">
            Ask about anything in your courses. The tutor reads your lessons, explains step by step and can quiz you.
          </p>
          <button
            onClick={onOpenAiTutor}
            className="w-full py-2.5 bg-brand hover:bg-brand-hover text-on-brand rounded-xl text-xs font-bold transition-all shadow-md shadow-brand/20 flex items-center justify-center gap-1.5"
          >
            <Brain className="h-4 w-4" />
            <span>{t('student.askTutor')}</span>
          </button>
        </div>
      )}
    </div>
  );
};
