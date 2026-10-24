'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { AuthCard, buttonClass, inputClass } from '@/components/AuthCard';
import { orgLoginUrl } from '@/lib/org-address';

const MIN_LENGTH = 10;

function ResetForm() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const invited = params.get('invite') === '1';
  const router = useRouter();
  // The API names the account's organisation and its web address, so sign-in afterwards happens there.
  const [org, setOrg] = useState<{ name: string; loginUrl: string } | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_LENGTH) {
      setError(`Password must be at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
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
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  // Straight on to sign-in at the organisation's own address (possibly another host), after a moment to read
  // the confirmation.
  const loginHref = org?.loginUrl ?? '/login';
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => (loginHref.startsWith('/') ? router.push(loginHref) : window.location.assign(loginHref)), 2500);
    return () => clearTimeout(t);
  }, [done, loginHref, router]);

  if (!token) {
    return (
      <AuthCard title="Invalid link">
        <p className="text-xs text-ink-muted text-center">
          This reset link is incomplete.{' '}
          <Link href="/forgot-password" className="text-brand-fg hover:underline underline-offset-2">
            Request a new one
          </Link>
          .
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={invited ? 'Welcome. Choose a password' : 'Choose a new password'}>
      {done ? (
        <p className="text-xs text-center text-success" role="status">
          {invited ? (org?.name ? `Your account for ${org.name} is ready.` : 'Your account is ready.') : 'Password updated.'}{' '}
          <a href={loginHref} className="text-brand-fg hover:underline underline-offset-2">
            Sign in
          </a>
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
          <input
            type="password"
            required
            autoComplete="new-password"
            aria-label="New password"
            placeholder="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
          <input
            type="password"
            required
            autoComplete="new-password"
            aria-label="Confirm new password"
            placeholder="Confirm new password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={inputClass}
          />
          <button type="submit" disabled={busy} className={buttonClass}>
            {busy ? 'Saving...' : invited ? 'Activate my account' : 'Update password'}
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
