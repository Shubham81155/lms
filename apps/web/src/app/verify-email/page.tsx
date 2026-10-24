'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { AuthCard } from '@/components/AuthCard';
import { useT } from '@/lib/i18n';

function VerifyEmail() {
  const t = useT();
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<{ status: 'working' | 'ok' | 'error'; message?: string; kind?: 'incomplete' | 'failed' }>({
    status: 'working',
  });

  useEffect(() => {
    if (!token) {
      setState({ status: 'error', kind: 'incomplete' });
      return;
    }
    api
      .post('/api/v1/auth/verify-email', { token })
      .then(() => setState({ status: 'ok' }))
      .catch((err) => setState(err instanceof ApiError ? { status: 'error', message: err.message } : { status: 'error', kind: 'failed' }));
  }, [token]);

  return (
    <AuthCard title={t('flow.verify.title')}>
      <p className="text-xs text-center text-ink">
        {state.status === 'working' && t('flow.verify.working')}
        {state.status === 'ok' && t('flow.verify.ok')}
        {state.status === 'error' && (state.kind ? t(`flow.verify.${state.kind}`) : state.message)}
      </p>
      <p className="text-center text-[11px]">
        <Link href="/login" className="text-brand-fg hover:underline underline-offset-2">
          {t('flow.verify.continue')}
        </Link>
      </p>
    </AuthCard>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmail />
    </Suspense>
  );
}
