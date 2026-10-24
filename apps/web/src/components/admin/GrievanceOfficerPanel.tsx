'use client';

import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { Banner } from '@/components/admin/IdentityPanels';
import { useT } from '@/lib/i18n';

const input =
  'w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand disabled:opacity-60';
const ghostBtn =
  'px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50';
const primaryBtn = 'px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold transition-all';

interface Officer {
  organisation: string;
  officer: { name: string; email: string; phone: string | null; address: string | null } | null;
  responseDays: number | null;
}

/**
 * The grievance officer shown on the public privacy notice (DPDP Act s.8(10)), with the number of days the
 * organisation commits to answer. Backed by /api/v1/privacy/grievance-officer. Clearing name and e-mail removes
 * the officer from the notice.
 */
export const GrievanceOfficerPanel: React.FC = () => {
  const t = useT();
  const cur = useApiData<{ data: Officer }>('/api/v1/privacy/grievance-officer');
  const { busy, error, run, clearError } = useAction();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [days, setDays] = useState('');
  const [done, setDone] = useState<'named' | 'none' | null>(null);

  useEffect(() => {
    const d = cur.data?.data;
    if (!d) return;
    setName(d.officer?.name ?? '');
    setEmail(d.officer?.email ?? '');
    setPhone(d.officer?.phone ?? '');
    setAddress(d.officer?.address ?? '');
    setDays(d.responseDays != null ? String(d.responseDays) : '');
  }, [cur.data]);

  const touch = (set: (v: string) => void) => (v: string) => {
    set(v);
    setDone(null);
    clearError();
  };

  const n = name.trim();
  const e = email.trim();
  const daysNum = days.trim() === '' ? null : Number(days);
  const daysOk = daysNum === null || (Number.isInteger(daysNum) && daysNum >= 1 && daysNum <= 90);
  const pairOk = (n === '') === (e === '');
  const emailOk = e === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const nameOk = n === '' || n.length >= 2;
  const valid = daysOk && pairOk && emailOk && nameOk;

  const save = (ev: React.FormEvent) => {
    ev.preventDefault();
    run(async () => {
      setDone(null);
      await api.put('/api/v1/privacy/grievance-officer', {
        name: n || null,
        email: e || null,
        phone: n ? phone.trim() || null : null,
        address: n ? address.trim() || null : null,
        responseDays: daysNum,
      });
      setDone(n ? 'named' : 'none');
      await cur.reload();
    });
  };

  return (
    <section className="space-y-5" aria-labelledby="grievance-h">
      <div>
        <h3 id="grievance-h" className="font-bold text-base text-ink">
          {t('comply.go.title')}
        </h3>
        <p className="text-xs text-ink-muted">{t('comply.go.intro')}</p>
      </div>

      {(cur.error || error) && <Banner kind="error">{cur.error || error}</Banner>}
      {done && <Banner kind="ok">{done === 'named' ? t('comply.go.savedNamed') : t('comply.go.savedNone')}</Banner>}

      <form onSubmit={save} className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="space-y-1 text-[11px] text-ink-muted">
            {t('comply.go.name')}
            <input className={input} value={name} maxLength={120} onChange={(ev) => touch(setName)(ev.target.value)} />
          </label>
          <label className="space-y-1 text-[11px] text-ink-muted">
            {t('comply.go.email')}
            <input className={input} type="email" value={email} maxLength={320} onChange={(ev) => touch(setEmail)(ev.target.value)} />
          </label>
          <label className="space-y-1 text-[11px] text-ink-muted">
            {t('comply.go.phone')}
            <input className={input} value={phone} maxLength={40} disabled={!n} onChange={(ev) => touch(setPhone)(ev.target.value)} />
          </label>
          <label className="space-y-1 text-[11px] text-ink-muted">
            {t('comply.go.days')}
            <input
              className={input}
              inputMode="numeric"
              value={days}
              maxLength={2}
              onChange={(ev) => touch(setDays)(ev.target.value.replace(/\D/g, ''))}
            />
          </label>
          <label className="space-y-1 text-[11px] text-ink-muted md:col-span-2">
            {t('comply.go.address')}
            <textarea
              className={input}
              rows={2}
              maxLength={500}
              value={address}
              disabled={!n}
              onChange={(ev) => touch(setAddress)(ev.target.value)}
            />
          </label>
        </div>
        {!pairOk && (
          <p className="text-[11px] text-accent" role="status">
            {t('comply.go.pair')}
          </p>
        )}
        {!emailOk && (
          <p className="text-[11px] text-accent" role="status">
            {t('comply.go.emailBad')}
          </p>
        )}
        {!daysOk && (
          <p className="text-[11px] text-accent" role="status">
            {t('comply.go.daysBad')}
          </p>
        )}
        <div className="flex gap-2">
          <button className={primaryBtn} disabled={busy || !valid}>
            {busy ? t('comply.go.saving') : t('comply.go.save')}
          </button>
          <button type="button" className={ghostBtn} disabled={busy} onClick={() => cur.reload()}>
            {t('comply.go.reset')}
          </button>
        </div>
      </form>
    </section>
  );
};
