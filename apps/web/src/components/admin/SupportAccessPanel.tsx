'use client';

import React, { useState } from 'react';
import { LifeBuoy, ShieldOff } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { useT } from '@/lib/i18n';
import { Banner } from '@/components/admin/IdentityPanels';

// The organisation's consent to support: an administrator grants the platform operator a time-limited support
// pass, read-only unless they choose full access, and can revoke it at any moment (which ends a support session
// there and then). Grants, revocations, entries, exits and every change made under full access are in the audit
// trail.

const field =
  'w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand';
const primary =
  'inline-flex items-center gap-1 px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold transition-all';
const ghost =
  'inline-flex items-center gap-1 px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50';

export interface SupportPass {
  id: string;
  scope: 'READ_ONLY' | 'FULL';
  reason: string;
  grantedByEmail: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedByEmail: string | null;
  lastEnteredAt: string | null;
  lastEnteredByEmail: string | null;
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
}

const DURATIONS = [1, 4, 24, 72] as const;

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export const SupportAccessPanel: React.FC = () => {
  const t = useT();
  const scopeLabel = (s: SupportPass['scope']) => t(s === 'FULL' ? 'orgadm.support.scope.FULL' : 'orgadm.support.scope.READ_ONLY');
  const { data, isLoading, error, reload } = useApiData<{ data: SupportPass[] }>('/api/v1/support/passes');
  const { busy, error: actionError, run } = useAction();
  const [scope, setScope] = useState<SupportPass['scope']>('READ_ONLY');
  const [hours, setHours] = useState<number>(4);
  const [reason, setReason] = useState('');
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  const passes = data?.data ?? [];
  const active = passes.find((p) => p.status === 'ACTIVE') ?? null;
  const history = passes.filter((p) => p !== active).slice(0, 10);

  const grant = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api.post('/api/v1/support/passes', { scope, hours, reason: reason.trim() });
      setReason('');
      setScope('READ_ONLY');
      await reload();
    });
  };
  const revoke = (id: string) =>
    run(async () => {
      await api.post(`/api/v1/support/passes/${id}/revoke`);
      setConfirmRevoke(null);
      await reload();
    });

  return (
    <section className="space-y-4" aria-labelledby="support-access-h">
      <div className="space-y-1">
        <h2 id="support-access-h" className="flex items-center gap-2 font-bold text-base text-ink">
          <LifeBuoy className="h-4 w-4 text-accent" aria-hidden="true" />
          {t('orgadm.support.title')}
        </h2>
        <p className="text-xs text-ink-muted">{t('orgadm.support.intro')}</p>
      </div>

      {(error || actionError) && <Banner kind="error">{error || actionError}</Banner>}
      {isLoading && !data && <p className="text-xs text-ink-subtle">{t('common.loading')}</p>}

      {active ? (
        <div className="space-y-3 rounded-2xl border border-accent/50 bg-accent/10 p-4 text-xs text-ink">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <div className="font-semibold">
                {t('orgadm.support.on', { scope: scopeLabel(active.scope).toLowerCase(), when: when(active.expiresAt) })}
              </div>
              <div className="text-ink-muted">{t('orgadm.support.reason', { reason: active.reason })}</div>
              <div className="text-[11px] text-ink-subtle">
                {t('orgadm.support.grantedBy', { email: active.grantedByEmail, when: when(active.createdAt) })}{' '}
                {active.lastEnteredAt
                  ? t('orgadm.support.lastUsed', { email: active.lastEnteredByEmail ?? '', when: when(active.lastEnteredAt) })
                  : t('orgadm.support.notUsed')}
              </div>
            </div>
            {confirmRevoke === active.id ? (
              <div className="flex items-center gap-2">
                <button type="button" className={`${ghost} text-danger`} disabled={busy} onClick={() => revoke(active.id)}>
                  <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('orgadm.support.revokeNow')}
                </button>
                <button type="button" className={ghost} disabled={busy} onClick={() => setConfirmRevoke(null)}>
                  {t('orgadm.support.keep')}
                </button>
              </div>
            ) : (
              <button type="button" className={ghost} disabled={busy} onClick={() => setConfirmRevoke(active.id)}>
                <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />
                {t('orgadm.support.revoke')}
              </button>
            )}
          </div>
          {confirmRevoke === active.id && <p className="text-[11px] text-ink-muted">{t('orgadm.support.revokeNote')}</p>}
        </div>
      ) : (
        data && (
          <form onSubmit={grant} className="grid grid-cols-1 gap-3 rounded-2xl border border-line bg-canvas p-4 sm:grid-cols-2">
            <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
              {t('orgadm.support.access')}
              <select className={field} value={scope} onChange={(e) => setScope(e.target.value as SupportPass['scope'])}>
                <option value="READ_ONLY">{t('orgadm.support.optReadOnly')}</option>
                <option value="FULL">{t('orgadm.support.optFull')}</option>
              </select>
            </label>
            <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
              {t('orgadm.support.for')}
              <select className={field} value={hours} onChange={(e) => setHours(Number(e.target.value))}>
                {DURATIONS.map((h) => (
                  <option key={h} value={h}>
                    {t.plural('orgadm.support.hours', h)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-[11px] font-semibold text-ink-muted sm:col-span-2">
              {t('orgadm.support.reasonLabel')}
              <textarea
                className={field}
                rows={2}
                maxLength={500}
                required
                minLength={5}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('orgadm.support.reasonPlaceholder')}
              />
            </label>
            <div className="sm:col-span-2">
              <button type="submit" className={primary} disabled={busy || reason.trim().length < 5}>
                {t('orgadm.support.grant')}
              </button>
            </div>
          </form>
        )
      )}

      {history.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-ink-muted">{t('orgadm.support.earlier')}</h3>
          <ul className="divide-y divide-line text-xs">
            {history.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <span className="font-semibold text-ink">{scopeLabel(p.scope)}</span>
                  <span className="text-ink-muted"> · {p.reason}</span>
                  <div className="text-[11px] text-ink-subtle">
                    {t('orgadm.support.histGranted', { email: p.grantedByEmail, when: when(p.createdAt) })}
                    {p.lastEnteredAt ? t('orgadm.support.histUsed', { email: p.lastEnteredByEmail ?? '' }) : t('orgadm.support.histNever')}
                  </div>
                </div>
                <span className="text-[11px] text-ink-muted">
                  {p.status === 'REVOKED'
                    ? p.revokedByEmail
                      ? t('orgadm.support.revokedBy', { email: p.revokedByEmail, when: when(p.revokedAt!) })
                      : t('orgadm.support.revoked', { when: when(p.revokedAt!) })
                    : t('orgadm.support.expired', { when: when(p.expiresAt) })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};
