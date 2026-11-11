'use client';

import React from 'react';
import Link from 'next/link';
import { MailCheck } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { displayAddress } from '@/lib/org-address';
import { buttonClasses, cardClasses } from '@/components/ui';
import { SLOT, withSlot } from './shared';

export const SubmittedView: React.FC<{
  sentTo: string;
  confirmBy: string | null;
  requestedUrl: string | null;
}> = ({ sentTo, confirmBy, requestedUrl }) => {
  const t = useT();
  return (
    <section className={cardClasses({ variant: 'elevated', padding: 'lg', className: 'space-y-5' })} aria-labelledby="done-h">
      <div className="mx-auto h-12 w-12 rounded-2xl bg-brand/10 border border-brand/30 text-brand-fg flex items-center justify-center">
        <MailCheck className="h-6 w-6" aria-hidden="true" />
      </div>
      <div className="text-center space-y-2">
        <h1 id="done-h" className="text-2xl font-extrabold text-ink">
          {t('site.reg.sent.title')}
        </h1>
        <p className="text-xs text-ink-muted">
          {withSlot(
            confirmBy
              ? t('site.reg.sent.bodyBy', {
                  email: SLOT,
                  when: t.date(confirmBy, { dateStyle: 'medium', timeStyle: 'short' }),
                })
              : t('site.reg.sent.bodyWithin', { email: SLOT }),
            <span className="font-semibold text-ink">{sentTo}</span>
          )}
        </p>
        {requestedUrl && (
          <p className="text-xs text-ink-muted">
            {withSlot(
              t('site.reg.sent.requested', { address: SLOT }),
              <span className="font-mono font-semibold text-ink">{displayAddress(requestedUrl)}</span>
            )}
          </p>
        )}
      </div>
      <p className="text-[11px] text-ink-subtle text-center">{t('site.reg.sent.noEmail')}</p>
      <div className="flex justify-center">
        <Link href="/" className={buttonClasses({ size: 'lg' })}>
          {t('common.backToHome')}
        </Link>
      </div>
    </section>
  );
};
