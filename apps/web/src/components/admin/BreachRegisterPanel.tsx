'use client';

import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { Banner } from '@/components/admin/IdentityPanels';
import { useT } from '@/lib/i18n';

const input =
  'w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand';
const ghostBtn =
  'px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50 inline-flex items-center gap-1.5';
const primaryBtn =
  'px-3 py-1.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-lg text-[11px] font-bold transition-colors';

const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const STATUSES = ['DETECTED', 'CONTAINED', 'NOTIFIED', 'CLOSED'] as const;
type Severity = (typeof SEVERITIES)[number];
type Status = (typeof STATUSES)[number];

interface Breach {
  id: string;
  title: string;
  description: string;
  categories: string[];
  affectedEstimate: number | null;
  severity: Severity;
  status: Status;
  detectedAt: string;
  occurredAt: string | null;
  containment: string | null;
  boardNotifiedAt: string | null;
  peopleNotifiedAt: string | null;
  noNotificationReason: string | null;
  closedAt: string | null;
  dueAt: string;
  hoursLeft: number | null;
  overdue: boolean;
}
interface Register {
  data: Breach[];
  summary: { open: number; overdue: number };
}

const SEVERITY_STYLE: Record<Severity, string> = {
  LOW: 'border-line bg-raised text-ink-muted',
  MEDIUM: 'border-accent/40 bg-accent/10 text-ink',
  HIGH: 'border-danger/30 bg-danger/10 text-danger',
  CRITICAL: 'border-danger/40 bg-danger/20 text-danger',
};
const STATUS_FALLBACK: Record<Status, string> = {
  DETECTED: 'Detected',
  CONTAINED: 'Contained',
  NOTIFIED: 'Board notified',
  CLOSED: 'Closed',
};
const NEXT: Partial<Record<Status, Status>> = { DETECTED: 'CONTAINED', CONTAINED: 'NOTIFIED', NOTIFIED: 'CLOSED' };

// Shown in the viewer's own time zone, as before (t.date would otherwise force UTC).
const WHEN: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: undefined,
};
/** An ISO instant as the value of a datetime-local input (local time). */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);
const nowLocal = () => toLocalInput(new Date().toISOString());

