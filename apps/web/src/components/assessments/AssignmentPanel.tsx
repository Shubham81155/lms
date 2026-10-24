'use client';

import React, { useState } from 'react';
import { useT } from '@/lib/i18n';
import { api } from '@/lib/api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { Banner } from '@/components/admin/IdentityPanels';
import { assignmentProblem, toLocalInput, type AssignmentDraft as Draft } from '@/lib/assessmentForms';
import { ExtensionsPanel } from './ExtensionsPanel';
import { card, danger, ghost, input, primary, tProblem } from './ui';

interface AssignmentRow {
  id: string;
  title: string;
  instructions: string;
  maxPoints: number;
  dueDate: string | null;
  acceptLateUntil: string | null;
  _count?: { submissions: number };
}

const blank: Draft = { title: '', instructions: '', maxPoints: '100', due: '', lateUntil: '' };

const body = (d: Draft) => ({
  title: d.title.trim(),
  instructions: d.instructions.trim(),
  maxPoints: Number(d.maxPoints),
  dueDate: d.due ? new Date(d.due).toISOString() : null,
  acceptLateUntil: d.due && d.lateUntil ? new Date(d.lateUntil).toISOString() : null,
});

const Form: React.FC<{ initial: Draft; saveLabel: string; busy: boolean; onSave: (d: Draft) => void; onCancel: () => void }> = ({
  initial,
  saveLabel,
  busy,
  onSave,
  onCancel,
}) => {
  const t = useT();
  const [d, setD] = useState(initial);
  const problem = tProblem(t, assignmentProblem(d));
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
        {t('assess.common.title')}
        <input className={`${input} w-full`} maxLength={255} value={d.title} onChange={(e) => set({ title: e.target.value })} />
      </label>
      <label className="block space-y-1 text-xs font-semibold text-ink-muted">
        {t('assess.asg.instructions')}
        <textarea
          className={`${input} w-full`}
          rows={5}
          maxLength={50000}
          value={d.instructions}
          onChange={(e) => set({ instructions: e.target.value })}
        />
      </label>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className="space-y-1 text-xs font-semibold text-ink-muted">
          {t('assess.common.points')}
          <input
            className={`${input} w-full`}
            type="number"
            min={1}
            max={10000}
            value={d.maxPoints}
            onChange={(e) => set({ maxPoints: e.target.value })}
          />
        </label>
        <label className="space-y-1 text-xs font-semibold text-ink-muted">
          {t('assess.asg.due')}
          <span className="flex items-center gap-2">
            <input className={`${input} w-full`} type="datetime-local" value={d.due} onChange={(e) => set({ due: e.target.value })} />
            {d.due && (
              <button type="button" className={ghost} onClick={() => set({ due: '', lateUntil: '' })}>
                {t('assess.common.clear')}
              </button>
            )}
          </span>
        </label>
        <label className="space-y-1 text-xs font-semibold text-ink-muted">
          {t('assess.asg.lateUntil')}
          <input
            className={`${input} w-full`}
            type="datetime-local"
            disabled={!d.due}
            value={d.lateUntil}
            onChange={(e) => set({ lateUntil: e.target.value })}
          />
          <span className="block font-normal text-[10px] text-ink-subtle">{t('assess.asg.lateHint')}</span>
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button className={primary} disabled={busy || !!problem}>
          {busy ? t('assess.common.saving') : saveLabel}
        </button>
        <button type="button" className={ghost} onClick={onCancel}>
          {t('assess.common.cancel')}
        </button>
        {problem && <span className="text-[11px] text-accent">{problem}</span>}
      </div>
    </form>
  );
};

