'use client';

import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAction } from '@/hooks/useApiData';
import { useT } from '@/lib/i18n';
import { Button, Input } from '@/components/ui';
import { Banner } from '@/components/admin/identity/Banner';
import { shortDate, type MinorStatus, type Notice, type Person } from './shared';

/**
 * Under-18 mark and guardian consent (DPDP Act s.9). The current state is loaded when the person is opened.
 */
export const MinorControls: React.FC<{ person: Person; onNotice: (n: Notice) => void }> = ({ person, onNotice }) => {
  const t = useT();
  const { busy, error, run, clearError } = useAction();
  const [status, setStatus] = useState<MinorStatus | null>(null);
  const [email, setEmail] = useState('');
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const name = `${person.firstName} ${person.lastName}`;

  useEffect(() => {
    let live = true;
    api.get<{ data: MinorStatus }>(`/api/v1/privacy/users/${person.id}/minor`).then(
      (r) => live && setStatus(r.data),
      () => {}
    );
    return () => {
      live = false;
    };
  }, [person.id]);

  const setMinor = (isMinor: boolean) =>
    run(async () => {
      const r = await api.put<{ data: MinorStatus }>(`/api/v1/privacy/users/${person.id}/minor`, { isMinor });
      setStatus(r.data);
      onNotice({
        kind: 'ok',
        text: t(isMinor ? 'people.minor.markedNotice' : 'people.minor.clearedNotice', { name }),
      });
    });

  const ask = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await api.post<{ data: MinorStatus }>(`/api/v1/privacy/users/${person.id}/guardian-consent`, {
        guardianEmail: email.trim(),
      });
      setStatus(r.data);
      setEmail('');
      onNotice({ kind: 'ok', text: t('people.minor.consentSent', { name }) });
    });
  };

  return (
    <div className="space-y-2 border-t border-line pt-3" role="group" aria-label={t('people.minor.group', { name })}>
      <p className="text-xs font-bold text-ink">{t('people.minor.title')}</p>
      {error && <Banner kind="error">{error}</Banner>}
      {status && (
        <p className="text-[11px] text-ink-muted" role="status">
          {status.isMinor
            ? status.guardianConsentAt
              ? t('people.minor.consented', { date: shortDate(t, status.guardianConsentAt) })
              : status.guardianEmail
                ? status.pendingRequestExpiresAt
                  ? t('people.minor.outstandingAskedUntil', {
                      email: status.guardianEmail,
                      date: shortDate(t, status.pendingRequestExpiresAt),
                    })
                  : t('people.minor.outstandingAsked', { email: status.guardianEmail })
                : t('people.minor.outstanding')
            : t('people.minor.not')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy || status?.isMinor === true}
          onClick={() => {
            clearError();
            setMinor(true);
          }}
        >
          {t('people.minor.mark')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy || status?.isMinor === false}
          onClick={() => {
            clearError();
            setMinor(false);
          }}
        >
          {t('people.minor.clear')}
        </Button>
      </div>
      {status?.isMinor && !status.guardianConsentAt && (
        <form onSubmit={ask} className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-xs font-semibold text-ink-muted">
            {t('people.minor.guardianEmail')}
            <Input
              fullWidth={false}
              className="block w-64"
              type="email"
              maxLength={320}
              value={email}
              onChange={(e) => {
                clearError();
                setEmail(e.target.value);
              }}
            />
          </label>
          <Button type="submit" disabled={busy || !emailOk}>
            {busy ? t('people.minor.sending') : t('people.minor.ask')}
          </Button>
        </form>
      )}
      <p className="text-[11px] text-ink-subtle">{t('people.minor.clearNote')}</p>
    </div>
  );
};
