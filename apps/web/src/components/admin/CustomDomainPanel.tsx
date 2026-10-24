'use client';

import React, { useState } from 'react';
import { CheckCircle2, Clock, Copy, Globe, RefreshCw, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { useT, type Translator } from '@/lib/i18n';
import { Banner } from '@/components/admin/IdentityPanels';

// An organisation's own domain (e.g. learn.university.edu). A domain asked for waits until DNS carries the TXT
// record shown here; only then does it become the live address, and the previous live domain keeps working
// until that moment. Used by the organisation's administrators (admin area) and by the platform operator for
// any organisation (platform console), against the same API shape.

const input =
  'w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand';
const primary =
  'inline-flex items-center gap-1 px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold transition-all';
const ghost =
  'inline-flex items-center gap-1 px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50';

export interface DomainState {
  subdomain: string | null;
  customDomain: string | null;
  verifiedAt: string | null;
  pending: {
    domain: string;
    txtName: string;
    txtValue: string;
    requestedAt: string | null;
    checkedAt: string | null;
    error: string | null;
  } | null;
  target: string | null;
}
interface DomainCheck extends DomainState {
  check: {
    verified: boolean;
    domain: string;
    error: string | null;
    routing: { target: string | null; pointsAtPlatform: boolean | null; detail: string };
  };
}

/** The same rule the API applies, so obvious typos are caught before saving. */
const DOMAIN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const when = (t: Translator, iso: string | null) => (iso ? new Date(iso).toLocaleString() : t('orgadm.domain.never'));

const CopyValue: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-semibold text-ink-muted">{label}</div>
      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 bg-canvas border border-line rounded-lg px-3 py-2 text-[11px] text-ink break-all select-all">
          {value}
        </code>
        <button
          type="button"
          className={ghost}
          aria-label={t('orgadm.domain.copyAria', { label })}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              /* clipboard may be unavailable; the value is selectable */
            }
          }}
        >
          <Copy className="h-3.5 w-3.5" />
          {copied ? t('orgadm.domain.copied') : t('orgadm.domain.copy')}
        </button>
      </div>
    </div>
  );
};

/**
 * Shows and changes one organisation's custom domain. `basePath` is /api/v1/admin/custom-domain for the
 * organisation itself or /api/v1/operator/tenants/<id>/custom-domain for the platform operator.
 */
