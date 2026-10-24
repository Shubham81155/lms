'use client';

import React, { useState } from 'react';
import { AlertTriangle, Download, PackageOpen, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useApiData } from '@/hooks/useApiData';
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
  'inline-flex items-center gap-1 px-3 py-1.5 bg-danger hover:opacity-90 text-white rounded-lg text-[11px] font-bold disabled:opacity-50';
const input =
  'w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand';

export const longDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'long' });
export const fileSize = (n: number | null) =>
  n === null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;

const STATUS_TEXT: Record<ExportJob['status'], string> = {
  QUEUED: 'Waiting to start',
  RUNNING: 'Being prepared',
  READY: 'Ready',
  FAILED: 'Failed',
  EXPIRED: 'Expired',
};

/** One export: its state and, when ready, the download link (a plain link: the API streams it or redirects). */
export const ExportRow: React.FC<{ job: ExportJob; downloadPath: string }> = ({ job, downloadPath }) => (
  <li className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-canvas px-3 py-2 text-xs">
    <div className="min-w-0">
      <div className="font-semibold text-ink">
        {new Date(job.createdAt).toLocaleString()}
        {job.isFinal && (
          <span className="ml-2 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] text-accent">final</span>
        )}
      </div>
      <div className="text-[11px] text-ink-subtle">
        {STATUS_TEXT[job.status]}
        {job.status === 'READY' && job.sizeBytes !== null ? ` · ${fileSize(job.sizeBytes)}` : ''}
        {job.status === 'READY' && job.expiresAt ? ` · available until ${longDate(job.expiresAt)}` : ''}
        {job.error ? ` · ${job.error}` : ''}
      </div>
    </div>
    {job.status === 'READY' && (
      <a className={ghost} href={downloadPath} download>
        <Download className="h-3 w-3" /> Download ZIP
      </a>
    )}
  </li>
);

/**
 * Exports and deletion of one organisation. `basePath` is /api/v1/admin/offboarding for administrators, or
 * /api/v1/operator/tenants/<id> for the platform operator (`operator`).
 */
export const OffboardingPanel: React.FC<{ operator?: boolean; tenantId?: string; onChanged?: () => void }> = ({
  operator,
  tenantId,
  onChanged,
}) => {
  const statePath = operator ? `/api/v1/operator/tenants/${tenantId}/offboarding` : '/api/v1/admin/offboarding';
  const exportPath = operator ? `/api/v1/operator/tenants/${tenantId}/export` : '/api/v1/admin/offboarding/export';
  const deletionPath = operator ? `/api/v1/operator/tenants/${tenantId}/deletion` : '/api/v1/admin/offboarding/deletion';
  const downloadPath = (id: string) =>
    operator ? `/api/v1/operator/exports/${id}/download` : `/api/v1/admin/offboarding/export/${id}/download`;

  const state = useApiData<{ data: OffboardingState }>(statePath);
  const { busy, error, run, clearError } = useAction();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const s = state.data?.data;
  const preparing = s?.exports.some((e) => e.status === 'QUEUED' || e.status === 'RUNNING');

  const changed = async (text: string) => {
    setDone(text);
    await state.reload();
    onChanged?.();
  };
  const requestExport = () =>
    run(async () => {
      setDone(null);
      await api.post(exportPath);
      await changed('The export is being prepared. It usually takes a few minutes; reload this section to see when it is ready.');
    });
  const schedule = () =>
    run(async () => {
      setDone(null);
      await api.post(deletionPath, { confirmSlug: typed });
      setConfirming(false);
      setTyped('');
      await changed(
        operator
          ? "The deletion is scheduled; the organisation's administrators have been e-mailed."
          : 'The deletion is scheduled. Your administrators have been e-mailed.'
      );
    });
  const cancel = () =>
    run(async () => {
      setDone(null);
      await api.delete(deletionPath);
      await changed('The deletion is cancelled. Nothing will be deleted.');
    });

  return (
    <section className="space-y-4" aria-labelledby={`offboarding-h-${tenantId ?? 'own'}`}>
      <div>
        <h3 id={`offboarding-h-${tenantId ?? 'own'}`} className="font-bold text-base text-ink">
          Export and deletion
        </h3>
        <p className="text-xs text-ink-muted">
          A full export is a ZIP of all the organisation&apos;s data (one file per table) and uploaded files. Passwords, sign-in tokens and
          keys are never included.
        </p>
      </div>
      {done && <Banner kind="ok">{done}</Banner>}
      {(error || state.error) && <Banner kind="error">{error || state.error}</Banner>}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-bold text-ink">Full exports</h4>
          <button
            type="button"
            className={ghost}
            disabled={busy || !s || preparing}
            onClick={() => {
              clearError();
              requestExport();
            }}
          >
            <PackageOpen className="h-3 w-3" /> {preparing ? 'Export in progress…' : 'Request a full export'}
          </button>
        </div>
        {s && s.exports.length === 0 && (
          <p className="text-[11px] text-ink-subtle">No exports yet. Each export can be downloaded for 7 days.</p>
        )}
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
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Delete the organisation
          </h4>
          {!s.deletable ? (
            <p className="text-[11px] text-ink-muted">This is the platform operator&apos;s organisation; it cannot be deleted.</p>
          ) : s.deletion ? (
            <div className="space-y-2 text-[11px] text-ink">
              <p>
                <strong>{s.name}</strong> and all its data will be deleted on <strong>{longDate(s.deletion.scheduledAt)}</strong>
                {s.deletion.requestedBy ? ` (scheduled by ${s.deletion.requestedBy})` : ''}. Until then everything works as usual.
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
                  Cancel the deletion
                </button>
              ) : (
                <p className="text-ink-muted">
                  The platform operator scheduled this deletion; contact your platform provider to cancel it.
                </p>
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
              <p className="text-[11px] text-ink">
                Everything — people, courses, grades, submissions, files and the audit trail — is deleted {s.graceDays} days from now and
                cannot be recovered. A final copy is kept by the platform operator for 90 days. Take a full export first if you need the
                data.
              </p>
              <label className="block text-[11px] text-ink">
                Type <span className="font-mono font-semibold">{s.slug}</span> to confirm
                <input
                  className={`${input} mt-1`}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Organisation address"
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
                  Keep the organisation
                </button>
                <button type="submit" className={danger} disabled={busy || typed.trim().toLowerCase() !== s.slug}>
                  <Trash2 className="h-3 w-3" /> Schedule deletion
                </button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-ink-muted">
                The organisation is deleted {s.graceDays} days after you schedule it, and can be used and the deletion cancelled until then.
              </p>
              <button
                type="button"
                className={danger}
                onClick={() => {
                  clearError();
                  setDone(null);
                  setConfirming(true);
                }}
              >
                <Trash2 className="h-3 w-3" /> Schedule deletion…
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
  const state = useApiData<{ data: OffboardingState }>('/api/v1/admin/offboarding');
  const d = state.data?.data.deletion;
  if (!d) return null;
  return (
    <div role="alert" className="flex flex-wrap items-start gap-3 rounded-2xl border border-danger/40 bg-danger/5 p-4 text-sm text-ink">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
      <p className="flex-1 min-w-0">
        <span className="font-semibold">This organisation will be deleted on {longDate(d.scheduledAt)}</span>, with all its data.
        {d.canCancel
          ? ' You can cancel the deletion until then.'
          : ' The platform operator scheduled it; contact your platform provider to cancel it.'}
      </p>
      {onManage && (
        <button type="button" className={ghost} onClick={onManage}>
          {d.canCancel ? 'Cancel or export' : 'Export data'}
        </button>
      )}
    </div>
  );
};
