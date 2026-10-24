'use client';

import React, { useState } from 'react';
import { Trash2, Upload } from 'lucide-react';
import { UPLOAD_ACCEPT, isUploadLink, uploadFile } from '@/lib/upload';
import { useT, type Translator } from '@/lib/i18n';

export type LessonType = 'RICHTEXT' | 'VIDEO' | 'INTERACTIVE_CODE' | 'PDF_DOCUMENT' | 'EXTERNAL_LTI_TOOL' | 'SCORM_PACKAGE';

export interface LessonDraft {
  id: string;
  title: string;
  type: LessonType;
  minutes: number;
  /** The lesson text; for a code lab, the exercise instructions. */
  body: string;
  /** Video or document address, or the external tool's launch address. */
  url: string;
}

/** Types an instructor can pick (English labels are the fallback; shown through t.dyn). SCORM lessons come from an uploaded package, so they are shown but not chosen. */
export const LESSON_TYPES: { value: LessonType; label: string }[] = [
  { value: 'RICHTEXT', label: 'Reading' },
  { value: 'VIDEO', label: 'Video' },
  { value: 'INTERACTIVE_CODE', label: 'Code lab' },
  { value: 'PDF_DOCUMENT', label: 'Document' },
  { value: 'EXTERNAL_LTI_TOOL', label: 'External tool' },
];

export const URL_LABEL: Partial<Record<LessonType, string>> = {
  VIDEO: 'Video address (https), or upload one',
  PDF_DOCUMENT: 'Document address (https), or upload one',
  EXTERNAL_LTI_TOOL: 'Tool launch address (https)',
};

/** An http(s) address, or a file uploaded here (/api/v1/files/<id>). */
export const isHttpUrl = (v: string) => {
  if (isUploadLink(v)) return true;
  try {
    return ['http:', 'https:'].includes(new URL(v).protocol);
  } catch {
    return false;
  }
};

