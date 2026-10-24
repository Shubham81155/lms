'use client';

import React from 'react';
import Link from 'next/link';
import { GraduationCap } from 'lucide-react';
import { useBranding } from '@/context/BrandingContext';

interface BrandLogoProps {
  /** Where the logo links to; the signed-in shell points it at the person's own dashboard. */
  href?: string;
  /** Mark only, for a collapsed sidebar. */
  compact?: boolean;
  /** Hide the "Enterprise Education" line (it does not fit narrow headers). */
  showTagline?: boolean;
}

// Logo used on the public pages (landing and sign-in flow) and in the signed-in shell. With an organisation's
// own logo (Administration > Branding) it shows that logo and the organisation's name instead.
export function BrandLogo({ href = '/', compact = false, showTagline = true }: BrandLogoProps) {
  const branding = useBranding();
  const name = branding?.name;

  if (branding?.logoUrl) {
    return (
      <Link href={href} aria-label={`${name ?? 'Home'} home`} className="flex items-center gap-2.5 font-bold text-lg text-ink">
        <img src={branding.logoUrl} alt="" className="h-9 w-9 shrink-0 rounded-xl object-contain bg-surface" />
        {!compact && (
          <div className="flex flex-col min-w-0">
            <span className="leading-tight truncate">{name}</span>
            {showTagline && <span className="text-[10px] text-ink-subtle font-normal">Learning platform</span>}
          </div>
        )}
      </Link>
    );
  }

  return (
    <Link href={href} aria-label="ApexLMS home" className="flex items-center gap-2.5 font-bold text-lg text-ink">
      <div className="h-9 w-9 shrink-0 rounded-xl bg-gradient-to-br from-brand to-brand-hover flex items-center justify-center text-on-brand shadow-lg shadow-brand/30">
        <GraduationCap className="h-5 w-5" />
      </div>
      {!compact && (
        <div className="flex flex-col">
          <span className="leading-tight">
            Apex<span className="text-brand-fg">LMS</span>
          </span>
          {showTagline && <span className="text-[10px] text-ink-subtle font-normal">{name ?? 'Enterprise Education'}</span>}
        </div>
      )}
    </Link>
  );
}
