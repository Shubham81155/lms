'use client';

import React, { useState } from 'react';
import { Download, ChevronDown, ChevronRight } from 'lucide-react';
import { downloadFile, errorMessage, useApiData } from '@/hooks/useApiData';
import { useT } from '@/lib/i18n';

interface AuditEntry {
  id: string;
  createdAt: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  ipAddress: string | null;
  diffJson: unknown;
  user: { email: string; firstName: string; lastName: string; role: string } | null;
}

interface Filters {
  action: string;
  actor: string;
  startDate: string;
  endDate: string;
}

const field = 'bg-canvas border border-line rounded-lg px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:border-brand';
const EMPTY: Filters = { action: '', actor: '', startDate: '', endDate: '' };
const PAGE = 50;

/** The dates are whole days in the viewer's time zone; the API takes instants. */
const params = (f: Filters) => ({
  action: f.action || undefined,
  actor: f.actor.trim() || undefined,
  startDate: f.startDate ? new Date(`${f.startDate}T00:00:00`).toISOString() : undefined,
  endDate: f.endDate ? new Date(`${f.endDate}T23:59:59.999`).toISOString() : undefined,
});

/** Searchable, paged view of the append-only audit trail, with CSV export of the filtered rows. */
export const AuditLogPanel: React.FC = () => {
  const t = useT();
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const actions = useApiData<{ data: { action: string; count: number }[] }>('/api/v1/admin/audit-logs/actions');
  const logs = useApiData<{ data: AuditEntry[]; pagination: { total: number; totalPages: number } }>('/api/v1/admin/audit-logs', {
    ...params(filters),
    page,
    limit: PAGE,
  });
  const total = logs.data?.pagination.total ?? 0;
  const pages = logs.data?.pagination.totalPages ?? 1;

  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    setFilters(draft);
    setPage(1);
  };

  const exportCsv = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const qs = new URLSearchParams(Object.entries(params(filters)).filter(([, v]) => v) as [string, string][]).toString();
      await downloadFile(
        `/api/v1/admin/audit-logs/export.csv${qs ? `?${qs}` : ''}`,
        `audit-log-${new Date().toISOString().slice(0, 10)}.csv`
      );
    } catch (e) {
      setExportError(errorMessage(e, t('ident.audit.exportFailed')));
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="space-y-4" aria-labelledby="audit-h">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="audit-h" className="font-bold text-base text-ink">
            {t('ident.audit.title')}
          </h3>
          <p className="text-xs text-ink-muted">{t('ident.audit.intro')}</p>
        </div>
        <button
          onClick={exportCsv}
          disabled={exporting}
          className="px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold disabled:opacity-50 flex items-center gap-1.5"
        >
          <Download className="h-3.5 w-3.5" />
          {exporting ? t('ident.audit.exporting') : t('ident.audit.export')}
        </button>
      </div>

      <form role="search" onSubmit={apply} className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-[11px] text-ink-muted">
          <span className="block">{t('ident.audit.action')}</span>
          <select className={field} value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })}>
            <option value="">{t('ident.audit.allActions')}</option>
            {(actions.data?.data ?? []).map((a) => (
              <option key={a.action} value={a.action}>
                {a.action} ({a.count})
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-[11px] text-ink-muted">
          <span className="block">{t('ident.audit.person')}</span>
          <input
            className={field}
            value={draft.actor}
            onChange={(e) => setDraft({ ...draft, actor: e.target.value })}
            placeholder="name@university.edu"
            maxLength={254}
          />
        </label>
        <label className="space-y-1 text-[11px] text-ink-muted">
          <span className="block">{t('ident.audit.from')}</span>
          <input
            type="date"
            className={field}
            value={draft.startDate}
            onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
          />
        </label>
        <label className="space-y-1 text-[11px] text-ink-muted">
          <span className="block">{t('ident.audit.to')}</span>
          <input type="date" className={field} value={draft.endDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} />
        </label>
        <button className="px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-hover text-on-brand text-xs font-bold">
          {t('ident.audit.apply')}
        </button>
        {(filters.action || filters.actor || filters.startDate || filters.endDate) && (
          <button
            type="button"
            onClick={() => {
              setDraft(EMPTY);
              setFilters(EMPTY);
              setPage(1);
            }}
            className="px-3 py-1.5 rounded-lg border border-line text-xs font-semibold text-ink"
          >
            {t('ident.audit.clear')}
          </button>
        )}
      </form>

      {(logs.error || exportError) && (
        <p role="alert" className="text-xs text-danger">
          {logs.error || exportError}
        </p>
      )}

      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="w-full text-xs">
          <thead className="bg-canvas text-left text-ink-subtle">
            <tr>
              <th className="px-3 py-2 font-semibold w-6" aria-label={t('ident.audit.details')} />
              <th className="px-3 py-2 font-semibold">{t('ident.audit.when')}</th>
              <th className="px-3 py-2 font-semibold">{t('ident.audit.action')}</th>
              <th className="px-3 py-2 font-semibold">{t('ident.audit.resource')}</th>
              <th className="px-3 py-2 font-semibold">{t('ident.audit.personCol')}</th>
              <th className="px-3 py-2 font-semibold">{t('ident.audit.ip')}</th>
            </tr>
          </thead>
          <tbody>
            {logs.isLoading && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-ink-subtle">
                  {t('ident.audit.loading')}
                </td>
              </tr>
            )}
            {!logs.isLoading && logs.data?.data.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-ink-subtle">
                  {t('ident.audit.empty')}
                </td>
              </tr>
            )}
            {(logs.data?.data ?? []).map((l) => {
              const open = expanded === l.id;
              return (
                <React.Fragment key={l.id}>
                  <tr className="border-t border-line align-top">
                    <td className="px-3 py-2">
                      {l.diffJson ? (
                        <button
                          onClick={() => setExpanded(open ? null : l.id)}
                          aria-expanded={open}
                          aria-label={t('ident.audit.showDetails')}
                          className="text-ink-muted hover:text-ink"
                        >
                          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-ink">
                      {t.date(l.createdAt, { dateStyle: 'medium', timeStyle: 'medium', timeZone: undefined })}
                    </td>
                    <td className="px-3 py-2 font-mono text-ink">{l.action}</td>
                    <td className="px-3 py-2 text-ink-muted">
                      {l.resourceType.toLowerCase()}
                      {l.resourceId ? <span className="block font-mono text-[10px] text-ink-subtle">{l.resourceId}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-ink">
                      {l.user ? (
                        <>
                          {l.user.email}
                          <span className="block text-[10px] text-ink-subtle">
                            {t.dyn(`role.${l.user.role}`, l.user.role.replace(/_/g, ' ').toLowerCase())}
                          </span>
                        </>
                      ) : (
                        <span className="text-ink-subtle">{t('ident.audit.system')}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-ink-muted">{l.ipAddress ?? ''}</td>
                  </tr>
                  {open && (
                    <tr className="bg-canvas">
                      <td />
                      <td colSpan={5} className="px-3 py-2">
                        <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-ink">
                          {JSON.stringify(l.diffJson, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-ink-muted">
        <span>{t.plural('ident.audit.entries', total)}</span>
        <div className="flex items-center gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="px-2.5 py-1 rounded-lg border border-line disabled:opacity-40"
          >
            {t('ident.audit.previous')}
          </button>
          <span>{t('ident.audit.pageOf', { page: t.number(page), pages: t.number(Math.max(1, pages)) })}</span>
          <button
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
            className="px-2.5 py-1 rounded-lg border border-line disabled:opacity-40"
          >
            {t('ident.audit.next')}
          </button>
        </div>
      </div>
    </section>
  );
};
