'use client';

import React, { useState } from 'react';
import { ArrowDown, ArrowUp, Package, Plus, Save } from 'lucide-react';
import { api } from '@/lib/api';
import { UPLOAD_ACCEPT, uploadFile } from '@/lib/upload';
import { LessonFields, blankLesson, lessonProblem, type LessonDraft } from '@/components/LessonFields';
import { useT } from '@/lib/i18n';
import { ConfirmDelete } from './ConfirmDelete';
import { LessonRow } from './LessonRow';
import { iconBtn, primaryBtn, smallBtn, toPayload, type ApiModule } from './types';

export interface ModuleCardProps {
  module: ApiModule;
  index: number;
  count: number;
  busy: boolean;
  act: (work: () => Promise<unknown>, okText: string) => Promise<boolean>;
  courseId: string;
  onMoveModule: (delta: number) => void;
}

export const ModuleCard: React.FC<ModuleCardProps> = ({ module, index, count, busy, act, courseId, onMoveModule }) => {
  const t = useT();
  const [title, setTitle] = useState(module.title);
  const [adding, setAdding] = useState<LessonDraft | null>(null);
  const [uploadingScorm, setUploadingScorm] = useState(false);
  const base = `/api/v1/courses/${courseId}`;
  const name = t('builder.label.module', { n: index + 1 });
  const titleDirty = title.trim() !== module.title && title.trim().length > 0;

  /** Upload a SCORM zip, unpack it into a package, and add a lesson that plays it. */
  const addScorm = async (file: File | undefined) => {
    if (!file) return;
    setUploadingScorm(true);
    try {
      await act(async () => {
        const up = await uploadFile(file, 'SCORM_PACKAGE', courseId);
        const pkg = await api.post<{ data: { id: string; title: string } }>(`/api/v1/courses/${courseId}/scorm-packages`, {
          fileId: up.id,
        });
        await api.post(`${base}/modules/${module.id}/lessons`, {
          title: pkg.data.title,
          contentType: 'SCORM_PACKAGE',
          scormPackageId: pkg.data.id,
        });
      }, t('builder.editor.scormAdded'));
    } finally {
      setUploadingScorm(false);
    }
  };

  const moveLesson = (from: number, delta: number) => {
    const order = module.lessons.map((l) => l);
    const [moved] = order.splice(from, 1);
    order.splice(from + delta, 0, moved);
    return act(async () => {
      for (const [i, l] of order.entries()) {
        if (l.orderIndex !== i) await api.patch(`${base}/lessons/${l.id}`, { orderIndex: i });
      }
    }, t('builder.editor.lessonMoved'));
  };

  return (
    <div className="space-y-3 rounded-2xl border border-line bg-canvas p-4">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-xs font-bold text-ink-muted">{t('builder.editor.moduleN', { n: index + 1 })}</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('builder.editor.moduleTitlePlaceholder')}
          aria-label={t('builder.editor.aria.moduleTitle', { name })}
          maxLength={255}
          disabled={busy}
          className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-1.5 text-xs font-bold text-ink focus:border-brand focus:outline-none"
        />
        {titleDirty && (
          <button
            onClick={() => act(() => api.patch(`${base}/modules/${module.id}`, { title: title.trim() }), t('builder.editor.moduleRenamed'))}
            disabled={busy}
            aria-label={t('builder.editor.aria.saveTitle', { name })}
            className={primaryBtn}
          >
            <Save className="h-3 w-3" />
            <span>{t('builder.common.save')}</span>
          </button>
        )}
        <button
          onClick={() => onMoveModule(-1)}
          disabled={busy || index === 0}
          aria-label={t('builder.editor.aria.moveUp', { label: name })}
          className={iconBtn}
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => onMoveModule(1)}
          disabled={busy || index === count - 1}
          aria-label={t('builder.editor.aria.moveDown', { label: name })}
          className={iconBtn}
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
        <ConfirmDelete
          label={t('builder.editor.aria.delete', { label: name })}
          warning={t.plural('builder.editor.removeModuleWarning', module.lessons.length)}
          busy={busy}
          onConfirm={() => act(() => api.delete(`${base}/modules/${module.id}`), t('builder.editor.moduleDeleted'))}
        />
      </div>

      {module.lessons.length === 0 && !adding && <p className="text-[11px] text-ink-subtle">{t('builder.editor.noLessons')}</p>}

      <div className="space-y-4">
        {module.lessons.map((lesson, i) => (
          <LessonRow
            courseId={courseId}
            key={`${lesson.id}:${lesson.updatedAt}`}
            lesson={lesson}
            label={t('builder.label.lesson', { lesson: i + 1, module: name })}
            busy={busy}
            canUp={i > 0}
            canDown={i < module.lessons.length - 1}
            onSave={(d) => act(() => api.patch(`${base}/lessons/${lesson.id}`, toPayload(d)), t('builder.editor.lessonSaved'))}
            onMove={(delta) => moveLesson(i, delta)}
            onDelete={() => act(() => api.delete(`${base}/lessons/${lesson.id}`), t('builder.editor.lessonDeleted'))}
          />
        ))}
      </div>

      {adding ? (
        <div className="space-y-2 rounded-xl border border-dashed border-brand/50 p-2">
          <p className="px-1 text-[11px] font-bold text-brand-fg">{t('builder.editor.newLessonHeading')}</p>
          <LessonFields
            lesson={adding}
            label={t('builder.label.newLesson', { module: name })}
            disabled={busy}
            courseId={courseId}
            onChange={(patch) => setAdding((d) => (d ? { ...d, ...patch } : d))}
            onDelete={() => setAdding(null)}
          />
          <div className="flex items-center justify-end gap-2">
            {lessonProblem(adding, t) && adding.title.length > 0 && (
              <span className="text-[11px] font-semibold text-accent">{lessonProblem(adding, t)}</span>
            )}
            <button onClick={() => setAdding(null)} className={smallBtn}>
              {t('builder.common.cancel')}
            </button>
            <button
              onClick={async () => {
                const d = adding;
                const ok = await act(() => api.post(`${base}/modules/${module.id}/lessons`, toPayload(d)), t('builder.editor.lessonAdded'));
                if (ok) setAdding(null);
              }}
              disabled={busy || !!lessonProblem(adding, t)}
              aria-label={t('builder.editor.aria.addLessonTo', { name })}
              className={primaryBtn}
            >
              <Plus className="h-3 w-3" />
              <span>{t('builder.editor.addLesson')}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <button
            onClick={() => setAdding(blankLesson())}
            disabled={busy}
            className="text-[11px] font-semibold text-brand-fg hover:underline disabled:opacity-50"
          >
            {t('builder.editor.newLessonLink')}
          </button>
          <label
            className={`inline-flex cursor-pointer items-center gap-1 text-[11px] font-semibold text-brand-fg hover:underline ${busy || uploadingScorm ? 'pointer-events-none opacity-50' : ''}`}
          >
            <Package className="h-3 w-3" />
            {uploadingScorm ? t('builder.editor.uploading') : t('builder.editor.addScorm')}
            <input
              type="file"
              className="sr-only"
              accept={UPLOAD_ACCEPT.scorm}
              disabled={busy || uploadingScorm}
              aria-label={t('builder.editor.aria.addScormTo', { name })}
              onChange={(e) => {
                addScorm(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
};
