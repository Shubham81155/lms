'use client';

import React, { useEffect, useState } from 'react';
import { CheckCircle2, Copy, KeyRound, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { daysUntil } from '@/lib/forms';
import { useT } from '@/lib/i18n';

const LOCAL_DATE: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric', timeZone: undefined };

const input =
  'w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand';
const primaryBtn = 'px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold transition-all';
const ghostBtn =
  'px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50';

export const Banner: React.FC<{ kind: 'error' | 'ok'; children: React.ReactNode }> = ({ kind, children }) => (
  <div
    role={kind === 'error' ? 'alert' : 'status'}
    className={`p-3 rounded-xl text-xs border ${
      kind === 'error' ? 'bg-danger/10 border-danger/30 text-danger' : 'bg-success/10 border-success/30 text-success'
    }`}
  >
    {children}
  </div>
);

/** A secret that is shown exactly once, with a copy button. */
export const OnceSecret: React.FC<{ label: string; value: string; onDismiss: () => void }> = ({ label, value, onDismiss }) => {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="p-4 rounded-2xl border border-accent/60 bg-accent/10 space-y-2">
      <div className="text-xs font-bold text-accent">{label}</div>
      <p className="text-[11px] text-accent/80">{t('ident.secret.once')}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 bg-canvas border border-line rounded-lg px-3 py-2 text-[11px] text-accent break-all select-all">
          {value}
        </code>
        <button
          className={ghostBtn}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
            } catch {
              /* clipboard may be unavailable; the value is selectable */
            }
          }}
        >
          <Copy className="h-3.5 w-3.5 inline mr-1" />
          {copied ? t('ident.secret.copied') : t('ident.secret.copy')}
        </button>
        <button className={ghostBtn} onClick={onDismiss}>
          {t('ident.secret.done')}
        </button>
      </div>
    </div>
  );
};

const splitDomains = (text: string) => text.split(/[\s,]+/).filter(Boolean);

/** Shared by both protocols: create learner accounts at first sign-in, only once domains are listed. */
const AutoCreateToggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; domains: string; available: boolean }> = ({
  checked,
  onChange,
  domains,
  available,
}) => {
  const t = useT();
  const list = splitDomains(domains);
  const usable = list.length > 0;
  return (
    <div className="md:col-span-2 space-y-1">
      <label className="flex items-center gap-2 text-xs text-ink">
        <input
          type="checkbox"
          checked={checked && usable}
          onChange={(e) => onChange(e.target.checked)}
          disabled={!available || !usable}
          className="rounded border-line bg-canvas text-brand-fg"
        />
        {t('ident.auto.label')}
      </label>
      <p className="pl-6 text-[11px] text-ink-subtle">
        {usable ? t('ident.auto.usable', { domains: list.join(` ${t('common.or')} `) }) : t('ident.auto.needDomains')}
      </p>
    </div>
  );
};

// ---------------------------------------------------------------------------
// OpenID Connect
// ---------------------------------------------------------------------------

interface SsoView {
  issuer: string;
  clientId: string;
  enabled: boolean;
  allowedDomains: string[];
  autoCreateAccounts: boolean;
  hasSecret: boolean;
  redirectUris: string[];
}

