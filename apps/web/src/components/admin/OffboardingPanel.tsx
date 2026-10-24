'use client';

import React, { useState } from 'react';
import { AlertTriangle, Download, PackageOpen, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { useT } from '@/lib/i18n';
import { Banner } from './IdentityPanels';

// Leaving the platform: full exports of the organisation's data, and scheduling (or cancelling) its deletion.
// The same panel serves the platform operator for any organisation (`basePath` /api/v1/operator/tenants/<id>).

export interface ExportJob {
  id: string;
  tenantId: string;
  status: 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED' | 'EXPIRED';
  isFinal: boolean;
  sizeBytes: number | null;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  error: string | null;
}

export interface OffboardingState {
  tenantId: string;
  slug: string;
  name: string;
  deletable: boolean;
  graceDays: number;
  deletion: { scheduledAt: string; requestedAt: string | null; requestedBy: string | null; byOperator: boolean; canCancel: boolean } | null;
  exports: ExportJob[];
}

const primary =
  'inline-flex items-center gap-1 px-3 py-1.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-lg text-[11px] font-bold transition-all';
const ghost =
  'inline-flex items-center gap-1 px-2.5 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50';
const danger =
  'inline-flex items-center gap-1 px-3 py-1.5 bg-danger hover:opacity-90 text-on-danger rounded-lg text-[11px] font-bold disabled:opacity-50';
const input =
  'w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand';

export const longDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'long' });
export const fileSize = (n: number | null) =>
  n === null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;

type DoneKind = 'export' | 'scheduledOperator' | 'scheduled' | 'cancelled';

/** Fills `{name}`-style bold spots of a message with <strong> elements without interpreting any markup in the values. */
function withBold(message: string, values: Record<string, string>): React.ReactNode {
  return message.split(/(\ue000\w+\ue000)/).map((part, i) => {
    const m = /^\ue000(\w+)\ue000$/.exec(part);
    return m ? <strong key={i}>{values[m[1]]}</strong> : <React.Fragment key={i}>{part}</React.Fragment>;
  });
}
const mark = (name: string) => `\ue000${name}\ue000`;

/** One export: its state and, when ready, the download link (a plain link: the API streams it or redirects). */
export const ExportRow: React.FC<{ job: ExportJob; downloadPath: string }> = ({ job, downloadPath }) => {
  const t = useT();
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-canvas px-3 py-2 text-xs">
      <div className="min-w-0">
        <div className="font-semibold text-ink">
          {new Date(job.createdAt).toLocaleString()}
          {job.isFinal && (
            <span className="ml-2 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] text-accent">
              {t('orgadm.off.final')}
            </span>
          )}
        </div>
        <div className="text-[11px] text-ink-subtle">
          {t.dyn(`orgadm.off.status.${job.status}`, job.status)}
          {job.status === 'READY' && job.sizeBytes !== null ? ` · ${fileSize(job.sizeBytes)}` : ''}
          {job.status === 'READY' && job.expiresAt ? ` · ${t('orgadm.off.availableUntil', { date: longDate(job.expiresAt) })}` : ''}
          {job.error ? ` · ${job.error}` : ''}
        </div>
      </div>
      {job.status === 'READY' && (
        <a className={ghost} href={downloadPath} download>
          <Download className="h-3 w-3" /> {t('orgadm.off.download')}
        </a>
      )}
    </li>
  );
};

/**
 * Exports and deletion of one organisation. `basePath` is /api/v1/admin/offboarding for administrators, or
 * /api/v1/operator/tenants/<id> for the platform operator (`operator`).
 */
