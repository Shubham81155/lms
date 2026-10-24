'use client';

import React from 'react';
import { useApiData } from '@/hooks/useApiData';
import { Banner } from '@/components/admin/IdentityPanels';
import { ExportRow, type ExportJob } from '@/components/admin/OffboardingPanel';
import { useT } from '@/lib/i18n';

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

const longDate = (t: ReturnType<typeof useT>, iso: string) => t.date(iso, { dateStyle: 'long', timeZone: undefined });

/** "Deletion on 3 December 2026" under an organisation's status. */
export const DeletionBadge: React.FC<{ scheduledAt: string; byOperator: boolean }> = ({ scheduledAt, byOperator }) => {
  const t = useT();
  return (
    <div
      className="mt-1 text-[10px] font-semibold text-danger"
      title={byOperator ? t('operator.deletion.byOperator') : t('operator.deletion.byAdmin')}
    >
      {t('operator.deletion.badge', { date: longDate(t, scheduledAt) })}
    </div>
  );
};

/** Organisations already deleted: when, their final export, and until when their address stays reserved. */
export const DeletedOrganisations: React.FC<{ overview: ReturnType<typeof useOffboardingOverview> }> = ({ overview }) => {
  const t = useT();
  const deleted = overview.data?.data.deleted ?? [];
  if (overview.error) return <Banner kind="error">{overview.error}</Banner>;
  if (deleted.length === 0) return null;
  return (
    <section className="space-y-2" aria-labelledby="deleted-orgs-h">
      <h3 id="deleted-orgs-h" className="text-xs font-bold text-ink">
        {t('operator.deleted.title')}
      </h3>
      <p className="text-[11px] text-ink-muted">{t('operator.deleted.intro')}</p>
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
                  {[
                    t('operator.deleted.on', { date: longDate(t, d.deletedAt) }),
                    d.requestedBy ? t('operator.deleted.askedBy', { who: d.requestedBy }) : '',
                    t('operator.deleted.reserved', { date: longDate(t, d.slugHeldUntil) }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              <div className="mt-1 text-[11px] text-ink-subtle">
                {[
                  rows !== null ? t.plural('operator.deleted.records', rows) : '',
                  d.summary?.files !== undefined ? t.plural('operator.deleted.files', d.summary.files) : '',
                ]
                  .filter(Boolean)
                  .join(', ')}
                {d.summary?.filesNotRemoved ? ` ${t('operator.deleted.notRemoved', { count: t.number(d.summary.filesNotRemoved) })}` : ''}
              </div>
              <ul className="mt-2">
                {d.finalExport ? (
                  <ExportRow job={d.finalExport} downloadPath={`/api/v1/operator/exports/${d.finalExport.id}/download`} />
                ) : (
                  <li className="text-[11px] text-ink-subtle">{t('operator.deleted.noExport')}</li>
                )}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
