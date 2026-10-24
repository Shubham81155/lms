'use client';

import React, { useState } from 'react';
import { LifeBuoy, LogIn } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { useT } from '@/lib/i18n';

// The platform operator's side of support access: the passes organisations have granted and that are still in
// force. "Enter" asks the API for a one-time link and follows it to the organisation's own address, where it
// becomes a support session (read-only or full, as the organisation chose). Organisations can revoke at any time.

const ghost =
  'inline-flex items-center gap-1 px-2.5 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50';

export interface OperatorSupportPass {
  id: string;
  organization: { id: string; slug: string; name: string; status: string };
  scope: 'READ_ONLY' | 'FULL';
  reason: string;
  grantedByEmail: string;
  createdAt: string;
  expiresAt: string;
  lastEnteredAt: string | null;
  lastEnteredByEmail: string | null;
}

export const SupportPassesPanel: React.FC = () => {
  const t = useT();
  const when = (iso: string) => t.date(iso, { dateStyle: 'medium', timeStyle: 'short', timeZone: undefined });
  const { data, isLoading, error, reload } = useApiData<{ data: OperatorSupportPass[] }>('/api/v1/operator/support-passes');
  const { busy, error: actionError, run } = useAction();
  const [entering, setEntering] = useState<string | null>(null);
  const passes = data?.data ?? [];

  const enter = (id: string) => {
    setEntering(id);
    run(async () => {
      const res = await api.post<{ data: { url: string } }>(`/api/v1/operator/support-passes/${id}/enter`);
      window.location.assign(res.data.url);
    }).finally(() => setEntering(null));
  };

  return (
    <section className="space-y-3 rounded-3xl border border-line bg-surface p-6 shadow-xl" aria-labelledby="support-passes-h">
      <div className="flex items-center justify-between gap-3">
        <h2 id="support-passes-h" className="flex items-center gap-2 font-bold text-base text-ink">
          <LifeBuoy className="h-4 w-4 text-accent" aria-hidden="true" />
          {t('operator.support.title')}
        </h2>
        <button type="button" className="text-xs font-semibold text-brand-fg underline" onClick={reload}>
          {t('operator.support.refresh')}
        </button>
      </div>
      <p className="text-xs text-ink-muted">{t('operator.support.intro')}</p>
      {(error || actionError) && (
        <p role="alert" className="text-xs text-danger">
          {error || actionError}
        </p>
      )}
      {isLoading && !data && <p className="text-xs text-ink-subtle">{t('common.loading')}</p>}
      {data && passes.length === 0 && <p className="text-xs text-ink-muted">{t('operator.support.empty')}</p>}
      <ul className="divide-y divide-line">
        {passes.map((p) => {
          const blocked = p.organization.status === 'SUSPENDED' || p.organization.status === 'ARCHIVED';
          return (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-xs">
              <div className="min-w-0 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-ink">{p.organization.name}</span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                      p.scope === 'FULL' ? 'border-danger/40 bg-danger/10 text-danger' : 'border-line bg-canvas text-ink-muted'
                    }`}
                  >
                    {p.scope === 'FULL' ? t('operator.support.full') : t('operator.support.readOnly')}
                  </span>
                  {blocked && (
                    <span className="text-[10px] font-semibold text-danger">
                      {t.dyn(`operator.status.${p.organization.status}`, p.organization.status.toLowerCase())}
                    </span>
                  )}
                </div>
                <div className="text-ink-muted">{p.reason}</div>
                <div className="text-[11px] text-ink-subtle">
                  {t('operator.support.granted', { email: p.grantedByEmail, when: when(p.expiresAt) })}
                  {p.lastEnteredAt
                    ? ` · ${t('operator.support.lastEntered', { email: p.lastEnteredByEmail ?? '', when: when(p.lastEnteredAt) })}`
                    : ''}
                </div>
              </div>
              <button type="button" className={ghost} disabled={busy || blocked} onClick={() => enter(p.id)}>
                <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
                {entering === p.id ? t('operator.support.entering') : t('operator.support.enter')}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