const ClockBadge: React.FC<{ b: Breach }> = ({ b }) => {
  const t = useT();
  if (b.status === 'CLOSED')
    return (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-raised text-ink-muted border-line">
        {t('ident.breach.status.CLOSED')}
      </span>
    );
  if (b.hoursLeft === null)
    return (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-success/10 text-success border-success/30">
        {t('ident.breach.status.NOTIFIED')}
      </span>
    );
  if (b.overdue)
    return (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-danger/10 text-danger border-danger/30">
        {t('ident.breach.overdueBy', { hours: t.number(Math.max(1, Math.abs(b.hoursLeft))) })}
      </span>
    );
  const cls = b.hoursLeft <= 24 ? 'bg-accent/10 text-ink border-accent/40' : 'bg-success/10 text-success border-success/30';
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cls}`}>
      {t('ident.breach.hoursLeft', { hours: t.number(b.hoursLeft) })}
    </span>
  );
};

const BreachRow: React.FC<{ b: Breach; onChanged: () => Promise<unknown> }> = ({ b, onChanged }) => {
  const t = useT();
  const when = (iso: string) => t.date(iso, WHEN);
  const statusLabel = (s: Status) => t.dyn(`ident.breach.status.${s}`, STATUS_FALLBACK[s]);
  const { busy, error, run } = useAction();
  const [open, setOpen] = useState(false);
  const [containment, setContainment] = useState(b.containment ?? '');
  const [board, setBoard] = useState(toLocalInput(b.boardNotifiedAt));
  const [people, setPeople] = useState(toLocalInput(b.peopleNotifiedAt));
  const [reason, setReason] = useState(b.noNotificationReason ?? '');
  const [notice, setNotice] = useState(false);
  const [consequences, setConsequences] = useState('');
  const [advice, setAdvice] = useState('');
  const [contact, setContact] = useState('');
  const [sentNote, setSentNote] = useState<{ sent: number; failed: number } | null>(null);
  const closed = b.status === 'CLOSED';
  const next = NEXT[b.status];

  const patch = (status?: Status) =>
    run(async () => {
      const body: Record<string, unknown> = {};
      if (containment.trim() !== (b.containment ?? '')) body.containment = containment.trim() || null;
      if (board !== toLocalInput(b.boardNotifiedAt)) body.boardNotifiedAt = fromLocalInput(board);
      if (people !== toLocalInput(b.peopleNotifiedAt)) body.peopleNotifiedAt = fromLocalInput(people);
      if (reason.trim() !== (b.noNotificationReason ?? '')) body.noNotificationReason = reason.trim() || null;
      if (status) body.status = status;
      if (Object.keys(body).length === 0) return;
      await api.patch(`/api/v1/privacy/breaches/${b.id}`, body);
      setOpen(false);
      await onChanged();
    });

  const sendNotice = () =>
    run(async () => {
      setSentNote(null);
      const body = { audience: 'ALL_ACTIVE', consequences: consequences.trim(), safetyAdvice: advice.trim(), contactEmail: contact.trim() };
      const dry = await api.post<{ data: { recipients: number } }>(`/api/v1/privacy/breaches/${b.id}/notify-people`, {
        ...body,
        dryRun: true,
      });
      if (!window.confirm(t.plural('ident.breach.confirmSend', dry.data.recipients))) return;
      const res = await api.post<{ data: { sent: number; failed: number } }>(`/api/v1/privacy/breaches/${b.id}/notify-people`, {
        ...body,
        resend: !!b.peopleNotifiedAt,
      });
      setSentNote({ sent: res.data.sent, failed: res.data.failed });
      await onChanged();
    });

  // What the next step needs, said before the administrator tries it.
  const needs =
    next === 'CONTAINED'
      ? containment.trim()
        ? null
        : t('ident.breach.needs.contain')
      : next === 'NOTIFIED'
        ? board
          ? null
          : t('ident.breach.needs.board')
        : next === 'CLOSED'
          ? board || reason.trim()
            ? null
            : t('ident.breach.needs.close')
          : null;
  const canClose = !closed && (board !== '' || reason.trim() !== '');

  return (
    <li className="p-3 bg-canvas space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-ink">{b.title}</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${SEVERITY_STYLE[b.severity]}`}>
              {t.dyn(`ident.breach.severity.${b.severity}`, b.severity.toLowerCase())}
            </span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-line bg-surface text-ink">
              {statusLabel(b.status)}
            </span>
          </div>
          <div className="text-[11px] text-ink-subtle">
            {[
              t('ident.breach.detectedLine', { detected: when(b.detectedAt), due: when(b.dueAt) }),
              b.affectedEstimate != null ? t('ident.breach.about', { count: t.number(b.affectedEstimate) }) : null,
              b.boardNotifiedAt ? t('ident.breach.boardTold', { date: when(b.boardNotifiedAt) }) : null,
              b.closedAt ? t('ident.breach.closedOn', { date: when(b.closedAt) }) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
        <ClockBadge b={b} />
      </div>
      <p className="text-xs text-ink-muted whitespace-pre-line">{b.description}</p>
      {b.categories.length > 0 && (
        <p className="text-[11px] text-ink-subtle">{t('ident.breach.dataInvolved', { list: b.categories.join(', ') })}</p>
      )}
      {b.containment && !open && (
        <p className="text-[11px] text-ink-subtle whitespace-pre-line">{t('ident.breach.containmentLine', { text: b.containment })}</p>
      )}
      {b.noNotificationReason && !open && (
        <p className="text-[11px] text-ink-subtle whitespace-pre-line">
          {t('ident.breach.noNotifyBecause', { text: b.noNotificationReason })}
        </p>
      )}

      {!closed && (
        <button className={ghostBtn} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? t('ident.breach.hide') : t('ident.breach.update')}
        </button>
      )}

      {open && !closed && (
        <div className="p-3 rounded-xl border border-line bg-surface space-y-3">
          <label className="block space-y-1 text-[11px] text-ink-muted">
            {t('ident.breach.containment')}
            <textarea className={input} rows={2} maxLength={5000} value={containment} onChange={(e) => setContainment(e.target.value)} />
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="space-y-1 text-[11px] text-ink-muted">
              {t('ident.breach.boardToldOn')}
              <div className="flex gap-2">
                <input className={input} type="datetime-local" max={nowLocal()} value={board} onChange={(e) => setBoard(e.target.value)} />
                <button type="button" className={ghostBtn} onClick={() => setBoard(nowLocal())}>
                  {t('ident.breach.now')}
                </button>
              </div>
            </label>
            <label className="space-y-1 text-[11px] text-ink-muted">
              {t('ident.breach.peopleToldOn')}
              <div className="flex gap-2">
                <input
                  className={input}
                  type="datetime-local"
                  max={nowLocal()}
                  value={people}
                  onChange={(e) => setPeople(e.target.value)}
                />
                <button type="button" className={ghostBtn} onClick={() => setPeople(nowLocal())}>
                  {t('ident.breach.now')}
                </button>
              </div>
            </label>
          </div>
          <div className="space-y-2">
            <button type="button" className={ghostBtn} aria-expanded={notice} onClick={() => setNotice(!notice)}>
              {notice ? t('ident.breach.noticeHide') : b.peopleNotifiedAt ? t('ident.breach.noticeAgain') : t('ident.breach.noticeSend')}
            </button>
            {notice && (
              <div className="p-3 rounded-xl border border-line bg-canvas space-y-2">
                <p className="text-[11px] text-ink-subtle">{t('ident.breach.noticeIntro')}</p>
                <label className="block space-y-1 text-[11px] text-ink-muted">
                  {t('ident.breach.consequences')}
                  <textarea
                    className={input}
                    rows={2}
                    maxLength={3000}
                    value={consequences}
                    onChange={(e) => setConsequences(e.target.value)}
                  />
                </label>
                <label className="block space-y-1 text-[11px] text-ink-muted">
                  {t('ident.breach.advice')}
                  <textarea className={input} rows={2} maxLength={3000} value={advice} onChange={(e) => setAdvice(e.target.value)} />
                </label>
                <label className="block space-y-1 text-[11px] text-ink-muted">
                  {t('ident.breach.contact')}
                  <input className={input} type="email" value={contact} onChange={(e) => setContact(e.target.value)} />
                </label>
                <button
                  type="button"
                  className={primaryBtn}
                  disabled={busy || !consequences.trim() || !advice.trim() || !contact.trim()}
                  onClick={sendNotice}
                >
                  {busy ? t('ident.working') : t('ident.breach.reviewSend')}
                </button>
                {sentNote && (
                  <Banner kind="ok">
                    {sentNote.failed
                      ? t.plural('ident.breach.sentSome', sentNote.failed, { sent: t.number(sentNote.sent) })
                      : t.plural('ident.breach.sent', sentNote.sent)}
                  </Banner>
                )}
              </div>
            )}
          </div>
          <label className="block space-y-1 text-[11px] text-ink-muted">
            {t('ident.breach.reason')}
            <textarea className={input} rows={2} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          {needs && (
            <p className="text-[11px] text-accent" role="status">
              {needs}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button className={ghostBtn} disabled={busy} onClick={() => patch()}>
              {t('ident.breach.saveDetails')}
            </button>
            {next && next !== 'CLOSED' && (
              <button className={primaryBtn} disabled={busy || !!needs} onClick={() => patch(next)}>
                {busy ? t('ident.working') : t('ident.breach.moveTo', { status: statusLabel(next).toLowerCase() })}
              </button>
            )}
            <button className={next === 'CLOSED' ? primaryBtn : ghostBtn} disabled={busy || !canClose} onClick={() => patch('CLOSED')}>
              {busy ? t('ident.working') : t('ident.breach.close')}
            </button>
          </div>
          <p className="text-[11px] text-ink-subtle">{t('ident.breach.closeNote')}</p>
        </div>
      )}
      {error && <Banner kind="error">{error}</Banner>}
    </li>
  );
};

const NewBreach: React.FC<{ onDone: () => Promise<unknown>; onCancel: () => void }> = ({ onDone, onCancel }) => {
  const t = useT();
  const { busy, error, run } = useAction();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categories, setCategories] = useState('');
  const [affected, setAffected] = useState('');
  const [severity, setSeverity] = useState<Severity>('MEDIUM');
  const [detected, setDetected] = useState(nowLocal());
  const [containment, setContainment] = useState('');
  const ready = title.trim() !== '' && description.trim() !== '' && detected !== '';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api.post('/api/v1/privacy/breaches', {
        title: title.trim(),
        description: description.trim(),
        categories: categories
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean),
        affectedEstimate: affected.trim() === '' ? null : Number(affected),
        severity,
        detectedAt: fromLocalInput(detected) ?? undefined,
        containment: containment.trim() || undefined,
      });
      await onDone();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-brand/40 bg-surface p-4">
      <h4 className="text-sm font-bold text-ink">{t('ident.breach.new.title')}</h4>
      <p className="text-[11px] text-ink-muted">{t('ident.breach.new.intro')}</p>
      {error && <Banner kind="error">{error}</Banner>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="space-y-1 text-[11px] text-ink-muted md:col-span-2">
          {t('ident.breach.new.name')}
          <input className={input} maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="space-y-1 text-[11px] text-ink-muted md:col-span-2">
          {t('ident.breach.new.what')}
          <textarea className={input} rows={3} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="space-y-1 text-[11px] text-ink-muted">
          {t('ident.breach.new.detected')}
          <input className={input} type="datetime-local" max={nowLocal()} value={detected} onChange={(e) => setDetected(e.target.value)} />
        </label>
        <label className="space-y-1 text-[11px] text-ink-muted">
          {t('ident.breach.new.severity')}
          <select className={input} value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {t.dyn(`ident.breach.severity.${s}`, s.toLowerCase())}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-[11px] text-ink-muted">
          {t('ident.breach.new.categories')}
          <input
            className={input}
            value={categories}
            onChange={(e) => setCategories(e.target.value)}
            placeholder={t('ident.breach.new.categoriesPlaceholder')}
          />
        </label>
        <label className="space-y-1 text-[11px] text-ink-muted">
          {t('ident.breach.new.affected')}
          <input className={input} inputMode="numeric" value={affected} onChange={(e) => setAffected(e.target.value.replace(/\D/g, ''))} />
        </label>
        <label className="space-y-1 text-[11px] text-ink-muted md:col-span-2">
          {t('ident.breach.new.containment')}
          <textarea className={input} rows={2} maxLength={5000} value={containment} onChange={(e) => setContainment(e.target.value)} />
        </label>
      </div>
      <div className="flex gap-2">
        <button className={primaryBtn} disabled={busy || !ready}>
          {busy ? t('ident.breach.new.saving') : t('ident.breach.log')}
        </button>
        <button type="button" className={ghostBtn} onClick={onCancel}>
          {t('ident.breach.new.cancel')}
        </button>
      </div>
    </form>
  );
};