export const OffboardingPanel: React.FC<{ operator?: boolean; tenantId?: string; onChanged?: () => void }> = ({
  operator,
  tenantId,
  onChanged,
}) => {
  const t = useT();
  const statePath = operator ? `/api/v1/operator/tenants/${tenantId}/offboarding` : '/api/v1/admin/offboarding';
  const exportPath = operator ? `/api/v1/operator/tenants/${tenantId}/export` : '/api/v1/admin/offboarding/export';
  const deletionPath = operator ? `/api/v1/operator/tenants/${tenantId}/deletion` : '/api/v1/admin/offboarding/deletion';
  const downloadPath = (id: string) =>
    operator ? `/api/v1/operator/exports/${id}/download` : `/api/v1/admin/offboarding/export/${id}/download`;

  const state = useApiData<{ data: OffboardingState }>(statePath);
  const { busy, error, run, clearError } = useAction();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [done, setDone] = useState<DoneKind | null>(null);
  const s = state.data?.data;
  const preparing = s?.exports.some((e) => e.status === 'QUEUED' || e.status === 'RUNNING');

  const changed = async (kind: DoneKind) => {
    setDone(kind);
    await state.reload();
    onChanged?.();
  };
  const requestExport = () =>
    run(async () => {
      setDone(null);
      await api.post(exportPath);
      await changed('export');
    });
  const schedule = () =>
    run(async () => {
      setDone(null);
      await api.post(deletionPath, { confirmSlug: typed });
      setConfirming(false);
      setTyped('');
      await changed(operator ? 'scheduledOperator' : 'scheduled');
    });
  const cancel = () =>
    run(async () => {
      setDone(null);
      await api.delete(deletionPath);
      await changed('cancelled');
    });

  return (
    <section className="space-y-4" aria-labelledby={`offboarding-h-${tenantId ?? 'own'}`}>
      <div>
        <h3 id={`offboarding-h-${tenantId ?? 'own'}`} className="font-bold text-base text-ink">
          {t('orgadm.off.title')}
        </h3>
        <p className="text-xs text-ink-muted">{t('orgadm.off.intro')}</p>
      </div>
      {done && <Banner kind="ok">{t(`orgadm.off.msg.${done}` as const)}</Banner>}
      {(error || state.error) && <Banner kind="error">{error || state.error}</Banner>}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-bold text-ink">{t('orgadm.off.exports')}</h4>
          <button
            type="button"
            className={ghost}
            disabled={busy || !s || preparing}
            onClick={() => {
              clearError();
              requestExport();
            }}
          >
            <PackageOpen className="h-3 w-3" /> {preparing ? t('orgadm.off.inProgress') : t('orgadm.off.request')}
          </button>
        </div>
        {s && s.exports.length === 0 && <p className="text-[11px] text-ink-subtle">{t('orgadm.off.noExports')}</p>}
        {s && s.exports.length > 0 && (
          <ul className="space-y-1.5">
            {s.exports.map((e) => (
              <ExportRow key={e.id} job={e} downloadPath={downloadPath(e.id)} />
            ))}
          </ul>
        )}
      </div>

      {s && (
        <div className="space-y-2 rounded-2xl border border-danger/30 bg-danger/5 p-4">
          <h4 className="flex items-center gap-1.5 text-xs font-bold text-danger">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> {t('orgadm.off.deleteTitle')}
          </h4>
          {!s.deletable ? (
            <p className="text-[11px] text-ink-muted">{t('orgadm.off.notDeletable')}</p>
          ) : s.deletion ? (
            <div className="space-y-2 text-[11px] text-ink">
              <p>
                {withBold(
                  s.deletion.requestedBy
                    ? t('orgadm.off.scheduledBy', { name: mark('name'), date: mark('date'), who: s.deletion.requestedBy })
                    : t('orgadm.off.scheduled', { name: mark('name'), date: mark('date') }),
                  { name: s.name, date: longDate(s.deletion.scheduledAt) }
                )}
              </p>
              {s.deletion.canCancel ? (
                <button
                  type="button"
                  className={primary}
                  disabled={busy}
                  onClick={() => {
                    clearError();
                    cancel();
                  }}
                >
                  {t('orgadm.off.cancelDeletion')}
                </button>
              ) : (
                <p className="text-ink-muted">{t('orgadm.off.operatorScheduled')}</p>
              )}
            </div>
          ) : confirming ? (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                clearError();
                schedule();
              }}
            >
              <p className="text-[11px] text-ink">{t.plural('orgadm.off.confirmBody', s.graceDays)}</p>
              <label className="block text-[11px] text-ink">
                {t('orgadm.off.typeToConfirm', { slug: mark('slug') })
                  .split(mark('slug'))
                  .flatMap((part, i, arr) =>
                    i < arr.length - 1
                      ? [
                          part,
                          <span key={i} className="font-mono font-semibold">
                            {s.slug}
                          </span>,
                        ]
                      : [part]
                  )}
                <input
                  className={`${input} mt-1`}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={t('orgadm.off.addressAria')}
                />
              </label>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className={ghost}
                  disabled={busy}
                  onClick={() => {
                    setConfirming(false);
                    setTyped('');
                  }}
                >
                  {t('orgadm.off.keep')}
                </button>
                <button type="submit" className={danger} disabled={busy || typed.trim().toLowerCase() !== s.slug}>
                  <Trash2 className="h-3 w-3" /> {t('orgadm.off.schedule')}
                </button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-ink-muted">{t.plural('orgadm.off.idle', s.graceDays)}</p>
              <button
                type="button"
                className={danger}
                onClick={() => {
                  clearError();
                  setDone(null);
                  setConfirming(true);
                }}
              >
                <Trash2 className="h-3 w-3" /> {t('orgadm.off.scheduleAsk')}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

/** The administrators' notice that the organisation is scheduled for deletion, with the date and a link to cancel. */
export const DeletionBanner: React.FC<{ onManage?: () => void }> = ({ onManage }) => {
  const t = useT();
  const state = useApiData<{ data: OffboardingState }>('/api/v1/admin/offboarding');
  const d = state.data?.data.deletion;
  if (!d) return null;
  return (
    <div role="alert" className="flex flex-wrap items-start gap-3 rounded-2xl border border-danger/40 bg-danger/5 p-4 text-sm text-ink">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
      <p className="flex-1 min-w-0">
        <span className="font-semibold">{t('orgadm.off.bannerLead', { date: longDate(d.scheduledAt) })}</span>
        {t('orgadm.off.bannerTail')} {d.canCancel ? t('orgadm.off.bannerCancel') : t('orgadm.off.bannerOperator')}
      </p>
      {onManage && (
        <button type="button" className={ghost} onClick={onManage}>
          {d.canCancel ? t('orgadm.off.bannerManage') : t('orgadm.off.bannerExport')}
        </button>
      )}
    </div>
  );
};
