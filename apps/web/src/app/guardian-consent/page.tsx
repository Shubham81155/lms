'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { AuthCard, buttonClass } from '@/components/AuthCard';
import { Banner } from '@/components/admin/IdentityPanels';
import { RichText, useLocale } from '@/lib/i18n';

interface Info {
  organisation: string;
  firstName: string;
  expiresAt: string;
}

function GuardianConsent() {
  const { t, locale } = useLocale();
  const token = useSearchParams().get('token') ?? '';
  const [info, setInfo] = useState<Info | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'done' | 'error'>('loading');
  const [message, setMessage] = useState<{ key: 'incomplete' | 'checkFailed' | 'saveFailed' } | { text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setState('error');
      setMessage({ key: 'incomplete' });
      return;
    }
    api
      .get<{ data: Info }>('/api/v1/privacy/guardian-consent', { params: { token } })
      .then((res) => {
        setInfo(res.data);
        setState('ready');
      })
      .catch((err) => {
        setState('error');
        setMessage(err instanceof ApiError ? { text: err.message } : { key: 'checkFailed' });
      });
  }, [token]);

  const confirm = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api.post('/api/v1/privacy/guardian-consent', { token });
      setState('done');
    } catch (err) {
      setMessage(err instanceof ApiError ? { text: err.message } : { key: 'saveFailed' });
    } finally {
      setBusy(false);
    }
  };

  const msg = message ? ('text' in message ? message.text : t(`flow.gc.${message.key}`)) : '';

  return (
    <AuthCard title={t('flow.gc.title')}>
      {state === 'loading' && (
        <p role="status" className="text-xs text-center text-ink">
          {t('flow.gc.checking')}
        </p>
      )}
      {state === 'error' && <Banner kind="error">{msg || t('flow.gc.invalid')}</Banner>}
      {state === 'ready' && info && (
        <div className="space-y-4">
          <p className="text-xs text-ink leading-relaxed">
            <RichText text={t('flow.gc.intro', { name: info.firstName, org: info.organisation })} />
          </p>
          <p className="text-[11px] text-ink-muted">
            {t('flow.gc.agreeBefore', { name: info.firstName })}{' '}
            <Link href="/privacy" className="text-brand-fg hover:underline underline-offset-2">
              {t('flow.gc.privacyNotice')}
            </Link>
            {t('flow.gc.agreeAfter', {
              date: new Date(info.expiresAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }),
            })}
          </p>
          {msg && <Banner kind="error">{msg}</Banner>}
          <button type="button" onClick={confirm} disabled={busy} className={buttonClass}>
            {busy ? t('flow.gc.saving') : t('flow.gc.confirm')}
          </button>
        </div>
      )}
      {state === 'done' && <Banner kind="ok">{t('flow.gc.thanks', { name: info?.firstName ?? t('flow.gc.yourChild') })}</Banner>}
    </AuthCard>
  );
}

export default function GuardianConsentPage() {
  return (
    <Suspense fallback={null}>
      <GuardianConsent />
    </Suspense>
  );
}
