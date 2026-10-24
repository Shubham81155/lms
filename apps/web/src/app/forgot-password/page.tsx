'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { AuthCard, buttonClass, inputClass } from '@/components/AuthCard';
import { useT } from '@/lib/i18n';

export default function ForgotPasswordPage() {
  const t = useT();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<{ text: string } | 'generic' | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ message: string }>('/api/v1/auth/forgot-password', { email });
      setMessage(res.message);
    } catch (err) {
      setError(err instanceof ApiError ? { text: err.message } : 'generic');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title={t('flow.forgot.title')} subtitle={t('flow.forgot.subtitle')}>
      {message ? (
        <p className="text-xs text-success bg-success/10 border border-success/25 rounded-2xl p-3.5">{message}</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error === 'generic' ? t('flow.forgot.generic') : error.text}
            </p>
          )}
          <input
            type="email"
            aria-label={t('flow.forgot.email')}
            required
            autoComplete="email"
            placeholder="name@university.edu"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
          <button type="submit" disabled={busy} className={buttonClass}>
            {busy ? t('flow.forgot.sending') : t('flow.forgot.send')}
          </button>
        </form>
      )}
      <p className="text-center text-[11px]">
        <Link href="/login" className="text-brand-fg hover:underline underline-offset-2">
          {t('flow.forgot.back')}
        </Link>
      </p>
    </AuthCard>
  );
}
