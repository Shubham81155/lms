'use client';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { AuthCard } from '@/components/AuthCard';
import { useT } from '@/lib/i18n';

// Where the platform operator's "Enter" lands, at the organisation's own address: the one-time token is exchanged
// for a support session here (so the session cookie belongs to this address), then the admin area opens.

function EnterSupport() {
  const t = useT();
  const token = useSearchParams().get('token') ?? '';
  const [error, setError] = useState<'incomplete' | 'failed' | { text: string } | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // The token works once: never send it twice (React may run effects twice in development).
    if (started.current) return;
    started.current = true;
    if (!token) {
      setError('incomplete');
      return;
    }
    // Keep the token out of the history and of anything that reads the address later.
    window.history.replaceState(null, '', '/support/enter');
    api
      .post('/api/v1/support/enter', { token })
      // A full load, so the whole app starts again as the support session.
      .then(() => window.location.replace('/admin'))
      .catch((err) => setError(err instanceof ApiError ? { text: err.message } : 'failed'));
  }, [token]);

  return (
    <AuthCard title={t('flow.enter.title')}>
      <p className="text-xs text-center text-ink" role={error ? 'alert' : 'status'}>
        {error ? (typeof error === 'string' ? t(`flow.enter.${error}`) : error.text) : t('flow.enter.opening')}
      </p>
    </AuthCard>
  );
}

export default function SupportEnterPage() {
  return (
    <Suspense fallback={null}>
      <EnterSupport />
    </Suspense>
  );
}
