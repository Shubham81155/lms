'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Archive, BookOpen, FileCheck, Search, Star, Trash2, Users, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { Banner } from '@/components/admin/IdentityPanels';
import { plural } from '@/lib/plural';

// Administrators oversee courses rather than teach them: who teaches what, how many learners, and the
// decisions only they can make (teachers, final grades, archiving). Teaching tools stay with the teachers.

interface Teacher {
  isPrimary: boolean;
  user: { id: string; firstName: string; lastName: string; email?: string; role?: string };
}
interface CourseRow {
  id: string;
  code: string;
  title: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  enrollmentCount: number;
  instructors: Teacher[];
  reviewStatus?: 'PENDING' | 'CHANGES_REQUESTED' | null;
  term?: { name: string } | null;
}
interface Person {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  status: string;
}

const input =
  'bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand';
const primary =
  'px-3 py-1.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-lg text-[11px] font-bold transition-all';
const ghost =
  'inline-flex items-center gap-1 px-2.5 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50';

const STATUS_STYLE: Record<CourseRow['status'], string> = {
  PUBLISHED: 'bg-success/10 text-success border-success/30',
  DRAFT: 'bg-accent/10 text-accent border-accent/30',
  ARCHIVED: 'bg-canvas text-ink-subtle border-line',
};
const PAGE = 25;

