'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { AuthCard, buttonClass, inputClass } from '@/components/AuthCard';

interface Verified {
  valid: boolean;
  certificateNumber: string;
  issuedAt: string;
  expiresAt: string | null;
  issuedTo: string;
  course: { title: string; code: string };
  institution: string;
}

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

function Verify() {
  const params = useSearchParams();
  const [number, setNumber] = useState(params.get('number') ?? '');
  const [tenant, setTenant] = useState(params.get('tenant') ?? '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Verified | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      if (e instanceof ApiError && e.status === 429) setError('Too many checks in a short time. Please wait a minute and try again.');
      else if (e instanceof ApiError && e.status === 404)
        setError('No certificate matches that number and organisation. Check both and try again.');
      else setError('The certificate could not be checked right now. Please try again.');
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
    <AuthCard title="Verify a certificate" subtitle="Check that a certificate was issued by the institution and has not expired.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          check(number, tenant);
        }}
        className="space-y-4"
      >
        <input
          className={inputClass}
          aria-label="Certificate number"
          placeholder="Certificate number, e.g. CERT-2026-1A2B3C4D5E"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
        />
        <input
          className={inputClass}
          aria-label="Organisation"
          placeholder="Organisation (from the certificate link)"
          value={tenant}
          onChange={(e) => setTenant(e.target.value)}
        />
        <button type="submit" disabled={busy || !number.trim()} className={buttonClass}>
          {busy ? 'Checking…' : 'Verify'}
        </button>
      </form>

      {error && (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-xs font-semibold text-danger">
          {error}
        </p>
      )}

      {result && (
        <div
          role="status"
          className={`space-y-2 rounded-2xl border p-4 text-xs ${result.valid ? 'border-success/40 bg-success/10' : 'border-accent/40 bg-accent/10'}`}
        >
          <p className={`text-sm font-bold ${result.valid ? 'text-success' : 'text-accent'}`}>
            {result.valid ? 'This certificate is valid.' : 'This certificate has expired.'}
          </p>
          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-ink">
            <dt className="text-ink-muted">Issued to</dt>
            <dd className="font-semibold">{result.issuedTo}</dd>
            <dt className="text-ink-muted">Course</dt>
            <dd>
              {result.course.title} ({result.course.code})
            </dd>
            <dt className="text-ink-muted">Institution</dt>
            <dd>{result.institution}</dd>
            <dt className="text-ink-muted">Issued</dt>
            <dd>{day(result.issuedAt)}</dd>
            {result.expiresAt && (
              <>
                <dt className="text-ink-muted">{result.valid ? 'Expires' : 'Expired'}</dt>
                <dd>{day(result.expiresAt)}</dd>
              </>
            )}
            <dt className="text-ink-muted">Number</dt>
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
