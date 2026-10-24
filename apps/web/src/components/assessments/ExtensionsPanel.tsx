'use client';

import React, { useState } from 'react';
import { useT } from '@/lib/i18n';
import { api } from '@/lib/api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { Banner } from '@/components/admin/IdentityPanels';
import { card, ghost, input, primary } from './ui';

interface Extension {
  id: string;
  userId: string;
  name: string;
  email: string;
  dueAt: string;
  reason: string | null;
}

interface RosterRow {
  status: string;
  user?: { id: string; firstName: string; lastName: string; email: string };
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Per-learner extensions on one assignment or quiz: who has one, until when, and why. */
export const ExtensionsPanel: React.FC<{ courseId: string; itemType: 'ASSIGNMENT' | 'QUIZ'; itemId: string; courseDue: string | null }> = ({
  courseId,
  itemType,
  itemId,
  courseDue,
}) => {
  const t = useT();
  const list = useApiData<{ data: Extension[] }>('/api/v1/extensions', { itemType, itemId });
  const roster = useApiData<{ data: RosterRow[] }>('/api/v1/enrollments', { courseId, limit: 100 });
  const { busy, error, run } = useAction();
  const [userId, setUserId] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [reason, setReason] = useState('');

  const learners = (roster.data?.data ?? []).filter((r) => r.user && r.status !== 'DROPPED').map((r) => r.user!);

  const grant = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api.put('/api/v1/extensions', {
        itemType,
        itemId,
        userId,
        dueAt: new Date(dueAt).toISOString(),
        reason: reason.trim() || undefined,
      });
      setUserId('');
      setDueAt('');
      setReason('');
      await list.reload();
    });
  };

  const remove = (id: string) =>
    run(async () => {
      await api.delete(`/api/v1/extensions/${id}`);
      await list.reload();
    });

  return (
    <div className={`${card} space-y-3`}>
      <p className="text-xs text-ink-muted">
        {courseDue ? t('assess.ext.due', { when: when(courseDue) }) : t('assess.ext.noDue')} {t('assess.ext.intro')}
      </p>
      {(error || list.error) && <Banner kind="error">{error || list.error}</Banner>}
      {(list.data?.data ?? []).length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {list.data!.data.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
              <div>
                <span className="font-semibold text-ink">{x.name}</span> <span className="text-ink-subtle">{x.email}</span>
                <div className="text-[11px] text-ink-muted">
                  {t('assess.ext.until', { when: when(x.dueAt) })}
                  {x.reason ? ` · ${x.reason}` : ''}
                </div>
              </div>
              <button
                className={ghost}
                disabled={busy}
                onClick={() => remove(x.id)}
                aria-label={t('assess.ext.removeFor', { name: x.name })}
              >
                {t('assess.common.remove')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={grant} className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
          <span className="block">{t('assess.ext.learner')}</span>
          <select className={input} value={userId} onChange={(e) => setUserId(e.target.value)} required>
            <option value="">{t('assess.ext.choose')}</option>
            {learners.map((u) => (
              <option key={u.id} value={u.id}>
                {u.firstName} {u.lastName}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
          <span className="block">{t('assess.ext.newDeadline')}</span>
          <input className={input} type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} required />
        </label>
        <label className="space-y-1 text-[11px] font-semibold text-ink-muted flex-1 min-w-[10rem]">
          <span className="block">{t('assess.ext.reason')}</span>
          <input
            className={`${input} w-full`}
            value={reason}
            maxLength={1000}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('assess.ext.reasonPh')}
          />
        </label>
        <button className={primary} disabled={busy || !userId || !dueAt}>
          {t('assess.ext.grant')}
        </button>
      </form>
    </div>
  );
};
