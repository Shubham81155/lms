'use client';

import React from 'react';
import {
  BookOpen,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  Copy,
  FileCheck,
  Megaphone,
  MessageSquare,
  Settings2,
  Users,
  Video,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useStaffCourses, type StaffCourse } from '@/hooks/useStaffCourses';
import { plural } from '@/lib/plural';

/** The per-course tools a dashboard can open. */
export type CourseTool =
  'content' | 'settings' | 'copy' | 'announcements' | 'learners' | 'assessments' | 'grading' | 'gradebook' | 'forum' | 'live' | 'calendar';

const TOOLS: { key: CourseTool; label: string; icon: LucideIcon; editorsOnly?: boolean }[] = [
  { key: 'content', label: 'Content', icon: BookOpen, editorsOnly: true },
  { key: 'settings', label: 'Settings', icon: Settings2, editorsOnly: true },
  { key: 'copy', label: 'Copy', icon: Copy, editorsOnly: true },
  { key: 'announcements', label: 'Announce', icon: Megaphone },
  { key: 'learners', label: 'Learners', icon: Users },
  { key: 'assessments', label: 'Quizzes & assignments', icon: ClipboardList },
  { key: 'grading', label: 'Grade submissions', icon: ClipboardCheck },
  { key: 'gradebook', label: 'Gradebook', icon: FileCheck },
  { key: 'forum', label: 'Forum', icon: MessageSquare },
  { key: 'live', label: 'Live classes', icon: Video },
  { key: 'calendar', label: 'Calendar', icon: CalendarDays },
];

const STATUS_STYLE: Record<StaffCourse['status'], string> = {
  PUBLISHED: 'bg-success/10 text-success border-success/30',
  DRAFT: 'bg-accent/10 text-accent border-accent/30',
  ARCHIVED: 'bg-canvas text-ink-subtle border-line',
};

interface StaffCourseListProps {
  title: string;
  /** Instructors and administrators may change content and settings; teaching assistants may not. */
  canEdit: boolean;
  /** Tools this page can open; others are not shown, so a button never does nothing. */
  tools: CourseTool[];
  onOpen: (tool: CourseTool, courseId: string) => void;
  emptyText: string;
  /** Changes when a course is created elsewhere, to refresh the list. */
  refreshKey?: number;
}

/** The courses a staff member works with, each with its own tools, so every tool opens on the right course. */
export const StaffCourseList: React.FC<StaffCourseListProps> = ({ title, canEdit, tools, onOpen, emptyText, refreshKey }) => {
  const { courses, isLoading, error, reload } = useStaffCourses();
  React.useEffect(() => {
    if (refreshKey) reload();
  }, [refreshKey, reload]);

  const shown = TOOLS.filter((t) => tools.includes(t.key) && (canEdit || !t.editorsOnly));

  return (
    <section className="space-y-4" aria-labelledby="staff-courses-h">
      <div className="flex items-center justify-between">
        <h2 id="staff-courses-h" className="text-lg font-bold text-ink flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-brand-fg" />
          {title}
        </h2>
        {!isLoading && <span className="text-xs text-ink-muted">{plural(courses.length, 'course')}</span>}
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      {isLoading && <p className="text-xs text-ink-subtle">Loading courses…</p>}
      {!isLoading && !error && courses.length === 0 && (
        <p className="rounded-2xl border border-dashed border-line p-8 text-center text-xs text-ink-muted">{emptyText}</p>
      )}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {courses.map((c) => (
          <article key={c.id} className="bg-surface border border-line rounded-2xl p-5 space-y-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold px-2 py-0.5 rounded-lg bg-brand/15 text-brand-fg border border-brand/40">
                    {c.code}
                  </span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_STYLE[c.status]}`}>
                    {c.status.toLowerCase()}
                  </span>
                </div>
                <h3 className="mt-1.5 font-bold text-sm text-ink truncate">{c.title}</h3>
                <p className="text-[11px] text-ink-muted">
                  {plural(c.enrollmentCount, 'learner')} · {plural(c.moduleCount, 'module')}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {shown.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => onOpen(key, c.id)}
                  className="px-2.5 py-1.5 rounded-lg border border-line bg-canvas hover:bg-raised hover:border-brand/40 text-[11px] font-semibold text-ink flex items-center gap-1.5 transition-colors"
                  aria-label={`${label}: ${c.code}`}
                >
                  <Icon className="h-3.5 w-3.5 text-ink-muted" />
                  {label}
                </button>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
};