const nameOf = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`.trim();

export const AdminCourseTable: React.FC<{ onOpenGradebook: (courseId: string) => void; refreshKey?: number }> = ({
  onOpenGradebook,
  refreshKey,
}) => {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const list = useApiData<{ data: CourseRow[]; pagination: { total: number; totalPages: number } }>('/api/v1/courses', {
    page,
    limit: PAGE,
    search: query || undefined,
    status: status || undefined,
  });
  const { busy, error, run, clearError } = useAction();
  const [editing, setEditing] = useState<CourseRow | null>(null);
  const [archiving, setArchiving] = useState<CourseRow | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const { reload } = list;
  useEffect(() => {
    if (refreshKey) reload();
  }, [refreshKey, reload]);

  const rows = list.data?.data ?? [];
  const total = list.data?.pagination.total ?? 0;
  const pages = list.data?.pagination.totalPages ?? 1;

  const archive = (c: CourseRow) =>
    run(async () => {
      await api.delete(`/api/v1/courses/${c.id}`);
      setArchiving(null);
      setDone(`"${c.title}" is archived. Learners no longer see it.`);
      await reload();
    });

  return (
    <section className="bg-surface border border-line rounded-3xl p-6 shadow-xl space-y-4" aria-labelledby="admin-courses-h">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="admin-courses-h" className="font-bold text-base text-ink flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-brand-fg" />
            All courses
          </h3>
          <p className="text-xs text-ink-muted">
            Teachers create and run courses. Here you choose who teaches them, approve final grades and archive old ones.
          </p>
        </div>
        <form
          className="flex flex-wrap items-center gap-2"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setQuery(search.trim());
          }}
        >
          <label className="relative">
            <span className="sr-only">Search courses</span>
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-ink-subtle" aria-hidden="true" />
            <input
              className={`${input} w-48 pl-8`}
              type="search"
              placeholder="Code or title"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <select
            className={input}
            aria-label="Status"
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value);
            }}
          >
            <option value="">All statuses</option>
            <option value="PUBLISHED">Published</option>
            <option value="DRAFT">Draft</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </form>
      </div>

      {done && <Banner kind="ok">{done}</Banner>}
      {(error || list.error) && <Banner kind="error">{error || list.error}</Banner>}

      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="bg-canvas text-[11px] uppercase tracking-wider text-ink-subtle">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold">
                Course
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Teachers
              </th>
              <th scope="col" className="px-4 py-3 font-semibold text-right">
                Learners
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Status
              </th>
              <th scope="col" className="px-4 py-3 font-semibold text-right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {list.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink-subtle">
                  Loading courses…
                </td>
              </tr>
            )}
            {!list.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink-muted">
                  {query || status ? 'No courses match.' : 'No courses yet. Teachers create them from their own dashboard.'}
                </td>
              </tr>
            )}
            {rows.map((c) => {
              const teachers = [...(c.instructors ?? [])].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
              return (
                <tr key={c.id} className="align-top">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-lg bg-brand/15 text-brand-fg border border-brand/40">
                        {c.code}
                      </span>
                      {c.reviewStatus === 'PENDING' && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-accent/10 text-accent border-accent/30">
                          awaiting review
                        </span>
                      )}
                    </div>
                    <div className="mt-1 font-semibold text-ink">{c.title}</div>
                    {c.term?.name && <div className="text-[11px] text-ink-subtle">{c.term.name}</div>}
                  </td>
                  <td className="px-4 py-3">
                    {teachers.length === 0 ? (
                      <span className="text-accent">No teacher</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {teachers.map((t) => (
                          <li key={t.user.id} className="text-ink">
                            {nameOf(t.user)}
                            {t.isPrimary && teachers.length > 1 && <span className="text-ink-subtle"> (main)</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink">{c.enrollmentCount}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_STYLE[c.status]}`}>
                      {c.status.toLowerCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <button
                        type="button"
                        className={ghost}
                        onClick={() => {
                          clearError();
                          setDone(null);
                          setEditing(c);
                        }}
                        aria-label={`Teachers of ${c.title}`}
                      >
                        <Users className="h-3.5 w-3.5" /> Teachers
                      </button>
                      <button type="button" className={ghost} onClick={() => onOpenGradebook(c.id)} aria-label={`Grades of ${c.title}`}>
                        <FileCheck className="h-3.5 w-3.5" /> Grades
                      </button>
                      {c.status !== 'ARCHIVED' && (
                        <button
                          type="button"
                          className={ghost}
                          onClick={() => {
                            clearError();
                            setDone(null);
                            setArchiving(c);
                          }}
                          aria-label={`Archive ${c.title}`}
                        >
                          <Archive className="h-3.5 w-3.5" /> Archive
                        </button>
                      )}
                    </div>
                    {archiving?.id === c.id && (
                      <div
                        className="mt-2 rounded-xl border border-danger/40 bg-danger/5 p-3 text-right"
                        role="alertdialog"
                        aria-label={`Archive ${c.title}?`}
                      >
                        <p className="text-[11px] text-ink">
                          Archive this course? Learners stop seeing it; its records and grades are kept.
                        </p>
                        <div className="mt-2 flex justify-end gap-2">
                          <button type="button" className={ghost} onClick={() => setArchiving(null)} disabled={busy}>
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="px-3 py-1.5 bg-danger hover:opacity-90 text-white rounded-lg text-[11px] font-bold disabled:opacity-50"
                            onClick={() => archive(c)}
                            disabled={busy}
                          >
                            {busy ? 'Archiving…' : 'Archive'}
                          </button>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <div className="flex items-center justify-between text-[11px] text-ink-muted">
          <span>{plural(total, 'course')}</span>
          {pages > 1 && (
            <div className="flex items-center gap-2">
              <button type="button" className={ghost} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              <span>
                Page {page} of {pages}
              </span>
              <button type="button" className={ghost} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {editing && (
        <TeachersDialog
          course={editing}
          onClose={() => setEditing(null)}
          onSaved={async (text) => {
            setEditing(null);
            setDone(text);
            await reload();
          }}
        />
      )}
    </section>
  );
};

/** Choose a course's teaching team: instructors and teaching assistants, one of them the main teacher. */
const TeachersDialog: React.FC<{ course: CourseRow; onClose: () => void; onSaved: (text: string) => void }> = ({
  course,
  onClose,
  onSaved,
}) => {
  const instructors = useApiData<{ data: Person[] }>('/api/v1/users', { role: 'INSTRUCTOR', limit: 100 });
  const assistants = useApiData<{ data: Person[] }>('/api/v1/users', { role: 'TEACHING_ASSISTANT', limit: 100 });
  const { busy, error, run } = useAction();
  const [team, setTeam] = useState<{ id: string; name: string; role: string; isPrimary: boolean }[]>(() =>
    (course.instructors ?? []).map((t) => ({
      id: t.user.id,
      name: nameOf(t.user),
      role: t.user.role ?? 'INSTRUCTOR',
      isPrimary: t.isPrimary,
    }))
  );
  const [adding, setAdding] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const candidates = useMemo(
    () =>
      [...(instructors.data?.data ?? []), ...(assistants.data?.data ?? [])]
        .filter((p) => (p.status === 'ACTIVE' || p.status === 'INVITED') && !team.some((t) => t.id === p.id))
        .sort((a, b) => nameOf(a).localeCompare(nameOf(b))),
    [instructors.data, assistants.data, team]
  );
  // The role of people already on the team comes from the people list once it has loaded.
  const roleOf = (id: string, fallback: string) =>
    [...(instructors.data?.data ?? []), ...(assistants.data?.data ?? [])].find((p) => p.id === id)?.role ?? fallback;

  const add = () => {
    const p = candidates.find((c) => c.id === adding);
    if (!p) return;
    setTeam((t) => [...t, { id: p.id, name: nameOf(p), role: p.role, isPrimary: t.length === 0 && p.role === 'INSTRUCTOR' }]);
    setAdding('');
  };
  const remove = (id: string) =>
    setTeam((t) => {
      const next = t.filter((m) => m.id !== id);
      // Keep a main teacher when the main one is removed and an instructor is left.
      if (t.find((m) => m.id === id)?.isPrimary) {
        const heir = next.find((m) => roleOf(m.id, m.role) === 'INSTRUCTOR');
        return next.map((m) => ({ ...m, isPrimary: m.id === heir?.id }));
      }
      return next;
    });

  const primaryCount = team.filter((m) => m.isPrimary).length;
  const problem = team.length > 0 && primaryCount !== 1 ? 'Choose the main teacher.' : null;

  const save = () =>
    run(async () => {
      await api.put(`/api/v1/courses/${course.id}/instructors`, {
        instructors: team.map((m) => ({ userId: m.id, isPrimary: m.isPrimary })),
      });
      onSaved(team.length ? `Teachers of "${course.title}" saved.` : `"${course.title}" has no teachers now.`);
    });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/85 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={`Teachers of ${course.title}`}
    >
      <div className="w-full max-w-lg space-y-4 rounded-3xl border border-line bg-surface p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-bold text-base text-ink">Teachers</h3>
            <p className="text-xs text-ink-muted">
              {course.code} · {course.title}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-xl p-1 text-ink-muted hover:bg-raised hover:text-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {team.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line p-4 text-center text-xs text-ink-muted">
            Nobody teaches this course yet.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {team.map((m) => {
              const role = roleOf(m.id, m.role);
              return (
                <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-ink">{m.name}</div>
                    <div className="text-[11px] text-ink-subtle">{role === 'TEACHING_ASSISTANT' ? 'Teaching assistant' : 'Instructor'}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {role === 'INSTRUCTOR' && (
                      <label className="flex items-center gap-1.5 text-[11px] text-ink">
                        <input
                          type="radio"
                          name="main-teacher"
                          checked={m.isPrimary}
                          onChange={() => setTeam((t) => t.map((x) => ({ ...x, isPrimary: x.id === m.id })))}
                        />
                        <Star className="h-3 w-3 text-accent" aria-hidden="true" /> Main
                      </label>
                    )}
                    <button
                      type="button"
                      className="rounded-lg p-1.5 text-ink-muted hover:bg-danger/10 hover:text-danger"
                      onClick={() => remove(m.id)}
                      aria-label={`Remove ${m.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex gap-2">
          <select
            className={`${input} min-w-0 flex-1`}
            aria-label="Add a teacher"
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            disabled={instructors.isLoading}
          >
            <option value="">
              {instructors.isLoading
                ? 'Loading people…'
                : candidates.length
                  ? 'Add an instructor or teaching assistant…'
                  : 'No other instructors or assistants'}
            </option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {nameOf(p)} · {p.role === 'TEACHING_ASSISTANT' ? 'assistant' : 'instructor'}
                {p.status === 'INVITED' ? ' (invited)' : ''}
              </option>
            ))}
          </select>
          <button type="button" className={ghost} onClick={add} disabled={!adding}>
            Add
          </button>
        </div>
        <p className="text-[11px] text-ink-subtle">
          Someone missing? Invite them in People with the Instructor or Teaching assistant role first.
        </p>

        {(problem || error) && <Banner kind="error">{error || problem}</Banner>}

        <div className="flex justify-end gap-2">
          <button type="button" className={ghost} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={primary} onClick={save} disabled={busy || !!problem}>
            {busy ? 'Saving…' : 'Save teachers'}
          </button>
        </div>
      </div>
    </div>
  );
};
