'use client';

import React from 'react';
import { ArrowRight, Award, Clock, FileText } from 'lucide-react';
import { useLocale } from '@/lib/i18n';
import type { CourseDetail, Lesson, UpcomingWork } from './types';

/** The course's front page: where the learner is, what to do next, and what the course is about. */
export const CourseHome: React.FC<{
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
