'use client';

import React, { useEffect, useState } from 'react';
import { CheckCircle2, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { daysUntil } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { Button, Card, Input, Textarea } from '@/components/ui';
import { Banner } from './Banner';
import { AutoCreateToggle, LOCAL_DATE, splitDomains } from './shared';

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

      <Card padding="sm" className="rounded-xl text-[11px] text-ink-muted space-y-2">
        <div>{t('ident.saml.giveIdp')}</div>
        <CopyList label={t('ident.saml.entityId')} values={data?.sp.entityIds ?? []} />
        <CopyList label={t('ident.saml.acsUrl')} values={data?.sp.acsUrls ?? []} />
        <CopyList label={t('ident.saml.metadataUrl')} values={data?.sp.metadataUrls ?? []} />
        {(data?.sp.entityIds.length ?? 0) > 1 && <div className="text-ink-subtle">{t('ident.saml.bothAddresses')}</div>}
      </Card>

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
          <Input
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
          <Input required value={issuer} onChange={(e) => setIssuer(e.target.value)} disabled={!available} />
        </label>
        <label className="space-y-1 text-xs text-ink-muted font-semibold md:col-span-2">
          {t('ident.saml.cert')}
          <Textarea
            className="font-mono"
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
          <Input value={emailAttr} onChange={(e) => setEmailAttr(e.target.value)} disabled={!available} />
        </label>
        <label className="space-y-1 text-xs text-ink-muted font-semibold">
          {t('ident.domains')}
          <Input
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
          <Button type="submit" disabled={busy || isLoading || !available}>
            {busy ? t('ident.saving') : t('ident.save')}
          </Button>
          {conn && (
            <Button type="button" variant="ghost" size="sm" onClick={remove} disabled={busy}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              {t('ident.removeConnection')}
            </Button>
          )}
          {conn?.enabled && (
            <span className="text-xs text-success flex items-center gap-1">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> {t('ident.active')}
            </span>
          )}
        </div>
      </form>
    </section>
  );
};
