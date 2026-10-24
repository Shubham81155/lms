'use client';

import React, { useState } from 'react';
import { Mail, ScrollText } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { Banner } from '@/components/admin/IdentityPanels';
import { useT, type Translator } from '@/lib/i18n';

// The signed-in person's DPDP consents and under-18 status, backed by /api/v1/privacy/consents and /me/minor. Shared
// by the first-sign-in gate (ConsentGate) and the privacy settings panel.

export interface MyConsent {
  key: string;
  title: string;
  description: string;
  required: boolean;
  version: number;
  status: 'GRANTED' | 'WITHDRAWN' | 'NONE';
  answeredAt: string | null;
  outdated: boolean;
}

export interface MinorStatus {
  isMinor: boolean;
  guardianEmail: string | null;
  guardianConsentAt: string | null;
  pendingRequestExpiresAt: string | null;
}

/** A required purpose that still needs an answer (never answered, or agreed to an older wording). */
export const needsAnswer = (c: MyConsent) => c.required && (c.status === 'NONE' || c.outdated);

const input =
  'w-full bg-surface border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20';
const primary = 'px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold transition-all';
const secondary =
  'px-4 py-2 bg-surface hover:bg-raised border border-line disabled:opacity-50 text-ink rounded-xl text-xs font-bold transition-all';

const day = (t: Translator, iso: string) => t.date(iso, { day: 'numeric', month: 'short', year: 'numeric' });

export function useMyConsents() {
  return useApiData<{ data: MyConsent[] }>('/api/v1/privacy/consents');
}
export function useMinorStatus() {
  return useApiData<{ data: MinorStatus }>('/api/v1/privacy/me/minor');
}

/** Asks a parent or guardian, by e-mail, to confirm consent for a person under 18. */
export const GuardianForm: React.FC<{ minor: MinorStatus | null; onChanged: () => void | Promise<void>; idPrefix: string }> = ({
  minor,
  onChanged,
  idPrefix,
}) => {
  const t = useT();
  const send = useAction();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    send.run(async () => {
      setSent(false);
      await api.post('/api/v1/privacy/me/guardian-consent', { guardianEmail: email.trim() });
      setSent(true);
      await onChanged();
    });
  };

  if (minor?.guardianConsentAt) {
    return <Banner kind="ok">{t('privacy.guardian.consented', { date: day(t, minor.guardianConsentAt) })}</Banner>;
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-xs text-ink-muted leading-relaxed">{t('privacy.guardian.intro')}</p>
      {minor?.guardianEmail && minor.pendingRequestExpiresAt && (
        <Banner kind="ok">{t('privacy.guardian.sent', { email: minor.guardianEmail, date: day(t, minor.pendingRequestExpiresAt) })}</Banner>
      )}
      {send.error && <Banner kind="error">{send.error}</Banner>}
      {sent && !send.error && <Banner kind="ok">{t('privacy.guardian.onItsWay')}</Banner>}
      <label className="block space-y-1" htmlFor={`${idPrefix}-guardian`}>
        <span className="text-[11px] text-ink-muted">{t('privacy.guardian.emailLabel')}</span>
        <input
          id={`${idPrefix}-guardian`}
          className={input}
          type="email"
          required
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="parent@example.com"
        />
      </label>
      <button type="submit" disabled={send.busy || !email.trim()} className={primary}>
        <Mail className="inline h-3.5 w-3.5 mr-1.5 -mt-0.5" aria-hidden="true" />
        {send.busy ? t('privacy.guardian.sending') : minor?.guardianEmail ? t('privacy.guardian.sendNew') : t('privacy.guardian.ask')}
      </button>
    </form>
  );
};

