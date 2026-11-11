import type { StaffCourse } from '@/hooks/useStaffCourses';
import type { LessonDraft, LessonType } from '@/components/LessonFields';

export interface ApiLesson {
  id: string;
  title: string;
  orderIndex: number;
  contentType: LessonType;
  bodyContent: string | null;
  mediaUrl: string | null;
  ltiToolLaunchUrl: string | null;
  estimatedMinutes: number;
  updatedAt: string;
}

export interface ApiModule {
  id: string;
  title: string;
  orderIndex: number;
  updatedAt: string;
  lessons: ApiLesson[];
}

export type Notice = { kind: 'ok' | 'error'; text: string };

/** The statuses in menu order; their names and the "done" messages come from the catalogue (builder.status.*, builder.editor.statusDone.*). */
export const STATUSES: StaffCourse['status'][] = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];
export const STATUS_ENGLISH: Record<StaffCourse['status'], string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
};

export const toDraft = (l: ApiLesson): LessonDraft => ({
  id: l.id,
  title: l.title,
  type: l.contentType,
  minutes: l.estimatedMinutes,
  body: l.bodyContent ?? '',
  url: (l.contentType === 'EXTERNAL_LTI_TOOL' ? l.ltiToolLaunchUrl : l.mediaUrl) ?? '',
});

/** The fields to send for a lesson. A SCORM lesson's type and package are never touched here. */
export const toPayload = (d: LessonDraft) => {
  const url = d.url.trim();
  const isTool = d.type === 'EXTERNAL_LTI_TOOL';
  const scorm = d.type === 'SCORM_PACKAGE';
  return {
    title: d.title.trim(),
    estimatedMinutes: d.minutes,
    bodyContent: d.body.trim() || null,
    ...(scorm ? {} : { contentType: d.type, mediaUrl: isTool ? null : url || null, ltiToolLaunchUrl: isTool ? url || null : null }),
  };
};

export const sameDraft = (a: LessonDraft, b: LessonDraft) =>
  a.title === b.title && a.type === b.type && a.minutes === b.minutes && a.body === b.body && a.url === b.url;

export const iconBtn = 'rounded-lg p-1 text-ink-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-40';
export const smallBtn =
  'rounded-lg border border-line bg-surface px-2.5 py-1 text-[11px] font-semibold text-ink transition-colors hover:bg-raised disabled:opacity-50';
export const primaryBtn =
  'flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[11px] font-bold text-on-brand transition-colors hover:bg-brand-hover disabled:opacity-50';