export const blankLesson = (patch: Partial<LessonDraft> = {}): LessonDraft => ({
  id: `les_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  title: '',
  type: 'RICHTEXT',
  minutes: 15,
  body: '',
  url: '',
  ...patch,
});

/** Why a lesson cannot be saved yet, or null. */
export const lessonProblem = (l: LessonDraft, t: Translator): string | null =>
  !l.title.trim() ? t('builder.lesson.problem.title') : l.url.trim() && !isHttpUrl(l.url.trim()) ? t('builder.lesson.problem.url') : null;

interface LessonFieldsProps {
  lesson: LessonDraft;
  label: string;
  onChange: (patch: Partial<LessonDraft>) => void;
  onDelete: () => void;
  disabled?: boolean;
  /** Hide the built-in delete button when the parent supplies its own. */
  hideDelete?: boolean;
  /** When set, videos and documents can be uploaded to this course instead of linked. */
  courseId?: string;
}

const UPLOADABLE: Partial<Record<LessonType, keyof typeof UPLOAD_ACCEPT>> = { VIDEO: 'video', PDF_DOCUMENT: 'document' };

/** The editable fields of one lesson, shared by the course builder and the content editor. */
export const LessonFields: React.FC<LessonFieldsProps> = ({ lesson, label, onChange, onDelete, disabled, hideDelete, courseId }) => {
  const t = useT();
  const isScorm = lesson.type === 'SCORM_PACKAGE';
  const urlLabel = URL_LABEL[lesson.type] ? t.dyn(`builder.urlLabel.${lesson.type}`, URL_LABEL[lesson.type]!) : null;
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadedName, setUploadedName] = useState<string | null>(null);
  const accept = UPLOADABLE[lesson.type];

  const pick = async (file: File | undefined) => {
    if (!file || !courseId) return;
    setUploading(true);
    setUploadError(null);
    try {
      const up = await uploadFile(file, 'LESSON_MEDIA', courseId);
      setUploadedName(up.filename);
      onChange({ url: up.url });
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : t('builder.lesson.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };
  return (
    <div className="bg-surface border border-line/80 p-3 rounded-xl space-y-2 text-xs">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={lesson.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder={t('builder.lesson.titlePlaceholder')}
          maxLength={255}
          aria-label={t('builder.lesson.aria.title', { label })}
          disabled={disabled}
          className="min-w-0 flex-1 bg-canvas border border-line rounded-lg px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:border-brand"
        />
        <select
          value={lesson.type}
          onChange={(e) => onChange({ type: e.target.value as LessonType })}
          aria-label={t('builder.lesson.aria.type', { label })}
          disabled={disabled || isScorm}
          className="bg-canvas border border-line rounded-lg px-2 py-1.5 text-xs text-ink focus:outline-none focus:border-brand"
        >
          {isScorm && <option value="SCORM_PACKAGE">{t('builder.lessonType.SCORM_PACKAGE')}</option>}
          {LESSON_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {t.dyn(`builder.lessonType.${type.value}`, type.label)}
            </option>
          ))}
        </select>
        <input
          type="number"
          min={1}
          max={1440}
          value={lesson.minutes}
          onChange={(e) => onChange({ minutes: Math.min(1440, Math.max(1, Number(e.target.value) || 1)) })}
          aria-label={t('builder.lesson.aria.minutes', { label })}
          disabled={disabled}
          className="w-16 bg-canvas border border-line rounded-lg px-2 py-1.5 text-xs text-ink focus:outline-none focus:border-brand"
        />
        <span className="text-[10px] text-ink-subtle">{t('builder.common.min')}</span>
        {!hideDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={disabled}
            aria-label={t('builder.lesson.aria.delete', { label })}
            className="text-ink-subtle hover:text-danger transition-colors disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <textarea
        rows={3}
        value={lesson.body}
        onChange={(e) => onChange({ body: e.target.value })}
        placeholder={lesson.type === 'INTERACTIVE_CODE' ? t('builder.lesson.bodyPlaceholderCode') : t('builder.lesson.bodyPlaceholder')}
        maxLength={200000}
        aria-label={t('builder.lesson.aria.content', { label })}
        disabled={disabled}
        className="w-full bg-canvas border border-line rounded-lg px-2.5 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand"
      />
      {urlLabel && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="url"
            value={isUploadLink(lesson.url) ? '' : lesson.url}
            onChange={(e) => {
              setUploadedName(null);
              onChange({ url: e.target.value });
            }}
            placeholder={
              isUploadLink(lesson.url)
                ? uploadedName
                  ? t('builder.lesson.uploadedFileNamed', { name: uploadedName })
                  : t('builder.lesson.uploadedFile')
                : urlLabel
            }
            maxLength={2048}
            aria-label={t('builder.lesson.aria.url', { what: urlLabel, label })}
            disabled={disabled}
            className="min-w-0 flex-1 bg-canvas border border-line rounded-lg px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand"
          />
          {courseId && accept && (
            <label
              className={`inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[11px] font-semibold text-ink hover:bg-raised ${disabled || uploading ? 'pointer-events-none opacity-50' : ''}`}
            >
              <Upload className="h-3 w-3" />
              {uploading ? t('builder.lesson.uploading') : t('builder.lesson.upload')}
              <input
                type="file"
                className="sr-only"
                accept={UPLOAD_ACCEPT[accept]}
                disabled={disabled || uploading}
                aria-label={t('builder.lesson.aria.upload', { label })}
                onChange={(e) => pick(e.target.files?.[0])}
              />
            </label>
          )}
          {isUploadLink(lesson.url) && (
            <a href={lesson.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-[11px] text-brand-fg underline">
              {t('builder.lesson.view')}
            </a>
          )}
        </div>
      )}
      {uploadError && (
        <p role="alert" className="text-[11px] text-danger">
          {uploadError}
        </p>
      )}
    </div>
  );
};
