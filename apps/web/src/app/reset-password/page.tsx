'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { AuthCard, buttonClass, inputClass } from '@/components/AuthCard';
import { orgLoginUrl } from '@/lib/org-address';
import { useT } from '@/lib/i18n';

const MIN_LENGTH = 10;

function ResetForm() {
  const t = useT();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const invited = params.get('invite') === '1';
  const router = useRouter();
  // The API names the account's organisation and its web address, so sign-in afterwards happens there.
  const [org, setOrg] = useState<{ name: string; loginUrl: string } | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<'short' | 'mismatch' | 'generic' | { text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_LENGTH) {
      setError('short');
      return;
    }
    if (password !== confirm) {
      setError('mismatch');
      return;
    }
    setBusy(true);
    try {
      const r = await api.post<{ message?: string; organization?: { slug: string; name: string; url?: string } }>(
        '/api/v1/auth/reset-password',
        { token, password }
      );
      if (r?.organization) setOrg({ name: r.organization.name, loginUrl: orgLoginUrl(r.organization.url) });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? { text: err.message } : 'generic');
    } finally {
      setBusy(false);
    }
  };

  // Straight on to sign-in at the organisation's own address (possibly another host), after a moment to read
  // the confirmation.
  const loginHref = org?.loginUrl ?? '/login';
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => (loginHref.startsWith('/') ? router.push(loginHref) : window.location.assign(loginHref)), 2500);
    return () => clearTimeout(timer);
  }, [done, loginHref, router]);

  if (!token) {
    return (
      <AuthCard title={t('flow.reset.invalidTitle')}>
        <p className="text-xs text-ink-muted text-center">
          {t('flow.reset.incomplete')}{' '}
          <Link href="/forgot-password" className="text-brand-fg underline underline-offset-2">
            {t('flow.reset.requestNew')}
          </Link>
          .
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={invited ? t('flow.reset.titleInvited') : t('flow.reset.title')}>
      {done ? (
        <p className="text-xs text-center text-success" role="status">
          {invited ? (org?.name ? t('flow.reset.readyOrg', { org: org.name }) : t('flow.reset.ready')) : t('flow.reset.updated')}{' '}
          <a href={loginHref} className="text-brand-fg underline underline-offset-2">
            {t('flow.reset.signIn')}
          </a>
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error === 'short'
                ? t('flow.reset.tooShort', { min: MIN_LENGTH })
                : error === 'mismatch'
                  ? t('flow.reset.mismatch')
                  : error === 'generic'
                    ? t('flow.reset.generic')
                    : error.text}
            </p>
          )}
          <input
            type="password"
            required
            autoComplete="new-password"
            aria-label={t('flow.reset.newPassword')}
            placeholder={t('flow.reset.newPassword')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
          <input
            type="password"
            required
            autoComplete="new-password"
            aria-label={t('flow.reset.confirmPassword')}
            placeholder={t('flow.reset.confirmPassword')}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={inputClass}
          />
          <button type="submit" disabled={busy} className={buttonClass}>
            {busy ? t('flow.reset.saving') : invited ? t('flow.reset.activate') : t('flow.reset.update')}
          </button>
        </form>
      )}
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetForm />
    </Suspense>
  );
}
