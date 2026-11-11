'use client';

import React, { useState } from 'react';
import { ArrowDown, ArrowUp, Save } from 'lucide-react';
import { LessonFields, lessonProblem, type LessonDraft } from '@/components/LessonFields';
import { useT } from '@/lib/i18n';
import { ConfirmDelete } from './ConfirmDelete';
import { iconBtn, primaryBtn, sameDraft, toDraft, type ApiLesson } from './types';

export interface LessonRowProps {
  lesson: ApiLesson;
  label: string;
  busy: boolean;
  canUp: boolean;
  canDown: boolean;
  onSave: (draft: LessonDraft) => void;
  onMove: (delta: number) => void;
  onDelete: () => void;
  courseId: string;
}

export const LessonRow: React.FC<LessonRowProps> = ({ lesson, label, busy, canUp, canDown, onSave, onMove, onDelete, courseId }) => {
  const t = useT();
  const saved = toDraft(lesson);
  const [draft, setDraft] = useState(saved);
  const dirty = !sameDraft(draft, saved);
  const problem = lessonProblem(draft, t);

  return (
    <div className="space-y-1.5">
      <LessonFields
        lesson={draft}
        label={label}
        disabled={busy}
        courseId={courseId}
        onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
        onDelete={() => undefined}
        hideDelete
      />
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-1">
          <button
            onClick={() => onMove(-1)}
            disabled={busy || !canUp || dirty}
            aria-label={t('builder.editor.aria.moveUp', { label })}
            className={iconBtn}
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onMove(1)}
            disabled={busy || !canDown || dirty}
            aria-label={t('builder.editor.aria.moveDown', { label })}
            className={iconBtn}
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <ConfirmDelete
            label={t('builder.editor.aria.delete', { label })}
            warning={t('builder.editor.removeLessonWarning')}
            busy={busy}
            onConfirm={onDelete}
          />
        </div>
        <div className="flex items-center gap-2">
          {problem && dirty && <span className="text-[11px] font-semibold text-accent">{problem}</span>}
          {dirty && !problem && <span className="text-[11px] text-ink-muted">{t('builder.editor.unsaved')}</span>}
          <button
            onClick={() => onSave(draft)}
            disabled={busy || !dirty || !!problem}
            aria-label={t('builder.editor.aria.save', { label })}
            className={primaryBtn}
          >
            <Save className="h-3 w-3" />
            <span>{t('builder.common.save')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
