'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { AuthCard } from '@/components/AuthCard';

type State =
  | { status: 'loading' }
  | { status: 'ready'; organisation: string; digestFrequency: string }
  | { status: 'done'; organisation: string }
  | { status: 'error'; message: string };

function Unsubscribe() {
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<State>({ status: 'loading' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setState({ status: 'error', message: 'This link is incomplete.' });
      return;
    }
    api
      .get<{ data: { organisation: string; digestFrequency: string } }>('/api/v1/notifications/unsubscribe', { params: { token } })
      .then((r) => setState({ status: 'ready', ...r.data }))
      .catch((err) => setState({ status: 'error', message: err instanceof ApiError ? err.message : 'This link could not be checked.' }));
  }, [token]);

  // Asks first (a mail scanner opening the link must not unsubscribe anyone); the button is the one click.
  const turnOff = async () => {
    if (state.status !== 'ready') return;
    setBusy(true);
    try {
      await api.post(`/api/v1/notifications/unsubscribe?token=${encodeURIComponent(token)}`, {});
      setState({ status: 'done', organisation: state.organisation });
    } catch (err) {
      setState({ status: 'error', message: err instanceof ApiError ? err.message : 'Could not turn the summary e-mails off.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Summary e-mails">
      {state.status === 'loading' && (
        <p className="text-xs text-center text-ink" role="status">
          Checking the link...
        </p>
      )}
      {state.status === 'error' && (
        <p className="text-xs text-center text-ink" role="alert">
          {state.message}
        </p>
      )}
      {state.status === 'ready' && (
        <div className="space-y-3 text-center text-xs text-ink">
          {state.digestFrequency === 'OFF' ? (
            <p role="status">Summary e-mails from {state.organisation} are already off for you.</p>
          ) : (
            <>
              <p>
                Stop the {state.digestFrequency === 'DAILY' ? 'daily' : 'weekly'} summary e-mails from {state.organisation}?
              </p>
              <button
                onClick={turnOff}
                disabled={busy}
                className="px-3 py-1.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-lg font-bold"
              >
                {busy ? 'Turning off...' : 'Turn off summary e-mails'}
              </button>
              <p className="text-[11px] text-ink-subtle">You can turn them back on any time under notification settings.</p>
            </>
          )}
        </div>
      )}
      {state.status === 'done' && (
        <p className="text-xs text-center text-ink" role="status">
          Done. You will not get summary e-mails from {state.organisation} any more.
        </p>
      )}
      <p className="text-center text-[11px]">
        <Link href="/login" className="text-brand-fg hover:underline underline-offset-2">
          Continue to sign in
        </Link>
      </p>
    </AuthCard>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense fallback={null}>
      <Unsubscribe />
    </Suspense>
  );
}
