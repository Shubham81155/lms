'use client';

import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useAction, useApiData } from '@/hooks/useApiData';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useStaffCourses } from '@/hooks/useStaffCourses';
import { Banner } from '@/components/admin/IdentityPanels';
import { tProblem } from '@/components/assessments/ui';
import { eventProblem, toLocalInput } from '@/lib/assessmentForms';
import { useT, type Translator } from '@/lib/i18n';
import { card, danger, ghost, input, label, primary } from '@/components/assessments/ui';

const CATEGORIES = ['EXAM', 'LAB', 'LECTURE', 'OFFICE_HOURS', 'DEADLINE'] as const;
type Category = (typeof CATEGORIES)[number];

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  category: Category;
  startsAt: string;
  endsAt: string;
  timezone: string;
  courseId: string | null;
  source: 'EVENT' | 'QUIZ' | 'ASSIGNMENT';
}

interface Draft {
  title: string;
  description: string;
  category: Category;
  start: string;
  end: string;
  courseId: string; // "" = whole organisation
}

const catLabel = (t: Translator, c: string) => t.dyn(`teach.cal.cat.${c}`, label(c));
const localDateTime = (t: Translator, iso: string) =>
  t.date(iso, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: undefined });

const ORG = '__org__';
const browserZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

/** Live classes keep their own calendar entry; it is managed from Live Classes. */
const isLiveClass = (e: EventRow) => e.category === 'LECTURE' && e.title.startsWith('Live class: ');

const Form: React.FC<{
  initial: Draft;
  editing: boolean;
  courses: { id: string; code: string; title: string }[];
  allowOrg: boolean;
  busy: boolean;
  onSave: (d: Draft) => void;
  onCancel: () => void;
}> = ({ initial, editing, courses, allowOrg, busy, onSave, onCancel }) => {
  const t = useT();
  const [d, setD] = useState(initial);
  const problem = tProblem(t, eventProblem(d));
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  return (
    <form
      className="space-y-3 rounded-2xl border border-brand/40 bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(d);
      }}
    >
      <label className="block space-y-1 text-xs font-semibold text-ink-muted">
        {t('teach.cal.fieldTitle')}
        <input className={`${input} w-full`} maxLength={200} value={d.title} onChange={(e) => set({ title: e.target.value })} />
      </label>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="space-y-1 text-xs font-semibold text-ink-muted">
          {t('teach.cal.fieldType')}
          <select className={`${input} w-full`} value={d.category} onChange={(e) => set({ category: e.target.value as Category })}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {catLabel(t, c)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs font-semibold text-ink-muted">
          {t('teach.cal.fieldFor')}
          <select className={`${input} w-full`} value={d.courseId} disabled={editing} onChange={(e) => set({ courseId: e.target.value })}>
            {allowOrg && <option value={ORG}>{t('teach.cal.forOrg')}</option>}
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} · {c.title}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs font-semibold text-ink-muted">
          {t('teach.cal.fieldStarts')}
          <input className={`${input} w-full`} type="datetime-local" value={d.start} onChange={(e) => set({ start: e.target.value })} />
        </label>
        <label className="space-y-1 text-xs font-semibold text-ink-muted">
          {t('teach.cal.fieldEnds')}
          <input className={`${input} w-full`} type="datetime-local" value={d.end} onChange={(e) => set({ end: e.target.value })} />
        </label>
      </div>
      <label className="block space-y-1 text-xs font-semibold text-ink-muted">
        {t('teach.cal.fieldDetails')}
        <textarea
          className={`${input} w-full`}
          rows={3}
          maxLength={5000}
          value={d.description}
          onChange={(e) => set({ description: e.target.value })}
        />
      </label>
      <p className="text-[11px] text-ink-subtle">{t('teach.cal.timezone', { zone: browserZone() })}</p>
      <div className="flex items-center gap-3">
        <button className={primary} disabled={busy || !!problem}>
          {busy ? t('teach.cal.saving') : editing ? t('teach.cal.saveEvent') : t('teach.cal.addEvent')}
        </button>
        <button type="button" className={ghost} onClick={onCancel}>
          {t('teach.cal.cancel')}
        </button>
        {problem && <span className="text-[11px] text-accent">{problem}</span>}
      </div>
    </form>
  );
};

