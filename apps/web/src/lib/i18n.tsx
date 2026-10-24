'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_COOKIE,
  LOCALE_NAMES,
  LOCALE_STORAGE_KEY,
  formatDate,
  formatDateTime,
  formatNumber,
  isLocale,
  translate,
  translatePlural,
  type Locale,
  type MessageKey,
  type Vars,
} from '@/lib/i18n-core';

// Language of the interface. The layout picks the first language on the server (cookie, else the browser's
// Accept-Language) and passes it in, so server and browser render the same text. A person's choice is kept in a
// cookie (the server reads it) and in localStorage; there is no account setting for it yet.

export interface Translator {
  /** A message known at compile time: a missing key is a type error. */
  (key: MessageKey, vars?: Vars): string;
  /** A message whose key is built at run time (e.g. one per navigation item); `fallback` is shown when it has none. */
  dyn: (key: string, fallback: string, vars?: Vars) => string;
  /** `<key>.one` / `<key>.other` by the language's plural rules; {count} is filled in. */
  plural: (key: string, count: number, vars?: Vars) => string;
  number: (n: number, options?: Intl.NumberFormatOptions) => string;
  date: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  dateTime: (value: Date | string | number, timeZone?: string) => string;
}

export function makeTranslator(locale: Locale): Translator {
  const t = ((key: MessageKey, vars?: Vars) => translate(locale, key, vars)) as Translator;
  t.dyn = (key, fallback, vars) => translate(locale, key, vars, fallback);
  t.plural = (key, count, vars) => translatePlural(locale, key, count, vars);
  t.number = (n, options) => formatNumber(locale, n, options);
  t.date = (value, options) => formatDate(locale, value, options);
  t.dateTime = (value, timeZone) => formatDateTime(locale, value, timeZone);
  return t;
}

interface Ctx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: Translator;
}

// Outside a provider (a test, a stray render) everything is simply English.
const fallbackCtx: Ctx = { locale: DEFAULT_LOCALE, setLocale: () => {}, t: makeTranslator(DEFAULT_LOCALE) };
const LocaleContext = createContext<Ctx>(fallbackCtx);

export function LocaleProvider({ initial, children }: { initial: Locale; children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initial);

  // A choice stored in the browser outranks the server's guess (e.g. a cleared cookie but a kept localStorage).
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
      if (isLocale(stored) && stored !== initial) setLocaleState(stored);
    } catch {
      /* storage blocked: the server's choice stands */
    }
  }, [initial]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      /* the cookie below still remembers it */
    }
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  }, []);

  const value = useMemo<Ctx>(() => ({ locale, setLocale, t: makeTranslator(locale) }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export const useLocale = () => useContext(LocaleContext);
export const useT = (): Translator => useContext(LocaleContext).t;

/** Compact language picker for headers. Each language is named in itself so it can always be found. */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale, t } = useLocale();
  return (
    <label className={className}>
      <span className="sr-only">{t('language.label')}</span>
      <select
        value={locale}
        onChange={(e) => isLocale(e.target.value) && setLocale(e.target.value)}
        className="rounded-xl border border-line bg-surface px-2.5 py-2 text-xs font-semibold text-ink-muted outline-none transition-colors hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-brand"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Renders **bold** parts of a message; everything else is plain text (no HTML is ever interpreted). */
export function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split('**').map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : <React.Fragment key={i}>{part}</React.Fragment>))}
    </>
  );
}
