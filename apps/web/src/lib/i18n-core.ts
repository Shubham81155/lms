import { en, type MessageKey } from "@/locales/en";
import { hi } from "@/locales/hi";

// The translation layer without React, so it can be tested without a DOM. lib/i18n.tsx wraps it in a provider.
// English is the source of truth: hi.ts is typed against it (a missing Hindi key is a type error), and at run
// time a missing or empty string falls back to English, then to the caller's default, then to the key.

export const LOCALES = ["en", "hi"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** Names of the languages in themselves, as the switcher shows them. */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", hi: "हिन्दी" };

export const LOCALE_COOKIE = "lms-locale";
export const LOCALE_STORAGE_KEY = "lms-locale";

export type { MessageKey };
export type Vars = Record<string, string | number>;

const CATALOGUES: Record<Locale, Partial<Record<string, string>>> = { en, hi };

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && (LOCALES as readonly string[]).includes(v);

/**
 * The best supported language of an Accept-Language header ("hi-IN,hi;q=0.9,en;q=0.8" -> "hi"); the highest
 * quality wins, ties go to the earlier entry. Null when none is supported.
 */
export function fromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const quality = q ? Number(q.slice(2)) : 1;
      return { lang: tag.trim().toLowerCase().split("-")[0], quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter((e) => e.quality > 0 && isLocale(e.lang))
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  return ranked.length ? (ranked[0].lang as Locale) : null;
}

/**
 * Which language to use: the person's own choice (cookie or stored setting) first, then the organisation's
 * default if it has one, then the browser's, then English.
 */
export function resolveLocale(opts: { chosen?: string | null; tenantDefault?: string | null; acceptLanguage?: string | null }): Locale {
  if (isLocale(opts.chosen)) return opts.chosen;
  if (isLocale(opts.tenantDefault)) return opts.tenantDefault;
  return fromAcceptLanguage(opts.acceptLanguage) ?? DEFAULT_LOCALE;
}

/** Replaces {name} with vars.name; a placeholder without a value is left as written so the gap is visible. */
export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/** The {placeholders} a message uses, sorted; the catalogue tests compare them across languages. */
export const placeholdersOf = (message: string): string[] => [...new Set([...message.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

/** The message in `locale`, or English, or `fallback`, or the key itself. Never throws. */
export function translate(locale: Locale, key: string, vars?: Vars, fallback?: string): string {
  const own = CATALOGUES[locale][key];
  const message = own ? own : CATALOGUES.en[key] ? CATALOGUES.en[key]! : (fallback ?? key);
  return interpolate(message, vars);
}

/**
 * Picks `<key>.one` / `<key>.other` (also `.zero`, `.two`, `.few`, `.many` where a language has them) by the
 * language's own plural rules, and fills {count}. Hindi treats 0 and 1 alike ("0 पाठ्यक्रम", "1 पाठ्यक्रम").
 */
export function translatePlural(locale: Locale, key: string, count: number, vars?: Vars): string {
  const category = new Intl.PluralRules(locale).select(count);
  const catalogue = CATALOGUES[locale];
  const chosen = [`${key}.${category}`, `${key}.other`].find((k) => catalogue[k] || CATALOGUES.en[k]) ?? key;
  return translate(locale, chosen, { count: formatNumber(locale, count), ...vars });
}

// ---------------------------------------------------------------------------------------------- formatting

const INTL_TAG: Record<Locale, string> = { en: "en-IN", hi: "hi-IN" };

/** Numbers with the language's grouping (Indian lakh/crore grouping in both). Latin digits in both languages. */
export const formatNumber = (locale: Locale, n: number, options?: Intl.NumberFormatOptions): string =>
  new Intl.NumberFormat(`${INTL_TAG[locale]}-u-nu-latn`, options).format(n);

/** A date with the language's month names; UTC unless a time zone is given, so server and browser agree. */
export function formatDate(locale: Locale, value: Date | string | number, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" }): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(`${INTL_TAG[locale]}-u-nu-latn`, { timeZone: "UTC", ...options }).format(date);
}

export const formatDateTime = (locale: Locale, value: Date | string | number, timeZone?: string): string =>
  formatDate(locale, value, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", ...(timeZone ? { timeZone } : {}) });

/** Reads the chosen language out of a Cookie header or document.cookie string. */
export function localeFromCookie(cookieHeader: string | null | undefined): Locale | null {
  const m = (cookieHeader ?? "").split(/;\s*/).find((c) => c.startsWith(`${LOCALE_COOKIE}=`));
  const v = m ? decodeURIComponent(m.slice(LOCALE_COOKIE.length + 1)) : null;
  return isLocale(v) ? v : null;
}