export const SsoPanel: React.FC<{ available: boolean }> = ({ available }) => {
  const t = useT();
  const { data, isLoading, error, reload } = useApiData<{ data: SsoView | null; redirectUris: string[] }>('/api/v1/admin/sso');
  const { busy, error: actionError, run, clearError } = useAction();
  const [issuer, setIssuer] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [domains, setDomains] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [autoCreate, setAutoCreate] = useState(false);
  const [saved, setSaved] = useState(false);

  const conn = data?.data ?? null;
  useEffect(() => {
    if (conn) {
      setIssuer(conn.issuer);
      setClientId(conn.clientId);
      setDomains(conn.allowedDomains.join(', '));
      setEnabled(conn.enabled);
      setAutoCreate(conn.autoCreateAccounts);
    }
  }, [conn]);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(false);
    run(async () => {
      await api.put('/api/v1/admin/sso', {
        issuer: issuer.trim(),
        clientId: clientId.trim(),
        enabled,
        allowedDomains: splitDomains(domains),
        autoCreateAccounts: autoCreate && splitDomains(domains).length > 0,
        ...(clientSecret ? { clientSecret } : {}),
      });
      setClientSecret('');
      setSaved(true);
      await reload();
    });
  };

  const remove = () => {
    if (!window.confirm(t('ident.sso.confirmRemove'))) return;
    run(async () => {
      await api.delete('/api/v1/admin/sso');
      setIssuer('');
      setClientId('');
      setDomains('');
      setEnabled(false);
      await reload();
    });
  };

  return (
    <section className="space-y-4" aria-labelledby="sso-heading">
      <div>
        <h3 id="sso-heading" className="font-bold text-base text-ink">
          {t('ident.sso.title')}
        </h3>
        <p className="text-xs text-ink-muted">{t('ident.sso.intro')}</p>
      </div>

      {!available && <Banner kind="error">{t('ident.ssoNotIncluded')}</Banner>}
      {error && <Banner kind="error">{error}</Banner>}
      {actionError && <Banner kind="error">{actionError}</Banner>}
      {saved && <Banner kind="ok">{t('ident.settingsSaved')}</Banner>}

      <div className="text-[11px] text-ink-muted bg-canvas border border-line rounded-xl p-3 space-y-1">
        <div>{(data?.redirectUris?.length ?? 0) > 1 ? t('ident.sso.registerMany') : t('ident.sso.registerOne')}</div>
        {(data?.redirectUris ?? []).map((u) => (
          <code key={u} className="block text-brand-fg select-all break-all">
            {u}
          </code>
        ))}
        {!data && <span>…</span>}
      </div>

      <form onSubmit={save} className="grid grid-cols-1 md:grid-cols-2 gap-4" onChange={clearError}>
        <label className="space-y-1 text-xs text-ink-muted font-semibold">
          {t('ident.sso.issuer')}
          <input
            className={input}
            type="url"
            required
            placeholder="https://login.example.com"
            value={issuer}
            onChange={(e) => setIssuer(e.target.value)}
            disabled={!available}
          />
        </label>
        <label className="space-y-1 text-xs text-ink-muted font-semibold">
          {t('ident.sso.clientId')}
          <input className={input} required value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={!available} />
        </label>
        <label className="space-y-1 text-xs text-ink-muted font-semibold">
          {t('ident.sso.clientSecret')}
          <input
            className={input}
            type="password"
            autoComplete="new-password"
            required={!conn}
            placeholder={conn?.hasSecret ? t('ident.sso.secretKeep') : ''}
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            disabled={!available}
          />
        </label>
        <label className="space-y-1 text-xs text-ink-muted font-semibold">
          {t('ident.domains')}
          <input
            className={input}
            placeholder="university.edu, partner.org"
            value={domains}
            onChange={(e) => setDomains(e.target.value)}
            disabled={!available}
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-ink md:col-span-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={!available}
            className="rounded border-line bg-canvas text-brand-fg"
          />
          {t('ident.sso.enable')}
        </label>
        <AutoCreateToggle checked={autoCreate} onChange={setAutoCreate} domains={domains} available={available} />
        <div className="md:col-span-2 flex items-center gap-3">
          <button className={primaryBtn} disabled={busy || isLoading || !available}>
            {busy ? t('ident.saving') : t('ident.save')}
          </button>
          {conn && (
            <button type="button" className={ghostBtn} onClick={remove} disabled={busy}>
              <Trash2 className="h-3.5 w-3.5 inline mr-1" />
              {t('ident.removeConnection')}
            </button>
          )}
          {conn?.enabled && (
            <span className="text-xs text-success flex items-center gap-1">
              <CheckCircle2 className="h-4 w-4" /> {t('ident.active')}
            </span>
          )}
        </div>
      </form>
    </section>
  );
};

// ---------------------------------------------------------------------------
// SCIM provisioning tokens
// ---------------------------------------------------------------------------

interface ScimToken {
  id: string;
  label: string;
  createdAt: string;
  revokedAt: string | null;
}

