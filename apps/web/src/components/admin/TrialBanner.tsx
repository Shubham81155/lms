'use client';

import React from 'react';
import { Clock, Lock } from 'lucide-react';
import { useApiData } from '@/hooks/useApiData';
import { useT, type Translator } from '@/lib/i18n';

export interface TrialStatus {
  /** NONE: no trial (a paid organisation); TRIAL: running; READ_ONLY: ended, read-only until `readOnlyUntil`, then suspended. */
  state: 'NONE' | 'TRIAL' | 'READ_ONLY';
  trialEndsAt: string | null;
  /** Whole days left of a running trial. */
  daysLeft: number | null;
  readOnlyUntil: string | null;
  /** The read-only period follows a lapsed subscription, not an ended trial. */
  paymentLapsed?: boolean;
}

const BillingLink: React.FC<{ onClick: () => void }> = ({ onClick }) => {
  const t = useT();
  return (
    <button type="button" className="font-semibold text-brand-fg underline" onClick={onClick}>
      {t('trial.choosePlan')}
    </button>
  );
};

/** trialEndsText in the reader's language. */
function whenText(t: Translator, daysLeft: number | null, trialEndsAt: string | null): string {
  if (daysLeft === null) return trialEndsAt ? t('trial.when.on', { date: t.date(trialEndsAt) }) : t('trial.when.soon');
  if (daysLeft <= 0) return t('trial.when.today');
  if (daysLeft === 1) return t('trial.when.tomorrow');
  return t.plural('trial.when.inDays', daysLeft);
}

/** The administrator's notice of the organisation's trial: how long it has left, or that it has ended and the organisation is read-only. */
export const TrialBanner: React.FC<{ onOpenBilling?: () => void }> = ({ onOpenBilling }) => {
  const trial = useApiData<{ data: TrialStatus }>('/api/v1/trial');
  const tr = useT();
  const t = trial.data?.data;
  if (!t || t.state === 'NONE') return null;

  if (t.state === 'READ_ONLY') {
    return (
      <div role="alert" className="flex items-start gap-3 rounded-2xl border border-danger/40 bg-danger/5 p-4 text-sm text-ink">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
        <p>
          <span className="font-semibold">{t.paymentLapsed ? tr('trial.lapsed') : tr('trial.ended')}</span> — {tr('trial.readOnly')}
          {t.readOnlyUntil ? ` ${tr('trial.readOnlyUntil', { date: tr.date(t.readOnlyUntil) })}` : ''}.{' '}
          {onOpenBilling ? <BillingLink onClick={onOpenBilling} /> : tr('trial.contactUs')}
        </p>
      </div>
    );
  }

  const urgent = t.daysLeft !== null && t.daysLeft <= 7;
  return (
    <div
      role="status"
      className={`flex items-start gap-3 rounded-2xl border p-4 text-sm text-ink ${urgent ? 'border-accent/50 bg-accent/10' : 'border-line bg-surface'}`}
    >
      <Clock className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
      <p>
        <span className="font-semibold">{tr('trial.endsIn', { when: whenText(tr, t.daysLeft, t.trialEndsAt) })}</span>
        {t.trialEndsAt ? ` (${tr.date(t.trialEndsAt)})` : ''}. {tr('trial.afterwards')}{' '}
        {onOpenBilling ? <BillingLink onClick={onOpenBilling} /> : tr('trial.contactUs')}
      </p>
    </div>
  );
};
