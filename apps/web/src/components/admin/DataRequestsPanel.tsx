'use client';

import React, { useState } from 'react';
import { api } from '@/lib/api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { useAuth } from '@/context/AuthContext';
import { useT, type Translator } from '@/lib/i18n';
import { Banner } from '@/components/admin/IdentityPanels';
import { DUE_SOON_DAYS, KIND_LABEL, REQUEST_KINDS, STATUS_LABEL, isOpen, type QueueRequest, type RequestKind } from '@/lib/dataRequests';

const input =
  'w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand';
const ghostBtn =
  'px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50';
const primaryBtn =
  'px-3 py-1.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-lg text-[11px] font-bold transition-colors';

interface Page {
  data: QueueRequest[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  summary: { open: number; overdue: number };
}

// The first value is the API's filter; the second names the status whose label is shown.
const STATUS_FILTERS = [
  ['open', 'OPEN'],
  ['FULFILLED', 'FULFILLED'],
  ['REJECTED', 'REJECTED'],
  ['CANCELLED', 'CANCELLED'],
] as const;

/** The kinds whose fulfilment has its own note, said before the administrator acts. */
const FULFIL_NOTE_KINDS: readonly RequestKind[] = ['ACCESS', 'ERASURE', 'FERPA_OPT_OUT', 'OTHER'];

// Dates keep the browser's time zone, as before.
const useLabels = () => {
  const t = useT();
  return {
    t,
    day: (iso: string) => t.date(iso, { day: 'numeric', month: 'short', year: 'numeric', timeZone: undefined }),
    kind: (k: RequestKind) => t.dyn(`privacy.requests.kind.${k}`, KIND_LABEL[k]),
    status: (s: QueueRequest['status']) => t.dyn(`privacy.requests.status.${s}`, STATUS_LABEL[s]),
  };
};

/** "Due in 3 days", "Due today", "2 days overdue". */
const dueLabel = (t: Translator, daysLeft: number | null): string => {
  if (daysLeft === null) return '';
  if (daysLeft < 0) return t.plural('privacy.requests.overdue', -daysLeft);
  if (daysLeft === 0) return t('privacy.requests.dueToday');
  return t.plural('privacy.requests.dueIn', daysLeft);
};

const Badge: React.FC<{ r: QueueRequest }> = ({ r }) => {
  const { t, status } = useLabels();
  if (!isOpen(r))
    return (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-raised text-ink-muted border-line">{status(r.status)}</span>
    );
  const cls = r.overdue
    ? 'bg-danger/10 text-danger border-danger/30'
    : (r.daysLeft ?? 99) <= DUE_SOON_DAYS
      ? 'bg-accent/10 text-ink border-accent/40'
      : 'bg-success/10 text-success border-success/30';
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cls}`}>{dueLabel(t, r.daysLeft)}</span>;
};

const RequestRow: React.FC<{ r: QueueRequest; onChanged: () => Promise<unknown> }> = ({ r, onChanged }) => {
  const { user: me } = useAuth();
  const { t, day, kind: kindLabel, status } = useLabels();
  const { busy, error, run } = useAction();
  const [mode, setMode] = useState<'fulfil' | 'reject' | 'notes' | null>(null);
  const [resolution, setResolution] = useState('');
  const [attach, setAttach] = useState(true);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState(r.notes ?? '');
  const own = r.requesterId === me?.id;
  const mineToHandle = r.assignedToId === me?.id;
  const label = kindLabel(r.kind);

  const call = (fn: () => Promise<unknown>) =>
    run(async () => {
      await fn();
      setMode(null);
      await onChanged();
    });

  const take = () => call(() => api.patch(`/api/v1/privacy/requests/${r.id}`, { assignedToId: me?.id }));
  const release = () => call(() => api.patch(`/api/v1/privacy/requests/${r.id}`, { assignedToId: null }));
  const saveNotes = () => call(() => api.patch(`/api/v1/privacy/requests/${r.id}`, { notes: notes.trim() || null }));
  const fulfil = () =>
    call(() =>
      api.post(`/api/v1/privacy/requests/${r.id}/fulfil`, {
        resolution: resolution.trim() || undefined,
        attachExport: r.kind === 'ACCESS' ? attach : undefined,
      })
    );
  const reject = () => call(() => api.post(`/api/v1/privacy/requests/${r.id}/reject`, { reason: reason.trim() }));

  return (
    <li className="p-3 bg-canvas space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <div className="text-xs font-semibold text-ink">
            {label}{' '}
            <span className="font-normal text-ink-subtle">
              · {r.requester ? `${r.requester.name}${r.requester.email ? ` (${r.requester.email})` : ''}` : t('comply.dr.unknownPerson')}
            </span>
          </div>
          <div className="text-[11px] text-ink-subtle">
            {t('privacy.requests.filedOn', { date: day(r.receivedAt) })}
            {t('privacy.requests.due', { date: day(r.dueAt) })}
            {r.status === 'IN_PROGRESS' ? (mineToHandle ? t('comply.dr.assignedYou') : t('comply.dr.assignedOther')) : ''}
            {!isOpen(r) && r.closedAt ? t('comply.dr.closedAs', { status: status(r.status).toLowerCase(), date: day(r.closedAt) }) : ''}
          </div>
        </div>
        <Badge r={r} />
      </div>
      {r.details && <p className="text-xs text-ink-muted whitespace-pre-line">&ldquo;{r.details}&rdquo;</p>}
      {r.resolution && <p className="text-xs text-ink-muted whitespace-pre-line">{t('comply.dr.answer', { text: r.resolution })}</p>}
      {r.notes && mode !== 'notes' && (
        <p className="text-[11px] text-ink-subtle whitespace-pre-line">{t('comply.dr.internalNote', { text: r.notes })}</p>
      )}

      {isOpen(r) && (
        <div className="flex flex-wrap gap-2">
          {own ? (
            <p className="text-[11px] text-ink-subtle">{t('comply.dr.ownRequest')}</p>
          ) : (
            <>
              {!mineToHandle && (
                <button className={ghostBtn} disabled={busy} onClick={take}>
                  {t('comply.dr.take')}
                </button>
              )}
              {mineToHandle && (
                <button className={ghostBtn} disabled={busy} onClick={release}>
                  {t('comply.dr.release')}
                </button>
              )}
              <button className={primaryBtn} disabled={busy} onClick={() => setMode(mode === 'fulfil' ? null : 'fulfil')}>
                {t('comply.dr.fulfilBtn')}
              </button>
              <button
                className={`${ghostBtn} hover:text-danger hover:border-danger/30`}
                disabled={busy}
                onClick={() => setMode(mode === 'reject' ? null : 'reject')}
              >
                {t('comply.dr.declineBtn')}
              </button>
              <button className={ghostBtn} disabled={busy} onClick={() => setMode(mode === 'notes' ? null : 'notes')}>
                {t('comply.dr.notesBtn')}
              </button>
            </>
          )}
        </div>
      )}

      {mode === 'fulfil' && (
        <div className="p-3 rounded-xl border border-line bg-surface space-y-2">
          <p className={`text-[11px] ${r.kind === 'ERASURE' ? 'text-danger' : 'text-ink-muted'}`}>
            {FULFIL_NOTE_KINDS.includes(r.kind) ? t.dyn(`comply.dr.fulfilNote.${r.kind}`, '') : t('comply.dr.fulfilNote.default')}
          </p>
          {r.kind === 'ACCESS' && (
            <label className="flex items-center gap-2 text-xs text-ink">
              <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} /> {t('comply.dr.attach')}
            </label>
          )}
          <label className="block space-y-1">
            <span className="text-[11px] text-ink-muted">
              {r.kind === 'OTHER' ? t('comply.dr.answerRequired') : t('comply.dr.messageOptional')}
            </span>
            <textarea className={input} rows={2} maxLength={4000} value={resolution} onChange={(e) => setResolution(e.target.value)} />
          </label>
          <button className={primaryBtn} disabled={busy || (r.kind === 'OTHER' && resolution.trim().length === 0)} onClick={fulfil}>
            {busy ? t('comply.dr.working') : r.kind === 'ERASURE' ? t('comply.dr.eraseClose') : t('comply.dr.fulfilRequest')}
          </button>
        </div>
      )}
      {mode === 'reject' && (
        <div className="p-3 rounded-xl border border-line bg-surface space-y-2">
          <label className="block space-y-1">
            <span className="text-[11px] text-ink-muted">{t('comply.dr.reason')}</span>
            <textarea className={input} rows={2} maxLength={4000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button
            className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-on-brand rounded-lg text-[11px] font-bold"
            disabled={busy || reason.trim().length < 3}
            onClick={reject}
          >
            {busy ? t('comply.dr.working') : t('comply.dr.declineRequest')}
          </button>
        </div>
      )}
      {mode === 'notes' && (
        <div className="p-3 rounded-xl border border-line bg-surface space-y-2">
          <label className="block space-y-1">
            <span className="text-[11px] text-ink-muted">{t('comply.dr.notesLabel')}</span>
            <textarea className={input} rows={2} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <button className={primaryBtn} disabled={busy} onClick={saveNotes}>
            {t('comply.dr.saveNotes')}
          </button>
        </div>
      )}
      {error && <Banner kind="error">{error}</Banner>}
    </li>
  );
};

/**
 * The administrators' queue of data-subject requests (GDPR Art. 15-21, FERPA), most urgent first. Backed by
 * /api/v1/privacy/requests; every step is audited and the person is e-mailed.
 */
export const DataRequestsPanel: React.FC = () => {
  const { t, kind: kindLabel, status: statusLabel } = useLabels();
  const [status, setStatus] = useState<string>('open');
  const [kind, setKind] = useState<string>('');
  const [overdue, setOverdue] = useState(false);
  const [page, setPage] = useState(1);
  const list = useApiData<Page>('/api/v1/privacy/requests', {
    status,
    kind: kind || undefined,
    overdue: overdue ? 'true' : undefined,
    page,
    limit: 10,
  });
  const p = list.data;

  const refilter =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPage(1);
    };

  return (
    <section className="space-y-5" aria-labelledby="queue-h">
      <div>
        <h3 id="queue-h" className="font-bold text-base text-ink">
          {t('comply.dr.title')}
        </h3>
        <p className="text-xs text-ink-muted">{t('comply.dr.intro', { days: DUE_SOON_DAYS })}</p>
      </div>

      {p && (
        <div className="flex flex-wrap gap-2 text-[11px]" aria-label={t('comply.dr.summary')}>
          <span className="px-2.5 py-1 rounded-full border border-line bg-raised font-semibold text-ink">
            {t('comply.dr.openCount', { count: p.summary.open })}
          </span>
          <span
            className={`px-2.5 py-1 rounded-full border font-semibold ${p.summary.overdue > 0 ? 'bg-danger/10 border-danger/30 text-danger' : 'bg-success/10 border-success/30 text-success'}`}
          >
            {t('comply.dr.overdueCount', { count: p.summary.overdue })}
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-[11px] text-ink-muted">
          {t('comply.dr.show')}
          <select className={input} value={status} onChange={(e) => refilter(setStatus)(e.target.value)}>
            {STATUS_FILTERS.map(([v, s]) => (
              <option key={v} value={v}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-[11px] text-ink-muted">
          {t('comply.dr.kind')}
          <select className={input} value={kind} onChange={(e) => refilter(setKind)(e.target.value)}>
            <option value="">{t('comply.dr.allKinds')}</option>
            {REQUEST_KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-ink pb-2">
          <input type="checkbox" checked={overdue} onChange={(e) => refilter(setOverdue)(e.target.checked)} /> {t('comply.dr.overdueOnly')}
        </label>
      </div>

      {list.error && <Banner kind="error">{list.error}</Banner>}
      {list.isLoading && !p && <p className="text-xs text-ink-subtle">{t('privacy.requests.loading')}</p>}
      {p && p.data.length === 0 && <p className="text-xs text-ink-subtle">{t('comply.dr.noMatch')}</p>}
      {p && p.data.length > 0 && (
        <ul className="divide-y divide-line border border-line rounded-2xl overflow-hidden" aria-label={t('comply.dr.listLabel')}>
          {p.data.map((r) => (
            <RequestRow key={`${r.id}-${r.status}-${r.assignedToId}-${r.notes}`} r={r} onChanged={list.reload} />
          ))}
        </ul>
      )}
      {p && p.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-[11px] text-ink-muted">
          <button className={ghostBtn} disabled={page <= 1} onClick={() => setPage(page - 1)}>
            {t('comply.dr.prev')}
          </button>
          <span>{t('comply.dr.pageOf', { page: p.pagination.page, total: p.pagination.totalPages })}</span>
          <button className={ghostBtn} disabled={page >= p.pagination.totalPages} onClick={() => setPage(page + 1)}>
            {t('comply.dr.next')}
          </button>
        </div>
      )}
    </section>
  );
};
