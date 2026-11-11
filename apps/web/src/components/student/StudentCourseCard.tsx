'use client';

import React from 'react';
import { Award, FileCheck, MessageSquare } from 'lucide-react';
import { useT } from '@/lib/i18n';
import type { DisplayCourse } from './types';

export const StudentCourseCard: React.FC<{
  course: DisplayCourse;
  isLeaving: boolean;
  leaveBusy: boolean;
  onOpenHome: () => void;
  onOpenLesson: () => void;
  onOpenForum: () => void;
  onOpenAssignments: () => void;
  onStartLeave: () => void;
  onConfirmLeave: () => void;
  onCancelLeave: () => void;
  onOpenCertificate: (certificateNumber: string) => void;
}> = ({
  course,
  isLeaving,
  leaveBusy,
  onOpenHome,
  onOpenLesson,
  onOpenForum,
  onOpenAssignments,
  onStartLeave,
  onConfirmLeave,
  onCancelLeave,
  onOpenCertificate,
}) => {
  const t = useT();
  return (
    <div className="bg-surface border border-line hover:border-line rounded-2xl p-5 flex flex-col justify-between transition-all group shadow-lg">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold px-2.5 py-0.5 rounded-lg bg-brand/15 text-brand-fg border border-brand/50">{course.code}</span>
          <span className="text-[10px] text-ink-muted bg-canvas px-2 py-0.5 rounded-md border border-line capitalize">
            {t.dyn(`work.status.${course.status.replace(/ /g, '_')}`, course.status)}
          </span>
        </div>

        <div>
          <h3 className="font-bold text-base text-ink">
            <button
              onClick={onOpenHome}
              className="text-left hover:text-brand-fg hover:underline transition-colors"
              title={t('student.openCourseHome')}
            >
              {course.title}
            </button>
          </h3>
          {course.finalGrade !== null && (
            <p className="text-xs text-success mt-0.5">{t('student.finalGrade', { grade: Math.round(course.finalGrade) })}</p>
          )}
        </div>

        <button
          onClick={onOpenLesson}
          className="w-full text-left bg-canvas hover:bg-surface rounded-xl p-2.5 border border-line/80 hover:border-brand/50 text-xs transition-colors group/les"
        >
          <div className="flex items-center justify-between text-[10px] text-ink-subtle uppercase font-semibold">
            <span>
              {course.lessons.total === 0
                ? t('student.lessonState.course')
                : !course.nextLesson
                  ? t('student.lessonState.finished')
                  : course.lessons.completed === 0
                    ? t('student.lessonState.start')
                    : t('student.lessonState.continue')}
            </span>
            <span className="text-brand-fg group-hover/les:translate-x-0.5 transition-transform flex items-center gap-0.5 font-bold">
              {course.nextLesson ? t('student.open') : t('student.review')}
            </span>
          </div>
          <div className="text-ink font-medium truncate mt-0.5">
            {course.nextLesson ? course.nextLesson.title : course.lessons.total === 0 ? t('student.noLessons') : t('student.goAgain')}
          </div>
          {course.nextLesson && (
            <div className="text-[10px] text-ink-subtle truncate">
              {t('student.lessonsDone', {
                moduleTitle: course.nextLesson.moduleTitle,
                completed: course.lessons.completed,
                total: course.lessons.total,
              })}
            </div>
          )}
        </button>
      </div>

      <div className="pt-4 space-y-3">
        <div>
          <div className="flex justify-between text-xs mb-1 font-medium">
            <span className="text-ink-muted">{t('student.progressLabel')}</span>
            <span className="text-ink">{course.progress}%</span>
          </div>
          <div className="w-full bg-canvas rounded-full h-2 overflow-hidden border border-line">
            <div
              className="bg-gradient-to-r from-brand to-brand-hover h-2 rounded-full transition-all"
              style={{ width: `${course.progress}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onOpenForum}
            className="py-2.5 bg-canvas hover:bg-raised text-ink rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border border-line transition-all"
          >
            <MessageSquare className="h-4 w-4 text-orchid" />
            <span>{t('student.forum')}</span>
          </button>

          <button
            onClick={onOpenAssignments}
            className="py-2.5 bg-canvas hover:bg-emerald-600 text-ink hover:text-on-brand rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border border-line hover:border-success transition-all shadow-md"
          >
            <FileCheck className="h-4 w-4 text-success" />
            <span>{t('student.assignments')}</span>
          </button>
        </div>

        {course.open &&
          (isLeaving ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-xs">
              <span className="text-ink">{t('student.leaveConfirm', { code: course.code })}</span>
              <button
                onClick={onConfirmLeave}
                disabled={leaveBusy}
                className="rounded-lg bg-danger px-3 py-1 text-[11px] font-bold text-on-brand disabled:opacity-50"
              >
                {leaveBusy ? t('student.leaving') : t('student.leaveCourse')}
              </button>
              <button
                onClick={onCancelLeave}
                className="rounded-lg border border-line bg-surface px-3 py-1 text-[11px] font-semibold text-ink"
              >
                {t('student.stay')}
              </button>
            </div>
          ) : (
            <button
              onClick={onStartLeave}
              className="text-[11px] font-semibold text-ink-subtle underline-offset-2 hover:text-danger hover:underline"
              aria-label={t('student.leaveAria', { code: course.code })}
            >
              {t('student.leaveCourse')}
            </button>
          ))}

        {course.certificateNumber && (
          <button
            onClick={() => onOpenCertificate(course.certificateNumber!)}
            className="w-full py-2 bg-accent/10 hover:bg-accent/10 text-accent border border-accent/30 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
          >
            <Award className="h-4 w-4" />
            <span>{t('student.viewCertificate')}</span>
          </button>
        )}
      </div>
    </div>
  );
};
