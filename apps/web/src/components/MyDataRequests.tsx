'use client';

import React, { useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useApiData, downloadFile } from '@/hooks/useApiData';
import { Banner } from '@/components/admin/IdentityPanels';
import { useT } from '@/lib/i18n';
import {
  REQUEST_KINDS,
  dayLabel,
  dueLabel,
  isOpen,
  kindLabel as kindOf,
  statusLabel,
  type MyRequest,
  type RequestKind,
} from '@/lib/dataRequests';

const card = 'bg-canvas border border-line rounded-2xl p-5 space-y-3';
const input =
  'w-full bg-surface border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand';

const STATUS_CLS: Record<string, string> = {
  OPEN: 'bg-accent/10 text-ink border-accent/40',
  IN_PROGRESS: 'bg-brand/10 text-ink border-brand/40',
  FULFILLED: 'bg-success/10 text-success border-success/30',
  REJECTED: 'bg-danger/10 text-danger border-danger/30',
  CANCELLED: 'bg-raised text-ink-muted border-line',
};

/**
 * The signed-in person's data requests (GDPR Art. 15-21, FERPA): file one, follow it to its answer, cancel it while
 * it is open, and download the data once an access request was answered with it. Backed by /api/v1/privacy/requests.
 */
export const MyDataRequests: React.FC = () => {
  const t = useT();
  const mine = useApiData<{ data: MyRequest[] }>('/api/v1/privacy/requests/mine');
  const file = useAction();
  const act = useAction();
  const [kind, setKind] = useState<RequestKind>('ACCESS');
  const [details, setDetails] = useState('');
  const [filed, setFiled] = useState(false);

  const rows = mine.data?.data ?? [];
  const day = (iso: string) => dayLabel(t, iso);
  const kindLabel = (k: RequestKind) => kindOf(t, k);
  const dueText = (daysLeft: number | null) => dueLabel(t, daysLeft);
  const openKinds = new Set(rows.filter(isOpen).map((r) => r.kind));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    file.run(async () => {
      setFiled(false);
      await api.post('/api/v1/privacy/requests', { kind, details: details.trim() || undefined });
      setDetails('');
      setFiled(true);
      await mine.reload();
    });
  };

  const cancel = (r: MyRequest) =>
    act.run(async () => {
      await api.post(`/api/v1/privacy/requests/${r.id}/cancel`);
      await mine.reload();
    });

  const download = (r: MyRequest) => act.run(() => downloadFile(`/api/v1/privacy/requests/${r.id}/export`, `personal-data-${r.id}.json`));

  return (
    <section className={card} aria-labelledby="requests-h">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-brand-fg" />
        <h4 id="requests-h" className="text-sm font-bold text-ink">
          {t('privacy.requests.title')}
        </h4>
      </div>
      <p className="text-xs text-ink-muted leading-relaxed">{t('privacy.requests.intro')}</p>

      <form onSubmit={submit} className="space-y-2" aria-label={t('privacy.requests.formLabel')}>
        <label className="block space-y-1">
          <span className="text-[11px] text-ink-muted">{t('privacy.requests.whatLabel')}</span>
          <select className={input} value={kind} onChange={(e) => setKind(e.target.value as RequestKind)}>
            {REQUEST_KINDS.map((k) => (
              <option key={k} value={k} disabled={openKinds.has(k)}>
                {kindLabel(k)}
                {openKinds.has(k) ? t('privacy.requests.alreadyOpen') : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] text-ink-muted">{t('privacy.requests.detailsLabel')}</span>
          <textarea
            className={input}
            rows={2}
            maxLength={2000}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder={t('privacy.requests.detailsPlaceholder')}
          />
        </label>
        {file.error && <Banner kind="error">{file.error}</Banner>}
        {filed && !file.error && <Banner kind="ok">{t('privacy.requests.filed')}</Banner>}
        <button
          type="submit"
          disabled={file.busy || openKinds.has(kind)}
          className="px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold transition-all"
        >
          {file.busy ? t('privacy.requests.filing') : t('privacy.requests.file')}
        </button>
      </form>

      {(mine.error || act.error) && <Banner kind="error">{mine.error || act.error}</Banner>}
      {mine.isLoading && <p className="text-xs text-ink-subtle">{t('privacy.requests.loading')}</p>}
      {mine.data && rows.length === 0 && <p className="text-xs text-ink-subtle">{t('privacy.requests.empty')}</p>}

      {rows.length > 0 && (
        <ul className="divide-y divide-line border border-line rounded-2xl overflow-hidden" aria-label={t('privacy.requests.listLabel')}>
          {rows.map((r) => (
            <li key={r.id} className="p-3 bg-surface space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-ink">{kindLabel(r.kind)}</div>
                  <div className="text-[11px] text-ink-subtle">
                    {t('privacy.requests.filedOn', { date: day(r.receivedAt) })}
                    {isOpen(r)
                      ? t('privacy.requests.due', { date: day(r.dueAt) })
                      : r.closedAt
                        ? t('privacy.requests.closed', { date: day(r.closedAt) })
                        : ''}
                  </div>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_CLS[r.status]}`}>
                  {statusLabel(t, r.status)}
                </span>
              </div>
              {isOpen(r) && r.overdue && (
                <p className="text-[11px] text-danger">{t('privacy.requests.late', { due: dueText(r.daysLeft) })}</p>
              )}
              {r.resolution && <p className="text-xs text-ink-muted whitespace-pre-line">{r.resolution}</p>}
              <div className="flex gap-2">
                {r.exportAttached && r.status === 'FULFILLED' && (
                  <button
                    onClick={() => download(r)}
                    disabled={act.busy}
                    className="px-3 py-1.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-lg text-[11px] font-bold inline-flex items-center gap-1.5"
                  >
                    <Download className="h-3.5 w-3.5" /> {t('privacy.requests.download')}
                  </button>
                )}
                {isOpen(r) && (
                  <button
                    onClick={() => cancel(r)}
                    disabled={act.busy}
                    className="px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold disabled:opacity-50"
                  >
                    {t('privacy.requests.cancel')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
