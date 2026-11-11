'use client';

import React, { useState } from 'react';
import { Copy } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { useT } from '@/lib/i18n';

export const LOCAL_DATE: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: undefined,
};

export const splitDomains = (text: string) => text.split(/[\s,]+/).filter(Boolean);

/** A secret that is shown exactly once, with a copy button. */
export const OnceSecret: React.FC<{ label: string; value: string; onDismiss: () => void }> = ({ label, value, onDismiss }) => {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <Card className="border-accent/60 bg-accent/10 space-y-2">
      <div className="text-xs font-bold text-accent">{label}</div>
      <p className="text-[11px] text-accent/80">{t('ident.secret.once')}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 bg-canvas border border-line rounded-lg px-3 py-2 text-[11px] text-accent break-all select-all">
          {value}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
            } catch {
              /* clipboard may be unavailable; the value is selectable */
            }
          }}
        >
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          {copied ? t('ident.secret.copied') : t('ident.secret.copy')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
          {t('ident.secret.done')}
        </Button>
      </div>
    </Card>
  );
};

/** Shared by both protocols: create learner accounts at first sign-in, only once domains are listed. */
export const AutoCreateToggle: React.FC<{
  checked: boolean;
  onChange: (v: boolean) => void;
  domains: string;
  available: boolean;
}> = ({ checked, onChange, domains, available }) => {
  const t = useT();
  const list = splitDomains(domains);
  const usable = list.length > 0;
  return (
    <div className="md:col-span-2 space-y-1">
      <label className="flex items-center gap-2 text-xs text-ink">
        <input
          type="checkbox"
          checked={checked && usable}
          onChange={(e) => onChange(e.target.checked)}
          disabled={!available || !usable}
          className="rounded border-line bg-canvas text-brand-fg"
        />
        {t('ident.auto.label')}
      </label>
      <p className="pl-6 text-[11px] text-ink-subtle">
        {usable ? t('ident.auto.usable', { domains: list.join(` ${t('common.or')} `) }) : t('ident.auto.needDomains')}
      </p>
    </div>
  );
};