/** Create, edit and delete a course's assignments. Grading and rubrics live in "Grade Assignments". */
export const AssignmentPanel: React.FC<{ courseId: string; canEdit: boolean }> = ({ courseId, canEdit }) => {
  const t = useT();
  const list = useApiData<{ data: AssignmentRow[] }>(`/api/v1/courses/${courseId}/assignments`);
  const { busy, error, run, clearError } = useAction();
  const [mode, setMode] = useState<'new' | { edit: string } | { del: string } | { ext: string } | null>(null);
  const items = list.data?.data ?? [];

  const create = (d: Draft) =>
    run(async () => {
      await api.post(`/api/v1/courses/${courseId}/assignments`, body(d));
      setMode(null);
      await list.reload();
    });
  const update = (id: string, d: Draft) =>
    run(async () => {
      await api.patch(`/api/v1/assignments/${id}`, body(d));
      setMode(null);
      await list.reload();
    });
  const remove = (id: string) =>
    run(async () => {
      await api.delete(`/api/v1/assignments/${id}`);
      setMode(null);
      await list.reload();
    });
  const start = (m: typeof mode) => {
    clearError();
    setMode(m);
  };

  return (
    <div className="space-y-3">
      {(error || list.error) && <Banner kind="error">{error || list.error}</Banner>}
      {list.isLoading && !list.data && <p className="text-xs text-ink-subtle">{t('assess.asg.loading')}</p>}
      {!list.isLoading && items.length === 0 && mode !== 'new' && (
        <p className={`${card} text-center text-xs text-ink-muted`}>
          {t('assess.asg.empty')}
          {canEdit ? ` ${t('assess.asg.emptyCreate')}` : ''}
        </p>
      )}

      <ul className="space-y-3">
        {items.map((a) => {
          const editing = typeof mode === 'object' && mode !== null && 'edit' in mode && mode.edit === a.id;
          const deleting = typeof mode === 'object' && mode !== null && 'del' in mode && mode.del === a.id;
          const extending = typeof mode === 'object' && mode !== null && 'ext' in mode && mode.ext === a.id;
          return (
            <li key={a.id} className={`${card} space-y-3`}>
              {editing ? (
                <Form
                  initial={{
                    title: a.title,
                    instructions: a.instructions,
                    maxPoints: String(a.maxPoints),
                    due: toLocalInput(a.dueDate),
                    lateUntil: toLocalInput(a.acceptLateUntil),
                  }}
                  saveLabel={t('assess.asg.save')}
                  busy={busy}
                  onSave={(d) => update(a.id, d)}
                  onCancel={() => setMode(null)}
                />
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="text-sm font-bold text-ink">{a.title}</h4>
                    <p className="text-[11px] text-ink-muted">
                      {t('assess.asg.points', { points: a.maxPoints })} ·{' '}
                      {a.dueDate ? t('assess.asg.dueAt', { when: new Date(a.dueDate).toLocaleString() }) : t('assess.asg.noDue')}
                      {a.acceptLateUntil ? ` · ${t('assess.asg.lateAt', { when: new Date(a.acceptLateUntil).toLocaleString() })}` : ''}
                      {a._count ? ` · ${t.plural('assess.asg.submissions', a._count.submissions)}` : ''}
                    </p>
                    <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-ink">{a.instructions}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className={ghost}
                      onClick={() => start(extending ? null : { ext: a.id })}
                      aria-expanded={extending}
                      aria-label={t('assess.asg.extensionsOn', { title: a.title })}
                    >
                      {t('assess.common.extensions')}
                    </button>
                    {canEdit && (
                      <>
                        <button
                          className={ghost}
                          onClick={() => start({ edit: a.id })}
                          aria-label={t('assess.asg.editTitle', { title: a.title })}
                        >
                          {t('assess.common.edit')}
                        </button>
                        <button
                          className={ghost}
                          onClick={() => start({ del: a.id })}
                          aria-label={t('assess.asg.deleteTitle', { title: a.title })}
                        >
                          {t('assess.common.delete')}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
              {extending && <ExtensionsPanel courseId={courseId} itemType="ASSIGNMENT" itemId={a.id} courseDue={a.dueDate} />}
              {deleting && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2.5 text-xs">
                  <span className="text-ink">{t('assess.asg.confirmDelete', { title: a.title })}</span>
                  <button className={danger} disabled={busy} onClick={() => remove(a.id)}>
                    {t('assess.asg.deleteBtn')}
                  </button>
                  <button className={ghost} onClick={() => setMode(null)}>
                    {t('assess.common.keep')}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {canEdit &&
        (mode === 'new' ? (
          <Form initial={blank} saveLabel={t('assess.asg.create')} busy={busy} onSave={create} onCancel={() => setMode(null)} />
        ) : (
          <button className={primary} onClick={() => start('new')}>
            {t('assess.asg.new')}
          </button>
        ))}
    </div>
  );
};
