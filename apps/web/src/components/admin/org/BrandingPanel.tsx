'use client';

import React, { useEffect, useId, useState } from 'react';
import { api } from '@/lib/api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { useT } from '@/lib/i18n';
import { expandHex, isHexColor, isHttpUrlOrEmpty } from '@/lib/forms';
import { Button, Input } from '@/components/ui';
import { Banner } from '@/components/admin/identity/Banner';
import type { TenantSettings } from './shared';

const ColorField: React.FC<{ label: string; value: string; onChange: (v: string) => void }> = ({ label, value, onChange }) => {
  const t = useT();
  const inputId = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={inputId} className="text-xs text-ink-muted font-semibold block">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={t('orgadm.brand.picker', { label })}
          value={isHexColor(value) ? expandHex(value) : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-10 rounded-lg bg-canvas border border-line p-0.5"
        />
        <Input
          id={inputId}
          className="font-mono"
          invalid={Boolean(value && !isHexColor(value))}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
};

export const BrandingPanel: React.FC = () => {
  const t = useT();
  const { data, isLoading, error, reload } = useApiData<{ data: TenantSettings }>('/api/v1/admin/tenant');
  const { busy, error: actionError, run, clearError } = useAction();
  const [name, setName] = useState('');
  const [primaryC, setPrimaryC] = useState('');
  const [secondaryC, setSecondaryC] = useState('');
  const [logo, setLogo] = useState('');
  const [favicon, setFavicon] = useState('');
  const [saved, setSaved] = useState(false);

  const tenant = data?.data;
  useEffect(() => {
    if (!tenant) return;
    setName(tenant.name);
    setPrimaryC(tenant.primaryColor ?? '');
    setSecondaryC(tenant.secondaryColor ?? '');
    setLogo(tenant.logoUrl ?? '');
    setFavicon(tenant.faviconUrl ?? '');
  }, [tenant]);

  const valid =
    name.trim().length >= 2 && isHexColor(primaryC) && isHexColor(secondaryC) && isHttpUrlOrEmpty(logo) && isHttpUrlOrEmpty(favicon);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(false);
    run(async () => {
      await api.patch('/api/v1/admin/tenant', {
        name: name.trim(),
        primaryColor: primaryC.trim(),
        secondaryColor: secondaryC.trim(),
        logoUrl: logo.trim(),
        faviconUrl: favicon.trim(),
      });
      setSaved(true);
      await reload();
    });
  };

  return (
    <section className="space-y-4" aria-labelledby="brand-h">
      <div>
        <h3 id="brand-h" className="font-bold text-base text-ink">
          {t('orgadm.brand.title')}
        </h3>
        <p className="text-xs text-ink-muted">
          {t('orgadm.brand.intro')}{' '}
          <span className="font-mono text-ink">{tenant?.customDomain ?? t('orgadm.brand.subdomain', { slug: tenant?.slug ?? '…' })}</span>
        </p>
      </div>
      {(error || actionError) && <Banner kind="error">{error || actionError}</Banner>}
      {saved && <Banner kind="ok">{t('orgadm.brand.saved')}</Banner>}

      <form
        onSubmit={save}
        className="space-y-3"
        onChange={() => {
          setSaved(false);
          clearError();
        }}
      >
        <label className="block space-y-1 text-xs text-ink-muted font-semibold">
          {t('orgadm.brand.orgName')}
          <Input required minLength={2} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <ColorField label={t('orgadm.brand.primary')} value={primaryC} onChange={setPrimaryC} />
          <ColorField label={t('orgadm.brand.secondary')} value={secondaryC} onChange={setSecondaryC} />
        </div>
        <label className="block space-y-1 text-xs text-ink-muted font-semibold">
          {t('orgadm.brand.logo')}
          <Input
            invalid={!isHttpUrlOrEmpty(logo)}
            placeholder="https://…/logo.png"
            value={logo}
            onChange={(e) => setLogo(e.target.value)}
          />
        </label>
        <label className="block space-y-1 text-xs text-ink-muted font-semibold">
          {t('orgadm.brand.favicon')}
          <Input
            invalid={!isHttpUrlOrEmpty(favicon)}
            placeholder="https://…/favicon.ico"
            value={favicon}
            onChange={(e) => setFavicon(e.target.value)}
          />
        </label>

        <div className="flex items-center gap-3 p-3 rounded-xl border border-line bg-canvas" aria-label={t('orgadm.brand.preview')}>
          <span className="h-8 w-8 rounded-lg" style={{ background: isHexColor(primaryC) ? primaryC : '#334155' }} />
          <span className="h-8 w-8 rounded-lg" style={{ background: isHexColor(secondaryC) ? secondaryC : '#334155' }} />
          <span className="text-xs font-bold text-ink">{name || t('orgadm.brand.yourOrg')}</span>
        </div>

        <Button type="submit" disabled={busy || isLoading || !valid}>
          {busy ? t('orgadm.saving') : t('orgadm.brand.save')}
        </Button>
      </form>
    </section>
  );
};
