'use client';

import React, { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { useT } from '@/lib/i18n';
import { Button, Card, Input, cardClasses } from '@/components/ui';
import { Banner } from './Banner';
import { LOCAL_DATE, OnceSecret } from './shared';

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
      <Card padding="sm" className="rounded-xl text-[11px] text-ink-muted">
        {t('ident.scim.baseUrl')} <code className="text-brand-fg select-all break-all">{base}</code> {t('ident.scim.baseUrlAuth')}
      </Card>

      {fresh && <OnceSecret label={t('ident.scim.newToken')} value={fresh} onDismiss={() => setFresh(null)} />}

      <form onSubmit={create} className="flex items-end gap-3">
        <label className="flex-1 space-y-1 text-xs text-ink-muted font-semibold">
          {t('ident.scim.tokenLabel')}
          <Input
            required
            maxLength={100}
            placeholder={t('ident.scim.tokenPlaceholder')}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={!available}
          />
        </label>
        <Button type="submit" disabled={busy || !available || !label.trim()}>
          <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
          {t('ident.scim.create')}
        </Button>
      </form>

      <ul className="space-y-2">
        {(data?.data ?? []).length === 0 && <li className="text-xs text-ink-subtle">{t('ident.scim.none')}</li>}
        {(data?.data ?? []).map((tok) => (
          <li key={tok.id} className={cardClasses({ padding: 'sm', className: 'rounded-xl flex items-center justify-between text-xs' })}>
            <div>
              <strong className="text-ink">{tok.label}</strong>
              <span className="text-ink-subtle ml-2">{t('ident.scim.created', { date: t.date(tok.createdAt, LOCAL_DATE) })}</span>
            </div>
            {tok.revokedAt ? (
              <span className="text-ink-subtle">{t('ident.scim.revoked')}</span>
            ) : (
              <Button type="button" variant="ghost" size="sm" onClick={() => revoke(tok)} disabled={busy}>
                {t('ident.scim.revoke')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
};
