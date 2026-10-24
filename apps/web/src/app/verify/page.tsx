'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { AuthCard, buttonClass, inputClass } from '@/components/AuthCard';
import { useT } from '@/lib/i18n';

interface Verified {
  valid: boolean;
  certificateNumber: string;
  issuedAt: string;
  expiresAt: string | null;
  issuedTo: string;
  course: { title: string; code: string };
  institution: string;
}

// The viewer's own time zone (as before), in the chosen language.
const DAY: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric', timeZone: undefined };

function Verify() {
  const t = useT();
  const day = (iso: string) => t.date(iso, DAY);
  const params = useSearchParams();
  const [number, setNumber] = useState(params.get('number') ?? '');
  const [tenant, setTenant] = useState(params.get('tenant') ?? '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Verified | null>(null);
  const [error, setError] = useState<'tooMany' | 'notFound' | 'failed' | null>(null);

  const check = useCallback(async (n: string, t: string) => {
    if (!n.trim()) return;
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      const r = await api.get<Verified>(`/api/v1/certificates/verify/${encodeURIComponent(n.trim())}`, {
        params: t.trim() ? { tenant: t.trim() } : undefined,
      });
      setResult(r);
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) setError('tooMany');
      else if (e instanceof ApiError && e.status === 404) setError('notFound');
      else setError('failed');
    } finally {
      setBusy(false);
    }
  }, []);

  // A link from a certificate carries both values, so check straight away.
  useEffect(() => {
    const n = params.get('number');
    if (n) check(n, params.get('tenant') ?? '');
  }, [params, check]);

  return (
    <AuthCard title={t('work.verify.title')} subtitle={t('work.verify.subtitle')}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          check(number, tenant);
        }}
        className="space-y-4"
      >
        <input
          className={inputClass}
          aria-label={t('work.cert.number')}
          placeholder={t('work.verify.numberPlaceholder')}
          value={number}
          onChange={(e) => setNumber(e.target.value)}
        />
        <input
          className={inputClass}
          aria-label={t('work.verify.orgLabel')}
          placeholder={t('work.verify.orgPlaceholder')}
          value={tenant}
          onChange={(e) => setTenant(e.target.value)}
        />
        <button type="submit" disabled={busy || !number.trim()} className={buttonClass}>
          {busy ? t('work.verify.checking') : t('work.verify.verify')}
        </button>
      </form>

      {error && (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-xs font-semibold text-danger">
          {t(error === 'tooMany' ? 'work.verify.tooMany' : error === 'notFound' ? 'work.verify.notFound' : 'work.verify.failed')}
        </p>
      )}

      {result && (
        <div
          role="status"
          className={`space-y-2 rounded-2xl border p-4 text-xs ${result.valid ? 'border-success/40 bg-success/10' : 'border-accent/40 bg-accent/10'}`}
        >
          <p className={`text-sm font-bold ${result.valid ? 'text-success' : 'text-accent'}`}>
            {result.valid ? t('work.verify.valid') : t('work.verify.expiredMsg')}
          </p>
          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-ink">
            <dt className="text-ink-muted">{t('work.verify.issuedTo')}</dt>
            <dd className="font-semibold">{result.issuedTo}</dd>
            <dt className="text-ink-muted">{t('work.verify.course')}</dt>
            <dd>
              {result.course.title} ({result.course.code})
            </dd>
            <dt className="text-ink-muted">{t('work.verify.institution')}</dt>
            <dd>{result.institution}</dd>
            <dt className="text-ink-muted">{t('work.cert.issued')}</dt>
            <dd>{day(result.issuedAt)}</dd>
            {result.expiresAt && (
              <>
                <dt className="text-ink-muted">{result.valid ? t('work.verify.expires') : t('work.verify.expiredLabel')}</dt>
                <dd>{day(result.expiresAt)}</dd>
              </>
            )}
            <dt className="text-ink-muted">{t('work.verify.numberShort')}</dt>
            <dd className="font-mono">{result.certificateNumber}</dd>
          </dl>
        </div>
      )}
    </AuthCard>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={null}>
      <Verify />
    </Suspense>
  );
}
