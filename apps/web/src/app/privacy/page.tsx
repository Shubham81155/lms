'use client';

import React from 'react';
import Link from 'next/link';
import { useApiData } from '@/hooks/useApiData';
import { BrandLogo } from '@/components/BrandLogo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LanguageSwitcher, RichText, useT } from '@/lib/i18n';
import { Banner } from '@/components/admin/IdentityPanels';

interface Notice {
  organisation: string;
  officer: { name: string; email: string; phone: string | null; address: string | null } | null;
  responseDays: number | null;
}

const h2 = 'text-base font-bold text-ink';
const p = 'text-xs text-ink-muted leading-relaxed';

/** Public privacy notice of the organisation the address names, with its grievance officer (DPDP Act). */
export default function PrivacyNoticePage() {
  const t = useT();
  const { data, isLoading, error } = useApiData<{ data: Notice }>('/api/v1/privacy/grievance-officer');
  const n = data?.data;

  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col">
      <header className="border-b border-line bg-canvas/80 backdrop-blur-md px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <BrandLogo />
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main id="main-content" className="flex-1 p-6">
        <div className="mx-auto w-full max-w-2xl bg-surface border border-line rounded-3xl p-8 space-y-6">
          <div className="space-y-1.5">
            <h1 className="text-2xl font-extrabold text-ink">{t('privacy.page.title')}</h1>
            {n && <p className="text-xs text-ink-muted">{n.organisation}</p>}
          </div>

          <section className="space-y-2" aria-labelledby="your-data-h">
            <h2 id="your-data-h" className={h2}>
              {t('privacy.page.dataTitle')}
            </h2>
            <p className={p}>{t('privacy.page.dataBody', { org: n?.organisation ?? t('privacy.page.yourOrg') })}</p>
          </section>

          <section className="space-y-2" aria-labelledby="rights-h">
            <h2 id="rights-h" className={h2}>
              {t('privacy.page.rightsTitle')}
            </h2>
            <ul className="list-disc pl-5 space-y-1 text-xs text-ink-muted leading-relaxed">
              <li>{t('privacy.page.right1')}</li>
              <li>{t('privacy.page.right2')}</li>
              <li>{t('privacy.page.right3')}</li>
              <li>{t('privacy.page.right4')}</li>
            </ul>
            <p className={p}>
              <RichText text={t('privacy.page.manage', { section: t('privacy.title') })} />
            </p>
          </section>

          <section className="space-y-2" aria-labelledby="grievance-h">
            <h2 id="grievance-h" className={h2}>
              {t('privacy.page.grievanceTitle')}
            </h2>
            {isLoading && <p className={p}>{t('privacy.page.loading')}</p>}
            {error && <Banner kind="error">{error}</Banner>}
            {n && !n.officer && <p className={p}>{t('privacy.page.noOfficer')}</p>}
            {n?.officer && (
              <address className="not-italic text-xs text-ink space-y-0.5">
                <p className="font-semibold">{n.officer.name}</p>
                <p>
                  <a href={`mailto:${n.officer.email}`} className="text-brand-fg hover:underline underline-offset-2">
                    {n.officer.email}
                  </a>
                </p>
                {n.officer.phone && <p>{n.officer.phone}</p>}
                {n.officer.address && <p className="whitespace-pre-line">{n.officer.address}</p>}
              </address>
            )}
            {n?.responseDays != null && <p className={p}>{t.plural('privacy.page.responseDays', n.responseDays)}</p>}
          </section>

          <p className="text-[11px]">
            <Link href="/login" className="text-brand-fg hover:underline underline-offset-2">
              {t('privacy.page.backToSignIn')}
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
