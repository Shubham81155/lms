'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { displayAddress } from '@/lib/org-address';
import { Button, buttonClasses, cardClasses } from '@/components/ui';
import { msgText, SLOT, withSlot, type Msg } from './shared';

type Confirmation =
  | { state: 'working' }
  | { state: 'done'; status: 'PENDING' | 'APPROVED' | 'REJECTED'; organizationName: string; contactEmail: string; url: string }
  | { state: 'error'; message: Msg };

const Steps: React.FC<{ email: string; url: string | null }> = ({ email, url }) => {
  const t = useT();
  return (
    <ol className="space-y-3 text-xs text-ink-muted">
      <li className="flex gap-3">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/15 text-[11px] font-bold text-brand-fg">
          1
        </span>
        {t('site.reg.step1')}
      </li>
      <li className="flex gap-3">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/15 text-[11px] font-bold text-brand-fg">
          2
        </span>
        {t('site.reg.step2', { email })}
      </li>
      <li className="flex gap-3">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/15 text-[11px] font-bold text-brand-fg">
          3
        </span>
        {withSlot(
          t('site.reg.step3', { address: SLOT }),
          url ? <span className="font-mono text-ink">{displayAddress(url)}</span> : t('site.reg.step3.fallback')
        )}
      </li>
    </ol>
  );
};

const cardCls = cardClasses({ variant: 'elevated', padding: 'lg', className: 'space-y-5' });

/** What the confirmation link opens: confirms the request and says what happens next. */
export const ConfirmEmailView: React.FC<{ token: string; onRestart: () => void }> = ({ token, onRestart }) => {
  const t = useT();
  const [result, setResult] = useState<Confirmation>({ state: 'working' });
  useEffect(() => {
    let alive = true;
    api
      .post<{ data: { status: 'PENDING' | 'APPROVED' | 'REJECTED'; organizationName: string; contactEmail: string; url: string } }>(
        '/api/v1/organizations/requests/confirm',
        { token }
      )
      .then((r) => alive && setResult({ state: 'done', ...r.data }))
      .catch((err) => {
        if (!alive) return;
        if (err instanceof ApiError && err.status === 429) setResult({ state: 'error', message: { key: 'site.reg.confirm.tooMany' } });
        else
          setResult({
            state: 'error',
            message: err instanceof ApiError ? { text: err.message } : { key: 'site.reg.confirm.wrong' },
          });
      });
    return () => {
      alive = false;
    };
  }, [token]);

  if (result.state === 'working') {
    return (
      <section className={cardCls} aria-busy="true">
        <p className="flex items-center justify-center gap-2 text-xs text-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {t('site.reg.confirm.working')}
        </p>
      </section>
    );
  }
  if (result.state === 'error') {
    return (
      <section className={cardCls} aria-labelledby="confirm-h">
        <div className="mx-auto h-12 w-12 rounded-2xl bg-danger/10 border border-danger/30 text-danger flex items-center justify-center">
          <XCircle className="h-6 w-6" aria-hidden="true" />
        </div>
        <div className="text-center space-y-2">
          <h1 id="confirm-h" className="text-2xl font-extrabold text-ink">
            {t('site.reg.confirm.failedTitle')}
          </h1>
          <p role="alert" className="text-xs text-ink-muted">
            {msgText(t, result.message)}
          </p>
        </div>
        <div className="flex justify-center">
          <Button type="button" size="lg" onClick={onRestart}>
            {t('site.reg.confirm.restart')}
          </Button>
        </div>
      </section>
    );
  }
  return (
    <section className={cardCls} aria-labelledby="confirm-h">
      <div className="mx-auto h-12 w-12 rounded-2xl bg-success/10 border border-success/30 text-success flex items-center justify-center">
        <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
      </div>
      <div className="text-center space-y-2">
        <h1 id="confirm-h" className="text-2xl font-extrabold text-ink">
          {result.status === 'PENDING' ? t('site.reg.confirm.titlePending') : t('site.reg.confirm.titleDecided')}
        </h1>
        <p className="text-xs text-ink-muted">
          {result.status === 'PENDING'
            ? withSlot(
                t('site.reg.confirm.pending', { name: SLOT }),
                <span className="font-semibold text-ink">{result.organizationName}</span>
              )
            : result.status === 'APPROVED'
              ? t('site.reg.confirm.approved', { name: result.organizationName, email: result.contactEmail })
              : t('site.reg.confirm.rejected', { email: result.contactEmail })}
        </p>
        <p className="text-xs text-ink-muted">
          {withSlot(
            t('site.reg.sent.requested', { address: SLOT }),
            <span className="font-mono font-semibold text-ink">{displayAddress(result.url)}</span>
          )}
        </p>
      </div>
      {result.status === 'PENDING' && <Steps email={result.contactEmail} url={result.url} />}
      {result.status === 'PENDING' && <p className="text-[11px] text-ink-subtle text-center">{t('site.reg.confirm.declined')}</p>}
      <div className="flex justify-center">
        <Link href="/" className={buttonClasses({ size: 'lg' })}>
          {t('common.backToHome')}
        </Link>
      </div>
    </section>
  );
};
