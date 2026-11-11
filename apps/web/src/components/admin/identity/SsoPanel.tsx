'use client';

import React, { useEffect, useState } from 'react';
import { CheckCircle2, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { useT } from '@/lib/i18n';
import { Button, Card, Input } from '@/components/ui';
import { Banner } from './Banner';
import { AutoCreateToggle, splitDomains } from './shared';

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

      <Card padding="sm" className="rounded-xl text-[11px] text-ink-muted space-y-1">
        <div>{(data?.redirectUris?.length ?? 0) > 1 ? t('ident.sso.registerMany') : t('ident.sso.registerOne')}</div>
        {(data?.redirectUris ?? []).map((u) => (
          <code key={u} className="block text-brand-fg select-all break-all">
            {u}
          </code>
        ))}
        {!data && <span>…</span>}
      </Card>

      <form onSubmit={save} className="grid grid-cols-1 md:grid-cols-2 gap-4" onChange={clearError}>
        <label className="space-y-1 text-xs text-ink-muted font-semibold">
          {t('ident.sso.issuer')}
          <Input
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
          <Input required value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={!available} />
        </label>
        <label className="space-y-1 text-xs text-ink-muted font-semibold">
          {t('ident.sso.clientSecret')}
          <Input
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
          {t('ident.sso.enable')}
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