/**
 * The personal-data breach register (DPDP Act s.8(6)) with its 72-hour clock. Backed by /api/v1/privacy/breaches;
 * administrators are e-mailed as the deadline nears. A breach moves detected, contained, Board notified, closed,
 * and closing needs the Board's notice or a reason none was needed.
 */
export const BreachRegisterPanel: React.FC = () => {
  const t = useT();
  const [filter, setFilter] = useState('open');
  const [adding, setAdding] = useState(false);
  const list = useApiData<Register>('/api/v1/privacy/breaches', { status: filter === 'all' ? undefined : filter });
  const p = list.data;

  return (
    <section className="space-y-5" aria-labelledby="breach-h">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="breach-h" className="font-bold text-base text-ink">
            {t('ident.breach.title')}
          </h3>
          <p className="text-xs text-ink-muted">{t('ident.breach.intro')}</p>
        </div>
        <button className={ghostBtn} onClick={() => setAdding(true)} disabled={adding}>
          <Plus className="h-3.5 w-3.5" /> {t('ident.breach.log')}
        </button>
      </div>

      {p && (
        <div className="flex flex-wrap gap-2 text-[11px]" aria-label={t('ident.breach.summary')}>
          <span className="px-2.5 py-1 rounded-full border border-line bg-raised font-semibold text-ink">
            {t('ident.breach.openCount', { count: t.number(p.summary.open) })}
          </span>
          <span
            className={`px-2.5 py-1 rounded-full border font-semibold ${p.summary.overdue > 0 ? 'bg-danger/10 border-danger/30 text-danger' : 'bg-success/10 border-success/30 text-success'}`}
          >
            {t('ident.breach.overdueCount', { count: t.number(p.summary.overdue) })}
          </span>
        </div>
      )}

      {adding && (
        <NewBreach
          onCancel={() => setAdding(false)}
          onDone={async () => {
            setAdding(false);
            await list.reload();
          }}
        />
      )}

      <label className="block space-y-1 text-[11px] text-ink-muted w-40">
        {t('ident.breach.show')}
        <select className={input} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="open">{t('ident.breach.filter.open')}</option>
          <option value="all">{t('ident.breach.filter.all')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t.dyn(`ident.breach.status.${s}`, STATUS_FALLBACK[s])}
            </option>
          ))}
        </select>
      </label>

      {list.error && <Banner kind="error">{list.error}</Banner>}
      {list.isLoading && !p && <p className="text-xs text-ink-subtle">{t('ident.breach.loading')}</p>}
      {p && p.data.length === 0 && <p className="text-xs text-ink-subtle">{t('ident.breach.none')}</p>}
      {p && p.data.length > 0 && (
        <ul className="divide-y divide-line border border-line rounded-2xl overflow-hidden" aria-label={t('ident.breach.listLabel')}>
          {p.data.map((b) => (
            <BreachRow
              key={`${b.id}-${b.status}-${b.boardNotifiedAt}-${b.peopleNotifiedAt}-${b.containment}`}
              b={b}
              onChanged={list.reload}
            />
          ))}
        </ul>
      )}
    </section>
  );
};
