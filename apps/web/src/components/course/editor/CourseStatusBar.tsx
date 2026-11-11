'use client';

import React from 'react';
import type { StaffCourse } from '@/hooks/useStaffCourses';
import { useT } from '@/lib/i18n';
import { STATUSES, STATUS_ENGLISH, smallBtn } from './types';

export interface CourseStatusBarProps {
  course: StaffCourse;
  busy: boolean;
  needsApproval: boolean;
  pendingStatus: StaffCourse['status'] | null;
  reviewMessage: string;
  onChangePendingStatus: (status: StaffCourse['status'] | null) => void;
  onChangeStatus: (status: StaffCourse['status']) => void;
  onChangeReviewMessage: (msg: string) => void;
  onSubmitForReview: () => void;
}

export const CourseStatusBar: React.FC<CourseStatusBarProps> = ({
  course,
  busy,
  needsApproval,
  pendingStatus,
  reviewMessage,
  onChangePendingStatus,
  onChangeStatus,
  onChangeReviewMessage,
  onSubmitForReview,
}) => {
  const t = useT();
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      <label htmlFor="course-status" className="font-semibold text-ink-muted">
        {t('builder.editor.status')}
      </label>
      <select
        id="course-status"
        value={course.status}
        onChange={(e) => {
          const next = e.target.value as StaffCourse['status'];
          if (next === 'ARCHIVED') onChangePendingStatus(next);
          else onChangeStatus(next);
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
              onChange={(e) => onChangeReviewMessage(e.target.value)}
              maxLength={2000}
              placeholder={t('builder.editor.reviewNotePlaceholder')}
              aria-label={t('builder.editor.reviewNoteLabel')}
              className="w-52 rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink focus:border-brand focus:outline-none"
            />
            <button
              onClick={onSubmitForReview}
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
            onClick={() => onChangeStatus('ARCHIVED')}
            disabled={busy}
            className="rounded-lg bg-danger px-2 py-1 font-bold text-on-brand disabled:opacity-50"
          >
            {t('builder.editor.archive')}
          </button>
          <button onClick={() => onChangePendingStatus(null)} className={smallBtn}>
            {t('builder.common.keep')}
          </button>
        </span>
      )}
    </div>
  );
};
