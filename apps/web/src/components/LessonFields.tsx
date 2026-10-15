"use client";

import React from "react";
import { Trash2 } from "lucide-react";

export type LessonType = "RICHTEXT" | "VIDEO" | "INTERACTIVE_CODE" | "PDF_DOCUMENT" | "EXTERNAL_LTI_TOOL" | "SCORM_PACKAGE";

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

/** Types an instructor can pick. SCORM lessons come from an uploaded package, so they are shown but not chosen. */
export const LESSON_TYPES: { value: LessonType; label: string }[] = [
  { value: "RICHTEXT", label: "Reading" },
  { value: "VIDEO", label: "Video" },
  { value: "INTERACTIVE_CODE", label: "Code lab" },
  { value: "PDF_DOCUMENT", label: "Document" },
  { value: "EXTERNAL_LTI_TOOL", label: "External tool" },
];

export const URL_LABEL: Partial<Record<LessonType, string>> = {
  VIDEO: "Video address (https)",
  PDF_DOCUMENT: "Document address (https)",
  EXTERNAL_LTI_TOOL: "Tool launch address (https)",
};

export const isHttpUrl = (v: string) => {
  try {
    return ["http:", "https:"].includes(new URL(v).protocol);
  } catch {
    return false;
  }
};

export const blankLesson = (patch: Partial<LessonDraft> = {}): LessonDraft => ({
  id: `les_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  title: "",
  type: "RICHTEXT",
  minutes: 15,
  body: "",
  url: "",
  ...patch,
});

/** Why a lesson cannot be saved yet, or null. */
export const lessonProblem = (l: LessonDraft): string | null =>
  !l.title.trim() ? "Every lesson needs a title." : l.url.trim() && !isHttpUrl(l.url.trim()) ? "Addresses must start with http:// or https://." : null;

interface LessonFieldsProps {
  lesson: LessonDraft;
  label: string;
  onChange: (patch: Partial<LessonDraft>) => void;
  onDelete: () => void;
  disabled?: boolean;
  /** Hide the built-in delete button when the parent supplies its own. */
  hideDelete?: boolean;
}

/** The editable fields of one lesson, shared by the course builder and the content editor. */
export const LessonFields: React.FC<LessonFieldsProps> = ({ lesson, label, onChange, onDelete, disabled, hideDelete }) => {
  const isScorm = lesson.type === "SCORM_PACKAGE";
  return (
    <div className="bg-surface border border-line/80 p-3 rounded-xl space-y-2 text-xs">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={lesson.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="Lesson title"
          maxLength={255}
          aria-label={`Title of ${label}`}
          disabled={disabled}
          className="min-w-0 flex-1 bg-canvas border border-line rounded-lg px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:border-brand"
        />
        <select
          value={lesson.type}
          onChange={(e) => onChange({ type: e.target.value as LessonType })}
          aria-label={`Type of ${label}`}
          disabled={disabled || isScorm}
          className="bg-canvas border border-line rounded-lg px-2 py-1.5 text-xs text-ink focus:outline-none focus:border-brand"
        >
          {isScorm && <option value="SCORM_PACKAGE">SCORM module</option>}
          {LESSON_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <input
          type="number"
          min={1}
          max={1440}
          value={lesson.minutes}
          onChange={(e) => onChange({ minutes: Math.min(1440, Math.max(1, Number(e.target.value) || 1)) })}
          aria-label={`Minutes for ${label}`}
          disabled={disabled}
          className="w-16 bg-canvas border border-line rounded-lg px-2 py-1.5 text-xs text-ink focus:outline-none focus:border-brand"
        />
        <span className="text-[10px] text-ink-subtle">min</span>
        {!hideDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={disabled}
            aria-label={`Delete ${label}`}
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
        placeholder={lesson.type === "INTERACTIVE_CODE" ? "Exercise instructions, shown above the code editor" : "Lesson text. Leave a blank line between paragraphs."}
        maxLength={200000}
        aria-label={`Content of ${label}`}
        disabled={disabled}
        className="w-full bg-canvas border border-line rounded-lg px-2.5 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand"
      />
      {URL_LABEL[lesson.type] && (
        <input
          type="url"
          value={lesson.url}
          onChange={(e) => onChange({ url: e.target.value })}
          placeholder={URL_LABEL[lesson.type]}
          maxLength={2048}
          aria-label={`${URL_LABEL[lesson.type]} for ${label}`}
          disabled={disabled}
          className="w-full bg-canvas border border-line rounded-lg px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand"
        />
      )}
    </div>
  );
};
