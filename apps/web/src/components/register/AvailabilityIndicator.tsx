'use client';

import React from 'react';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { displayAddress } from '@/lib/org-address';
import { REASON_TEXT, SLOT, withSlot, type Availability } from './shared';

export const AvailabilityIndicator: React.FC<{ availability: Availability; futureUrl: string | null }> = ({ availability, futureUrl }) => {
  const t = useT();
  switch (availability.state) {
    case 'checking':
      return (
        <span className="inline-flex items-center gap-1 text-ink-subtle">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> {t('site.reg.slug.checking')}
        </span>
      );
    case 'available':
      return (
        <span className="inline-flex flex-wrap items-center gap-1 text-success">
          <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> {t('site.reg.slug.available')}
          {futureUrl && (
            <span className="text-ink-muted">
              {withSlot(
                t('site.reg.slug.willBe', { address: SLOT }),
                <span className="font-mono font-semibold text-ink">{displayAddress(futureUrl)}</span>
              )}
            </span>
          )}
        </span>
      );
    case 'unavailable':
      return (
        <span className="inline-flex items-center gap-1 text-danger">
          <XCircle className="h-3 w-3" aria-hidden="true" /> {t(REASON_TEXT[availability.reason])}
        </span>
      );
    case 'error':
      return <span className="text-ink-subtle">{t('site.reg.slug.error')}</span>;
    default:
      return <span>{t('site.reg.slug.help')}</span>;
  }
};
