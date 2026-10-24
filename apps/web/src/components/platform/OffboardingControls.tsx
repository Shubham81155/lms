'use client';

import React from 'react';
import { useApiData } from '@/hooks/useApiData';
import { Banner } from '@/components/admin/IdentityPanels';
import { ExportRow, longDate, type ExportJob } from '@/components/admin/OffboardingPanel';

// The platform operator's view of offboarding: which organisations are scheduled for deletion (shown on their row
// in the organisations table) and the organisations already deleted, with their final export.

export interface OffboardingOverview {
  scheduled: { tenantId: string; slug: string; name: string; scheduledAt: string; requestedBy: string | null; byOperator: boolean }[];
  deleted: {
    id: string;
    tenantId: string;
    slug: string;
    name: string;
    deletedAt: string;
    requestedBy: string | null;
    slugHeldUntil: string;
    summary: { rows?: Record<string, number>; files?: number; filesNotRemoved?: number } | null;
    finalExport: ExportJob | null;
  }[];
}

export function useOffboardingOverview(refreshKey?: number) {
  const overview = useApiData<{ data: OffboardingOverview }>('/api/v1/operator/offboarding');
  const { reload } = overview;
  React.useEffect(() => {
    if (refreshKey) reload();
  }, [refreshKey, reload]);
  return overview;
}

/** "Deletion on 3 December 2026" under an organisation's status. */
export const DeletionBadge: React.FC<{ scheduledAt: string; byOperator: boolean }> = ({ scheduledAt, byOperator }) => (
  <div
    className="mt-1 text-[10px] font-semibold text-danger"
    title={byOperator ? 'Scheduled by the platform operator' : "Scheduled by the organisation's administrator"}
  >
    Deletion on {longDate(scheduledAt)}
  </div>
);

/** Organisations already deleted: when, their final export, and until when their address stays reserved. */
export const DeletedOrganisations: React.FC<{ overview: ReturnType<typeof useOffboardingOverview> }> = ({ overview }) => {
  const deleted = overview.data?.data.deleted ?? [];
  if (overview.error) return <Banner kind="error">{overview.error}</Banner>;
  if (deleted.length === 0) return null;
  return (
    <section className="space-y-2" aria-labelledby="deleted-orgs-h">
      <h3 id="deleted-orgs-h" className="text-xs font-bold text-ink">
        Deleted organisations
      </h3>
      <p className="text-[11px] text-ink-muted">
        The final export taken before each deletion is kept for 90 days. A deleted organisation&apos;s address cannot be taken until the
        date shown.
      </p>
      <ul className="space-y-2">
        {deleted.map((d) => {
          const rows = d.summary?.rows ? Object.values(d.summary.rows).reduce((a, b) => a + b, 0) : null;
          return (
            <li key={d.id} className="rounded-2xl border border-line bg-canvas p-3 text-xs">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <span className="font-semibold text-ink">{d.name}</span>{' '}
                  <span className="font-mono text-[11px] text-ink-subtle">{d.slug}</span>
                </div>
                <div className="text-[11px] text-ink-subtle">
                  Deleted {longDate(d.deletedAt)}
                  {d.requestedBy ? ` · asked by ${d.requestedBy}` : ''} · address reserved until {longDate(d.slugHeldUntil)}
                </div>
              </div>
              <div className="mt-1 text-[11px] text-ink-subtle">
                {rows !== null ? `${rows.toLocaleString()} records` : ''}
                {d.summary?.files !== undefined ? `, ${d.summary.files} files` : ''}
                {d.summary?.filesNotRemoved ? ` (${d.summary.filesNotRemoved} could not be removed from storage)` : ''}
              </div>
              <ul className="mt-2">
                {d.finalExport ? (
                  <ExportRow job={d.finalExport} downloadPath={`/api/v1/operator/exports/${d.finalExport.id}/download`} />
                ) : (
                  <li className="text-[11px] text-ink-subtle">No final export.</li>
                )}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