/** Consent rows with Give / Withdraw. `onChanged` runs after every answer. */
export const ConsentList: React.FC<{
  consents: MyConsent[];
  onChanged: () => void | Promise<void>;
  /** Hide the withdraw button (the gate only asks for answers). */
  grantOnly?: boolean;
  /** A minor without guardian consent cannot grant. */
  blocked?: boolean;
}> = ({ consents, onChanged, grantOnly, blocked }) => {
  const t = useT();
  const act = useAction();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ title: string; text: string } | null>(null);

  const answer = (c: MyConsent, grant: boolean) =>
    act.run(async () => {
      setBusyKey(c.key);
      setNotice(null);
      try {
        const res = await api.post<{ data: { purpose: MyConsent; consequence: string | null } }>(
          `/api/v1/privacy/consents/${encodeURIComponent(c.key)}/${grant ? 'grant' : 'withdraw'}`
        );
        if (!grant && res.data.consequence) setNotice({ title: c.title, text: res.data.consequence });
        await onChanged();
      } finally {
        setBusyKey(null);
      }
    });

  return (
    <div className="space-y-3">
      {act.error && <Banner kind="error">{act.error}</Banner>}
      {notice && (
        <Banner kind="ok">
          <strong>{notice.title}: </strong>
          {notice.text}
        </Banner>
      )}
      <ul className="space-y-2">
        {consents.map((c) => {
          const granted = c.status === 'GRANTED' && !c.outdated;
          const busy = busyKey === c.key;
          return (
            <li key={c.key} className="p-3 rounded-xl bg-surface border border-line space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <p className="text-xs font-bold text-ink">
                    {c.title}{' '}
                    <span className="ml-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border border-line text-ink-muted">
                      {c.required ? t('privacy.consent.required') : t('privacy.consent.optional')}
                    </span>
                  </p>
                  <p className="text-[11px] text-ink-muted leading-relaxed">{c.description}</p>
                  <p className="text-[11px] text-ink-subtle">
                    {granted && (c.answeredAt ? t('privacy.consent.givenOn', { date: day(t, c.answeredAt) }) : t('privacy.consent.given'))}
                    {c.status === 'WITHDRAWN' &&
                      (c.answeredAt ? t('privacy.consent.withdrawnOn', { date: day(t, c.answeredAt) }) : t('privacy.consent.withdrawn'))}
                    {c.status === 'NONE' && t('privacy.consent.none')}
                    {c.status === 'GRANTED' && c.outdated && t('privacy.consent.outdated')}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {!granted && (
                    <button
                      type="button"
                      className={primary}
                      disabled={act.busy || blocked}
                      onClick={() => answer(c, true)}
                      aria-label={t('privacy.consent.giveAria', { title: c.title })}
                    >
                      {busy && act.busy ? t('privacy.consent.saving') : t('privacy.consent.give')}
                    </button>
                  )}
                  {c.status === 'GRANTED' && !grantOnly && (
                    <button
                      type="button"
                      className={secondary}
                      disabled={act.busy}
                      onClick={() => answer(c, false)}
                      aria-label={t('privacy.consent.withdrawAria', { title: c.title })}
                    >
                      {busy && act.busy ? t('privacy.consent.saving') : t('privacy.consent.withdraw')}
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

/** Sections for PrivacySettings: consents, the "I am under 18" switch and the guardian e-mail form. */
export const ConsentsAndMinor: React.FC = () => {
  const t = useT();
  const consents = useMyConsents();
  const minor = useMinorStatus();
  const setMinor = useAction();
  const m = minor.data?.data ?? null;
  const rows = consents.data?.data ?? [];

  const declareMinor = () =>
    setMinor.run(async () => {
      await api.put('/api/v1/privacy/me/minor', { isMinor: true });
      await minor.reload();
    });

  return (
    <>
      <section className="bg-canvas border border-line rounded-2xl p-5 space-y-3" aria-labelledby="consents-h">
        <div className="flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-brand-fg" aria-hidden="true" />
          <h4 id="consents-h" className="text-sm font-bold text-ink">
            {t('privacy.consents.title')}
          </h4>
        </div>
        <p className="text-xs text-ink-muted leading-relaxed">{t('privacy.consents.intro')}</p>
        {consents.error && <Banner kind="error">{consents.error}</Banner>}
        {consents.isLoading && !consents.data && <p className="text-xs text-ink-muted">{t('privacy.consents.loading')}</p>}
        {consents.data && rows.length === 0 && <p className="text-xs text-ink-muted">{t('privacy.consents.empty')}</p>}
        {rows.length > 0 && <ConsentList consents={rows} onChanged={consents.reload} blocked={!!m?.isMinor && !m.guardianConsentAt} />}
      </section>

      <section className="bg-canvas border border-line rounded-2xl p-5 space-y-3" aria-labelledby="minor-h">
        <h4 id="minor-h" className="text-sm font-bold text-ink">
          {t('privacy.minor.title')}
        </h4>
        {minor.error && <Banner kind="error">{minor.error}</Banner>}
        {setMinor.error && <Banner kind="error">{setMinor.error}</Banner>}
        <label className="flex items-center justify-between p-3 rounded-xl bg-surface border border-line cursor-pointer">
          <span className="text-xs text-ink">{t('privacy.minor.switch')}</span>
          <input
            type="checkbox"
            role="switch"
            checked={!!m?.isMinor}
            disabled={!m || m.isMinor || setMinor.busy}
            onChange={declareMinor}
            className="h-4 w-4 accent-success"
          />
        </label>
        <p className="text-[11px] text-ink-subtle">{m?.isMinor ? t('privacy.minor.locked') : t('privacy.minor.hint')}</p>
        {m?.isMinor && <GuardianForm minor={m} onChanged={minor.reload} idPrefix="settings" />}
      </section>
    </>
  );
};
