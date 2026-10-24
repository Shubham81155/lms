'use client';

import React, { useState } from 'react';
import { api } from '@/lib/api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { useAuth } from '@/context/AuthContext';
import { Banner } from '@/components/admin/IdentityPanels';
import {
  DUE_SOON_DAYS,
  KIND_LABEL,
  REQUEST_KINDS,
  STATUS_LABEL,
  day,
  dueText,
  isOpen,
  type QueueRequest,
  type RequestKind,
} from '@/lib/dataRequests';

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

const STATUS_FILTERS = [
  ['open', 'Open'],
  ['FULFILLED', 'Done'],
  ['REJECTED', 'Declined'],
  ['CANCELLED', 'Cancelled'],
] as const;

/** What fulfilling does, said before the administrator does it. */
const FULFIL_NOTE: Partial<Record<RequestKind, string>> = {
  ACCESS: "The person's data is attached to the request for them to download.",
  ERASURE:
    'This erases the account: name, e-mail, sign-in details and what they wrote. Grades stay without identifying them. It cannot be undone.',
  FERPA_OPT_OUT: "The person's name is hidden from classmates.",
  OTHER: 'Write the answer the person receives.',
};

const Badge: React.FC<{ r: QueueRequest }> = ({ r }) => {
  if (!isOpen(r))
    return (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-raised text-ink-muted border-line">
        {STATUS_LABEL[r.status]}
      </span>
    );
  const cls = r.overdue
    ? 'bg-danger/10 text-danger border-danger/30'
    : (r.daysLeft ?? 99) <= DUE_SOON_DAYS
      ? 'bg-accent/10 text-ink border-accent/40'
      : 'bg-success/10 text-success border-success/30';
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cls}`}>{dueText(r.daysLeft)}</span>;
};

const RequestRow: React.FC<{ r: QueueRequest; onChanged: () => Promise<unknown> }> = ({ r, onChanged }) => {
  const { user: me } = useAuth();
  const { busy, error, run } = useAction();
  const [mode, setMode] = useState<'fulfil' | 'reject' | 'notes' | null>(null);
  const [resolution, setResolution] = useState('');
  const [attach, setAttach] = useState(true);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState(r.notes ?? '');
  const own = r.requesterId === me?.id;
  const mineToHandle = r.assignedToId === me?.id;
  const label = KIND_LABEL[r.kind];

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
              · {r.requester ? `${r.requester.name}${r.requester.email ? ` (${r.requester.email})` : ''}` : 'unknown person'}
            </span>
          </div>
          <div className="text-[11px] text-ink-subtle">
            Filed {day(r.receivedAt)} · answer due {day(r.dueAt)}
            {r.status === 'IN_PROGRESS' ? (mineToHandle ? ' · assigned to you' : ' · assigned to another administrator') : ''}
            {!isOpen(r) && r.closedAt ? ` · ${STATUS_LABEL[r.status].toLowerCase()} ${day(r.closedAt)}` : ''}
          </div>
        </div>
        <Badge r={r} />
      </div>
      {r.details && <p className="text-xs text-ink-muted whitespace-pre-line">&ldquo;{r.details}&rdquo;</p>}
      {r.resolution && <p className="text-xs text-ink-muted whitespace-pre-line">Answer: {r.resolution}</p>}
      {r.notes && mode !== 'notes' && <p className="text-[11px] text-ink-subtle whitespace-pre-line">Internal note: {r.notes}</p>}

      {isOpen(r) && (
        <div className="flex flex-wrap gap-2">
          {own ? (
            <p className="text-[11px] text-ink-subtle">You filed this request: another administrator has to handle it.</p>
          ) : (
            <>
              {!mineToHandle && (
                <button className={ghostBtn} disabled={busy} onClick={take}>
                  Take it
                </button>
              )}
              {mineToHandle && (
                <button className={ghostBtn} disabled={busy} onClick={release}>
                  Back to the queue
                </button>
              )}
              <button className={primaryBtn} disabled={busy} onClick={() => setMode(mode === 'fulfil' ? null : 'fulfil')}>
                Fulfil…
              </button>
              <button
                className={`${ghostBtn} hover:text-danger hover:border-danger/30`}
                disabled={busy}
                onClick={() => setMode(mode === 'reject' ? null : 'reject')}
              >
                Decline…
              </button>
              <button className={ghostBtn} disabled={busy} onClick={() => setMode(mode === 'notes' ? null : 'notes')}>
                Notes
              </button>
            </>
          )}
        </div>
      )}

      {mode === 'fulfil' && (
        <div className="p-3 rounded-xl border border-line bg-surface space-y-2">
          <p className={`text-[11px] ${r.kind === 'ERASURE' ? 'text-danger' : 'text-ink-muted'}`}>
            {FULFIL_NOTE[r.kind] ?? 'Close the request as done.'}
          </p>
          {r.kind === 'ACCESS' && (
            <label className="flex items-center gap-2 text-xs text-ink">
              <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} /> Attach their data for download
            </label>
          )}
          <label className="block space-y-1">
            <span className="text-[11px] text-ink-muted">
              {r.kind === 'OTHER' ? 'Answer (required)' : 'Message to the person (optional)'}
            </span>
            <textarea className={input} rows={2} maxLength={4000} value={resolution} onChange={(e) => setResolution(e.target.value)} />
          </label>
          <button className={primaryBtn} disabled={busy || (r.kind === 'OTHER' && resolution.trim().length === 0)} onClick={fulfil}>
            {busy ? 'Working…' : r.kind === 'ERASURE' ? 'Erase and close' : 'Fulfil request'}
          </button>
        </div>
      )}
      {mode === 'reject' && (
        <div className="p-3 rounded-xl border border-line bg-surface space-y-2">
          <label className="block space-y-1">
            <span className="text-[11px] text-ink-muted">Reason (the person is told)</span>
            <textarea className={input} rows={2} maxLength={4000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button
            className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-on-brand rounded-lg text-[11px] font-bold"
            disabled={busy || reason.trim().length < 3}
            onClick={reject}
          >
            {busy ? 'Working…' : 'Decline request'}
          </button>
        </div>
      )}
      {mode === 'notes' && (
        <div className="p-3 rounded-xl border border-line bg-surface space-y-2">
          <label className="block space-y-1">
            <span className="text-[11px] text-ink-muted">Internal notes (never shown to the person)</span>
            <textarea className={input} rows={2} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <button className={primaryBtn} disabled={busy} onClick={saveNotes}>
            Save notes
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
          Data requests
        </h3>
        <p className="text-xs text-ink-muted">
          People&apos;s requests about their own data. Each has a deadline; you are e-mailed when one is due within {DUE_SOON_DAYS} days or
          overdue.
        </p>
      </div>

      {p && (
        <div className="flex flex-wrap gap-2 text-[11px]" aria-label="Summary">
          <span className="px-2.5 py-1 rounded-full border border-line bg-raised font-semibold text-ink">{p.summary.open} open</span>
          <span
            className={`px-2.5 py-1 rounded-full border font-semibold ${p.summary.overdue > 0 ? 'bg-danger/10 border-danger/30 text-danger' : 'bg-success/10 border-success/30 text-success'}`}
          >
            {p.summary.overdue} overdue
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-[11px] text-ink-muted">
          Show
          <select className={input} value={status} onChange={(e) => refilter(setStatus)(e.target.value)}>
            {STATUS_FILTERS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-[11px] text-ink-muted">
          Kind
          <select className={input} value={kind} onChange={(e) => refilter(setKind)(e.target.value)}>
            <option value="">All kinds</option>
            {REQUEST_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-ink pb-2">
          <input type="checkbox" checked={overdue} onChange={(e) => refilter(setOverdue)(e.target.checked)} /> Overdue only
        </label>
      </div>

      {list.error && <Banner kind="error">{list.error}</Banner>}
      {list.isLoading && !p && <p className="text-xs text-ink-subtle">Loading…</p>}
      {p && p.data.length === 0 && <p className="text-xs text-ink-subtle">No requests match.</p>}
      {p && p.data.length > 0 && (
        <ul className="divide-y divide-line border border-line rounded-2xl overflow-hidden" aria-label="Data requests">
          {p.data.map((r) => (
            <RequestRow key={`${r.id}-${r.status}-${r.assignedToId}-${r.notes}`} r={r} onChanged={list.reload} />
          ))}
        </ul>
      )}
      {p && p.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-[11px] text-ink-muted">
          <button className={ghostBtn} disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span>
            Page {p.pagination.page} of {p.pagination.totalPages}
          </span>
          <button className={ghostBtn} disabled={page >= p.pagination.totalPages} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      )}
    </section>
  );
};