export const ScimPanel: React.FC<{ available: boolean }> = ({ available }) => {
  const t = useT();
  const { data, error, reload } = useApiData<{ data: ScimToken[] }>('/api/v1/admin/scim-tokens');
  const { busy, error: actionError, run } = useAction();
  const [label, setLabel] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await api.post<{ data: { token: string } }>('/api/v1/admin/scim-tokens', { label: label.trim() });
      setFresh(r.data.token);
      setLabel('');
      await reload();
    });
  };

  const revoke = (tok: ScimToken) => {
    if (!window.confirm(t('ident.scim.confirmRevoke', { label: tok.label }))) return;
    run(async () => {
      await api.delete(`/api/v1/admin/scim-tokens/${tok.id}`);
      await reload();
    });
  };

  const base = typeof window !== 'undefined' ? `${window.location.origin}/api/v1/scim/v2` : '/api/v1/scim/v2';

  return (
    <section className="space-y-4" aria-labelledby="scim-heading">
      <div>
        <h3 id="scim-heading" className="font-bold text-base text-ink">
          {t('ident.scim.title')}
        </h3>
        <p className="text-xs text-ink-muted">{t('ident.scim.intro')}</p>
      </div>

      {!available && <Banner kind="error">{t('ident.scim.notIncluded')}</Banner>}
      {(error || actionError) && <Banner kind="error">{error || actionError}</Banner>}
      <div className="text-[11px] text-ink-muted bg-canvas border border-line rounded-xl p-3">
        {t('ident.scim.baseUrl')} <code className="text-brand-fg select-all break-all">{base}</code> {t('ident.scim.baseUrlAuth')}
      </div>

      {fresh && <OnceSecret label={t('ident.scim.newToken')} value={fresh} onDismiss={() => setFresh(null)} />}

      <form onSubmit={create} className="flex items-end gap-3">
        <label className="flex-1 space-y-1 text-xs text-ink-muted font-semibold">
          {t('ident.scim.tokenLabel')}
          <input
            className={input}
            required
            maxLength={100}
            placeholder={t('ident.scim.tokenPlaceholder')}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={!available}
          />
        </label>
        <button className={primaryBtn} disabled={busy || !available || !label.trim()}>
          <KeyRound className="h-3.5 w-3.5 inline mr-1" />
          {t('ident.scim.create')}
        </button>
      </form>

      <ul className="space-y-2">
        {(data?.data ?? []).length === 0 && <li className="text-xs text-ink-subtle">{t('ident.scim.none')}</li>}
        {(data?.data ?? []).map((tok) => (
          <li key={tok.id} className="bg-canvas border border-line rounded-xl p-3 flex items-center justify-between text-xs">
            <div>
              <strong className="text-ink">{tok.label}</strong>
              <span className="text-ink-subtle ml-2">{t('ident.scim.created', { date: t.date(tok.createdAt, LOCAL_DATE) })}</span>
            </div>
            {tok.revokedAt ? (
              <span className="text-ink-subtle">{t('ident.scim.revoked')}</span>
            ) : (
              <button className={ghostBtn} onClick={() => revoke(tok)} disabled={busy}>
                {t('ident.scim.revoke')}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
};

// ---------------------------------------------------------------------------
// SAML 2.0
// ---------------------------------------------------------------------------

interface SamlView {
  entryPoint: string;
  idpIssuer: string;
  emailAttribute: string;
  enabled: boolean;
  allowedDomains: string[];
  autoCreateAccounts: boolean;
  keyKind: 'CERTIFICATE' | 'PUBLIC KEY' | null;
  keyFingerprint: string | null;
  keyExpires: string | null;
}
interface SamlSp {
  entityIds: string[];
  acsUrls: string[];
  metadataUrls: string[];
}

const CopyList: React.FC<{ label: string; values: string[] }> = ({ label, values }) => (
  <div>
    <div className="text-ink-subtle">{label}</div>
    {values.map((v) => (
      <code key={v} className="block text-brand-fg select-all break-all">
        {v}
      </code>
    ))}
  </div>
);

export const SamlPanel: React.FC<{ available: boolean }> = ({ available }) => {
  const t = useT();
  const { data, isLoading, error, reload } = useApiData<{ data: SamlView | null; sp: SamlSp }>('/api/v1/admin/saml');
  const { busy, error: actionError, run, clearError } = useAction();
  const [entryPoint, setEntryPoint] = useState('');
  const [issuer, setIssuer] = useState('');
  const [cert, setCert] = useState('');
  const [emailAttr, setEmailAttr] = useState('email');
  const [domains, setDomains] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [autoCreate, setAutoCreate] = useState(false);
  const [saved, setSaved] = useState(false);

  const conn = data?.data ?? null;
  useEffect(() => {
    if (!conn) return;
    setEntryPoint(conn.entryPoint);
    setIssuer(conn.idpIssuer);
    setEmailAttr(conn.emailAttribute);
    setDomains(conn.allowedDomains.join(', '));
    setEnabled(conn.enabled);
    setAutoCreate(conn.autoCreateAccounts);
  }, [conn]);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(false);
    run(async () => {
      await api.put('/api/v1/admin/saml', {
        entryPoint: entryPoint.trim(),
        idpIssuer: issuer.trim(),
        emailAttribute: emailAttr.trim() || 'email',
        enabled,
        allowedDomains: splitDomains(domains),
        autoCreateAccounts: autoCreate && splitDomains(domains).length > 0,
        ...(cert.trim() ? { idpCert: cert.trim() } : {}),
      });
      setCert('');
      setSaved(true);
      await reload();
    });
  };

  const remove = () => {
    if (!window.confirm(t('ident.saml.confirmRemove'))) return;
    run(async () => {
      await api.delete('/api/v1/admin/saml');
      setEntryPoint('');
      setIssuer('');
      setDomains('');
      setEnabled(false);
      await reload();
    });
  };

  const left = daysUntil(conn?.keyExpires ?? null);

  return (
    <section className="space-y-4" aria-labelledby="saml-h">
      <div>
        <h3 id="saml-h" className="font-bold text-base text-ink">
          {t('ident.saml.title')}
        </h3>
        <p className="text-xs text-ink-muted">{t('ident.saml.intro')}</p>
      </div>

      {!available && <Banner kind="error">{t('ident.ssoNotIncluded')}</Banner>}
      {(error || actionError) && <Banner kind="error">{error || actionError}</Banner>}
      {saved && <Banner kind="ok">{t('ident.settingsSaved')}</Banner>}
      {left !== null && left < 0 && <Banner kind="error">{t('ident.saml.expired')}</Banner>}
      {left !== null && left >= 0 && left <= 30 && <Banner kind="error">{t.plural('ident.saml.expiresSoon', left)}</Banner>}

      <div className="text-[11px] text-ink-muted bg-canvas border border-line rounded-xl p-3 space-y-2">
        <div>{t('ident.saml.giveIdp')}</div>
        <CopyList label={t('ident.saml.entityId')} values={data?.sp.entityIds ?? []} />
        <CopyList label={t('ident.saml.acsUrl')} values={data?.sp.acsUrls ?? []} />
        <CopyList label={t('ident.saml.metadataUrl')} values={data?.sp.metadataUrls ?? []} />
        {(data?.sp.entityIds.length ?? 0) > 1 && <div className="text-ink-subtle">{t('ident.saml.bothAddresses')}</div>}
      </div>

      <form
        onSubmit={save}
        className="grid grid-cols-1 md:grid-cols-2 gap-4"
        onChange={() => {
          clearError();
          setSaved(false);
        }}
      >
        <label className="space-y-1 text-xs text-ink-muted font-semibold">
          {t('ident.saml.idpUrl')}
          <input
            className={input}
            type="url"
            required
            placeholder="https://idp.example.com/sso"
            value={entryPoint}
            onChange={(e) => setEntryPoint(e.target.value)}
            disabled={!available}
          />
        </label>
        <label className="space-y-1 text-xs text-ink-muted font-semibold">
          {t('ident.saml.idpIssuer')}
          <input className={input} required value={issuer} onChange={(e) => setIssuer(e.target.value)} disabled={!available} />
        </label>
        <label className="space-y-1 text-xs text-ink-muted font-semibold md:col-span-2">
          {t('ident.saml.cert')}
          <textarea
            className={`${input} font-mono`}
            rows={4}
            required={!conn}
            placeholder={conn ? t('ident.saml.certKeep') : '-----BEGIN CERTIFICATE-----'}
            value={cert}
            onChange={(e) => setCert(e.target.value)}
            disabled={!available}
          />
        </label>
        {conn?.keyFingerprint && (
          <p className="md:col-span-2 text-[11px] text-ink-subtle">
            {conn.keyKind === 'CERTIFICATE' ? t('ident.saml.pinnedCert') : t('ident.saml.pinnedKey')}{' '}
            <span className="font-mono text-ink break-all">{conn.keyFingerprint}</span>
            {conn.keyExpires ? ` · ${t('ident.saml.expires', { date: t.date(conn.keyExpires, LOCAL_DATE) })}` : ''}
          </p>
        )}
        <label className="space-y-1 text-xs text-ink-muted font-semibold">
          {t('ident.saml.emailAttr')}
          <input className={input} value={emailAttr} onChange={(e) => setEmailAttr(e.target.value)} disabled={!available} />
        </label>
        <label className="space-y-1 text-xs text-ink-muted font-semibold">
          {t('ident.domains')}
          <input
            className={input}
            placeholder="university.edu, partner.org"
            value={domains}
            onChange={(e) => setDomains(e.target.value)}
            disabled={!available}
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-ink md:col-span-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={!available}
            className="rounded border-line bg-canvas text-brand-fg"
          />
          {t('ident.saml.enable')}
        </label>
        <AutoCreateToggle checked={autoCreate} onChange={setAutoCreate} domains={domains} available={available} />
        <div className="md:col-span-2 flex items-center gap-3">
          <button className={primaryBtn} disabled={busy || isLoading || !available}>
            {busy ? t('ident.saving') : t('ident.save')}
          </button>
          {conn && (
            <button type="button" className={ghostBtn} onClick={remove} disabled={busy}>
              <Trash2 className="h-3.5 w-3.5 inline mr-1" />
              {t('ident.removeConnection')}
            </button>
          )}
          {conn?.enabled && (
            <span className="text-xs text-success flex items-center gap-1">
              <CheckCircle2 className="h-4 w-4" /> {t('ident.active')}
            </span>
          )}
        </div>
      </form>
    </section>
  );
};
