'use client';

import React from 'react';
import type { MessageKey } from '@/lib/i18n-core';
import { useT, type Translator } from '@/lib/i18n';
import { platformMessageKey } from '@/lib/platform';

export const TYPES = [
  { value: 'UNIVERSITY', label: 'site.reg.type.UNIVERSITY' },
  { value: 'COLLEGE', label: 'site.reg.type.COLLEGE' },
  { value: 'SCHOOL', label: 'site.reg.type.SCHOOL' },
  { value: 'TRAINING_PROVIDER', label: 'site.reg.type.TRAINING_PROVIDER' },
  { value: 'COMPANY', label: 'site.reg.type.COMPANY' },
  { value: 'OTHER', label: 'site.reg.type.OTHER' },
] as const satisfies readonly { value: string; label: MessageKey }[];

/** A message shown to the person: a catalogue key (translated when drawn) or text the API sent. */
export type Msg = { key: MessageKey } | { text: string };
export const msgText = (t: Translator, m: Msg) => ('key' in m ? t(m.key) : m.text);

// The shared validators in lib/platform.ts return English; platformMessageKey maps them to their keys.
export const problemMsg = (text: string): Msg => {
  const key = platformMessageKey(text);
  return key ? { key } : { text };
};

/** Puts an element where a message has its {slot} (messages cannot hold elements). */
export const SLOT = '@@slot@@';
export const withSlot = (text: string, node: React.ReactNode) => {
  const [before, after = ''] = text.split(SLOT);
  return (
    <>
      {before}
      {node}
      {after}
    </>
  );
};

export type Availability =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; url?: string }
  | { state: 'unavailable'; reason: 'invalid' | 'reserved' | 'taken' | 'pending' }
  | { state: 'error' };

/** The widget action the API expects for this form (ORG_REQUEST_CAPTCHA_ACTION). */
export const CAPTCHA_ACTION = 'org-request';

export const REASON_TEXT: Record<'invalid' | 'reserved' | 'taken' | 'pending', MessageKey> = {
  invalid: 'site.reg.slug.reason.invalid',
  reserved: 'site.reg.slug.reason.reserved',
  taken: 'site.reg.slug.reason.taken',
  pending: 'site.reg.slug.reason.pending',
};

export const Field: React.FC<{
  id: string;
  text: string;
  optional?: boolean;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}> = ({ id, text, optional, hint, className, children }) => {
  const t = useT();
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <label htmlFor={id} className="block text-xs font-semibold text-ink">
        {text} {optional && <span className="font-normal text-ink-subtle">{t('site.reg.optional')}</span>}
      </label>
      {children}
      {hint && (
        <div id={`${id}-hint`} className="text-[11px] text-ink-subtle">
          {hint}
        </div>
      )}
    </div>
  );
};
