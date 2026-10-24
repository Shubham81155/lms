'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { AuthCard } from '@/components/AuthCard';
import { useT } from '@/lib/i18n';

type State =
  | { status: 'loading' }
  | { status: 'ready'; organisation: string; digestFrequency: string }
  | { status: 'done'; organisation: string }
  | { status: 'error'; message: string | null; kind: 'incomplete' | 'checkFailed' | 'failed' | 'api' };

function Unsubscribe() {
  const t = useT();
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<State>({ status: 'loading' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setState({ status: 'error', kind: 'incomplete', message: null });
      return;
    }
    api
      .get<{ data: { organisation: string; digestFrequency: string } }>('/api/v1/notifications/unsubscribe', { params: { token } })
      .then((r) => setState({ status: 'ready', ...r.data }))
      .catch((err) =>
        setState(
          err instanceof ApiError
            ? { status: 'error', kind: 'api', message: err.message }
            : { status: 'error', kind: 'checkFailed', message: null }
        )
      );
  }, [token]);

  // Asks first (a mail scanner opening the link must not unsubscribe anyone); the button is the one click.
  const turnOff = async () => {
    if (state.status !== 'ready') return;
    setBusy(true);
    try {
      await api.post(`/api/v1/notifications/unsubscribe?token=${encodeURIComponent(token)}`, {});
      setState({ status: 'done', organisation: state.organisation });
    } catch (err) {
      setState(
        err instanceof ApiError
          ? { status: 'error', kind: 'api', message: err.message }
          : { status: 'error', kind: 'failed', message: null }
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title={t('flow.unsub.title')}>
      {state.status === 'loading' && (
        <p className="text-xs text-center text-ink" role="status">
          {t('flow.unsub.checking')}
        </p>
      )}
      {state.status === 'error' && (
        <p className="text-xs text-center text-ink" role="alert">
          {state.kind === 'api' ? state.message : t(`flow.unsub.${state.kind}`)}
        </p>
      )}
      {state.status === 'ready' && (
        <div className="space-y-3 text-center text-xs text-ink">
          {state.digestFrequency === 'OFF' ? (
            <p role="status">{t('flow.unsub.alreadyOff', { org: state.organisation })}</p>
          ) : (
            <>
              <p>{t(state.digestFrequency === 'DAILY' ? 'flow.unsub.askDaily' : 'flow.unsub.askWeekly', { org: state.organisation })}</p>
              <button
                onClick={turnOff}
                disabled={busy}
                className="px-3 py-1.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-lg font-bold"
              >
                {busy ? t('flow.unsub.turningOff') : t('flow.unsub.turnOff')}
              </button>
              <p className="text-[11px] text-ink-subtle">{t('flow.unsub.hint')}</p>
            </>
          )}
        </div>
      )}
      {state.status === 'done' && (
        <p className="text-xs text-center text-ink" role="status">
          {t('flow.unsub.done', { org: state.organisation })}
        </p>
      )}
      <p className="text-center text-[11px]">
        <Link href="/login" className="text-brand-fg hover:underline underline-offset-2">
          {t('flow.unsub.continue')}
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