/** Exams, deadlines, labs and office hours on the academic calendar learners see. */
export const CalendarManager: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  useEscapeKey(onClose);
  const t = useT();
  const { user } = useAuth();
  const isAdmin = user?.role === 'TENANT_ADMIN' || user?.role === 'SUPER_ADMIN';
  const { courses } = useStaffCourses({ editableOnly: true });
  const [filter, setFilter] = useState<string>('');
  const [mode, setMode] = useState<'new' | { edit: string } | { del: string } | null>(null);
  const { busy, error, run, clearError } = useAction();

  // Show what is coming up, plus the last week for reference.
  const from = useMemo(() => new Date(Date.now() - 7 * 86_400_000).toISOString(), []);
  const events = useApiData<{ data: EventRow[] }>('/api/v1/calendar/events', {
    from,
    courseId: filter && filter !== ORG ? filter : undefined,
  });
  // Quiz and assignment due dates are listed too, but they are edited on the quiz or assignment, not here.
  const rows = (events.data?.data ?? []).filter((e) => e.source === 'EVENT' && (filter === ORG ? e.courseId === null : true));
  const courseOf = (id: string | null) => courses.find((c) => c.id === id);
  const canChange = (e: EventRow) => !isLiveClass(e) && (e.courseId ? !!courseOf(e.courseId) : isAdmin);

  const bodyOf = (d: Draft, creating: boolean) => ({
    title: d.title.trim(),
    description: d.description.trim() || null,
    category: d.category,
    startsAt: new Date(d.start).toISOString(),
    endsAt: new Date(d.end).toISOString(),
    timezone: browserZone(),
    ...(creating && d.courseId !== ORG ? { courseId: d.courseId } : {}),
  });

  const create = (d: Draft) =>
    run(async () => {
      await api.post('/api/v1/calendar/events', bodyOf(d, true));
      setMode(null);
      await events.reload();
    });
  const update = (id: string, d: Draft) =>
    run(async () => {
      await api.patch(`/api/v1/calendar/events/${id}`, bodyOf(d, false));
      setMode(null);
      await events.reload();
    });
  const remove = (id: string) =>
    run(async () => {
      await api.delete(`/api/v1/calendar/events/${id}`);
      setMode(null);
      await events.reload();
    });
  const start = (m: typeof mode) => {
    clearError();
    setMode(m);
  };

  const blank: Draft = {
    title: '',
    description: '',
    category: 'EXAM',
    start: '',
    end: '',
    courseId: isAdmin ? ORG : (courses[0]?.id ?? ''),
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/85 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={t('teach.cal.dialog')}
    >
      <div className="flex h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-line bg-canvas px-6 py-4">
          <div>
            <h3 className="text-base font-bold text-ink">{t('teach.cal.title')}</h3>
            <p className="text-xs text-ink-muted">{t('teach.cal.subtitle')}</p>
          </div>
          <div className="flex items-center gap-3">
            <select
              data-readonly-ok
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label={t('teach.cal.filterAria')}
              className="rounded-xl border border-line bg-surface px-3 py-1.5 text-xs text-ink focus:border-brand focus:outline-none"
            >
              <option value="">{t('teach.cal.filterAll')}</option>
              <option value={ORG}>{t('teach.cal.filterOrg')}</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.title}
                </option>
              ))}
            </select>
            <button
              onClick={onClose}
              aria-label={t('teach.cal.close')}
              className="rounded-xl p-1 text-ink-muted transition-colors hover:bg-raised hover:text-ink"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-6">
          {(error || events.error) && <Banner kind="error">{error || events.error}</Banner>}
          {events.isLoading && !events.data && <p className="text-xs text-ink-subtle">{t('teach.cal.loading')}</p>}
          {!events.isLoading && rows.length === 0 && mode !== 'new' && (
            <p className={`${card} text-center text-xs text-ink-muted`}>{t('teach.cal.empty')}</p>
          )}

          <ul className="space-y-3">
            {rows.map((e) => {
              const editing = typeof mode === 'object' && mode !== null && 'edit' in mode && mode.edit === e.id;
              const deleting = typeof mode === 'object' && mode !== null && 'del' in mode && mode.del === e.id;
              const course = courseOf(e.courseId);
              return (
                <li key={e.id} className={`${card} space-y-3`}>
                  {editing ? (
                    <Form
                      initial={{
                        title: e.title,
                        description: e.description ?? '',
                        category: e.category,
                        start: toLocalInput(e.startsAt),
                        end: toLocalInput(e.endsAt),
                        courseId: e.courseId ?? ORG,
                      }}
                      editing
                      courses={course ? [course] : []}
                      allowOrg={e.courseId === null}
                      busy={busy}
                      onSave={(d) => update(e.id, d)}
                      onCancel={() => setMode(null)}
                    />
                  ) : (
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-sm font-bold text-ink">{e.title}</h4>
                          <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[10px] font-bold text-ink-muted">
                            {catLabel(t, e.category)}
                          </span>
                          <span className="rounded-full border border-brand/30 bg-brand/15 px-2 py-0.5 text-[10px] font-bold text-brand-fg">
                            {e.courseId ? (course?.code ?? t('teach.cal.scopeCourse')) : t('teach.cal.scopeEveryone')}
                          </span>
                        </div>
                        <p className="text-[11px] text-ink-muted">
                          {t('teach.cal.range', { start: localDateTime(t, e.startsAt), end: localDateTime(t, e.endsAt) })}
                        </p>
                        {e.description && <p className="mt-1 whitespace-pre-wrap text-xs text-ink">{e.description}</p>}
                        {isLiveClass(e) && <p className="mt-1 text-[11px] text-ink-subtle">{t('teach.cal.managedLive')}</p>}
                      </div>
                      {canChange(e) && (
                        <div className="flex gap-2">
                          <button
                            className={ghost}
                            onClick={() => start({ edit: e.id })}
                            aria-label={t('teach.cal.editAria', { title: e.title })}
                          >
                            {t('teach.cal.edit')}
                          </button>
                          <button
                            className={ghost}
                            onClick={() => start({ del: e.id })}
                            aria-label={t('teach.cal.deleteAria', { title: e.title })}
                          >
                            {t('teach.cal.delete')}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {deleting && (
                    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2.5 text-xs">
                      <span className="text-ink">{t('teach.cal.confirmDelete', { title: e.title })}</span>
                      <button className={danger} disabled={busy} onClick={() => remove(e.id)}>
                        {t('teach.cal.deleteEvent')}
                      </button>
                      <button className={ghost} onClick={() => setMode(null)}>
                        {t('teach.cal.keep')}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {courses.length === 0 && !isAdmin ? (
            <p className="text-[11px] text-ink-subtle">{t('teach.cal.onlyStaff')}</p>
          ) : mode === 'new' ? (
            <Form
              initial={blank}
              editing={false}
              courses={courses}
              allowOrg={isAdmin}
              busy={busy}
              onSave={create}
              onCancel={() => setMode(null)}
            />
          ) : (
            <button className={primary} onClick={() => start('new')}>
              {t('teach.cal.new')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