export const CustomDomainEditor: React.FC<{ basePath: string; onChanged?: () => void }> = ({ basePath, onChanged }) => {
  const t = useT();
  const { data, isLoading, error, reload } = useApiData<{ data: DomainState }>(basePath);
  const { busy, error: actionError, run, clearError } = useAction();
  const [domain, setDomain] = useState('');
  const [result, setResult] = useState<DomainCheck['check'] | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const pendingId = React.useId();

  const d = data?.data;
  const typed = domain.trim().toLowerCase().replace(/\.$/, '');
  const typedOk = DOMAIN.test(typed);

  const changed = async () => {
    await reload();
    onChanged?.();
  };
  const request = (e: React.FormEvent) => {
    e.preventDefault();
    setResult(null);
    run(async () => {
      await api.put(basePath, { domain: typed });
      setDomain('');
      await changed();
    });
  };
  const check = () =>
    run(async () => {
      const res = await api.post<{ data: DomainCheck }>(`${basePath}/verify`);
      setResult(res.data.check);
      await changed();
    });
  const remove = (scope: 'pending' | 'all') =>
    run(async () => {
      setResult(null);
      await api.delete(`${basePath}?scope=${scope}`);
      setConfirmRemove(false);
      await changed();
    });

  if (isLoading && !d) return <p className="text-xs text-ink-subtle">{t('common.loading')}</p>;

  return (
    <div className="space-y-4">
      {(error || actionError) && <Banner kind="error">{error || actionError}</Banner>}

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div className="rounded-xl border border-line bg-canvas p-3">
          <dt className="text-[11px] font-semibold text-ink-muted">{t('orgadm.domain.live')}</dt>
          <dd className="mt-1">
            {d?.customDomain ? (
              <>
                <span className="inline-flex items-center gap-1 font-mono text-ink">
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                  {d.customDomain}
                </span>
                <span className="block text-[11px] text-ink-subtle">{t('orgadm.domain.verified', { when: when(t, d.verifiedAt) })}</span>
              </>
            ) : (
              <span className="text-ink-subtle">{t('orgadm.domain.none')}</span>
            )}
          </dd>
        </div>
        <div className="rounded-xl border border-line bg-canvas p-3">
          <dt className="text-[11px] font-semibold text-ink-muted">{t('orgadm.domain.platformAddress')}</dt>
          <dd className="mt-1 font-mono text-ink">{d?.subdomain ?? t('orgadm.domain.platformMain')}</dd>
          <dd className="text-[11px] text-ink-subtle">{t('orgadm.domain.alwaysWorks')}</dd>
        </div>
      </dl>

      {d?.pending && (
        <div className="rounded-2xl border border-accent/50 bg-accent/5 p-4 space-y-3" aria-labelledby={pendingId}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h4 id={pendingId} className="inline-flex items-center gap-1 text-xs font-bold text-ink">
                <Clock className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                {t('orgadm.domain.waiting')} <span className="font-mono">{d.pending.domain}</span>
              </h4>
              <p className="text-[11px] text-ink-muted">
                {t('orgadm.domain.addTxt')}{' '}
                {d.customDomain ? t('orgadm.domain.staysLive', { domain: d.customDomain }) : t('orgadm.domain.notWorking')}
              </p>
            </div>
            <div className="flex gap-2">
              <button type="button" className={primary} disabled={busy} onClick={check}>
                <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />
                {busy ? t('orgadm.domain.checking') : t('orgadm.domain.checkNow')}
              </button>
              <button type="button" className={ghost} disabled={busy} onClick={() => remove('pending')}>
                {t('orgadm.cancel')}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <CopyValue label={t('orgadm.domain.txtName')} value={d.pending.txtName} />
            <CopyValue label={t('orgadm.domain.txtValue')} value={d.pending.txtValue} />
          </div>
          {d.target && <CopyValue label={t('orgadm.domain.cname', { domain: d.pending.domain })} value={d.target} />}
          <p className="text-[11px] text-ink-subtle">{t('orgadm.domain.lastChecked', { when: when(t, d.pending.checkedAt) })}</p>
          {d.pending.error && <Banner kind="error">{d.pending.error}</Banner>}
        </div>
      )}

      {result?.verified && <Banner kind="ok">{t('orgadm.domain.nowLive', { domain: result.domain })}</Banner>}
      {result && result.routing.pointsAtPlatform !== null && (
        <p className={`text-[11px] ${result.routing.pointsAtPlatform ? 'text-success' : 'text-ink-muted'}`}>{result.routing.detail}</p>
      )}

      <form onSubmit={request} className="flex flex-wrap items-end gap-2" onChange={() => clearError()}>
        <label className="flex-1 min-w-56 space-y-1 text-[11px] font-semibold text-ink-muted">
          {d?.customDomain || d?.pending ? t('orgadm.domain.different') : t('orgadm.domain.yours')}
          <input
            className={`${input} font-mono ${domain && !typedOk ? 'border-danger' : ''}`}
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="learn.university.edu"
            maxLength={253}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button className={primary} disabled={busy || !typedOk}>
          <Globe className="h-3.5 w-3.5" aria-hidden="true" />
          {d?.customDomain || d?.pending ? t('orgadm.domain.change') : t('orgadm.domain.add')}
        </button>
      </form>
      {domain && !typedOk && <p className="text-[11px] text-danger">{t('orgadm.domain.invalid')}</p>}

      {d?.customDomain && (
        <div className="flex flex-wrap items-center gap-2">
          {!confirmRemove ? (
            <button type="button" className={ghost} disabled={busy} onClick={() => setConfirmRemove(true)}>
              <Trash2 className="h-3 w-3" aria-hidden="true" /> {t('orgadm.domain.remove')}
            </button>
          ) : (
            <div
              role="alertdialog"
              aria-label={t('orgadm.domain.removeAria')}
              className="rounded-xl border border-danger/40 bg-danger/5 p-3 space-y-2"
            >
              <p className="text-[11px] text-ink">
                {d.pending
                  ? t('orgadm.domain.removeBodyPending', {
                      domain: d.customDomain,
                      pending: d.pending.domain,
                      address: d.subdomain ?? t('orgadm.domain.platformAddressShort'),
                    })
                  : t('orgadm.domain.removeBody', {
                      domain: d.customDomain,
                      address: d.subdomain ?? t('orgadm.domain.platformAddressShort'),
                    })}
              </p>
              <div className="flex gap-2">
                <button type="button" className={ghost} disabled={busy} onClick={() => setConfirmRemove(false)}>
                  {t('orgadm.domain.keep')}
                </button>
                <button
                  type="button"
                  className="px-3 py-1.5 bg-danger hover:opacity-90 text-on-danger rounded-lg text-[11px] font-bold disabled:opacity-50"
                  disabled={busy}
                  onClick={() => remove('all')}
                >
                  {t('orgadm.domain.removeConfirm')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/** The admin area's panel: the organisation's own custom domain. */
export const CustomDomainPanel: React.FC = () => {
  const t = useT();
  return (
    <section className="space-y-4" aria-labelledby="domain-h">
      <div>
        <h3 id="domain-h" className="font-bold text-base text-ink">
          {t('orgadm.domain.title')}
        </h3>
        <p className="text-xs text-ink-muted">{t('orgadm.domain.intro')}</p>
      </div>
      <CustomDomainEditor basePath="/api/v1/admin/custom-domain" />
    </section>
  );
};
