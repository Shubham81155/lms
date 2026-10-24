import { describe, expect, it } from 'vitest';
import { en } from '@/locales/en';
import { hi } from '@/locales/hi';
import {
  fromAcceptLanguage,
  formatDate,
  formatNumber,
  interpolate,
  localeFromCookie,
  placeholdersOf,
  resolveLocale,
  translate,
  translatePlural,
} from '@/lib/i18n-core';
import { NAVIGATION, AREA_LABEL } from '@/lib/navigation';

const enMessages = en as Record<string, string>;
const hiMessages = hi as Record<string, string>;
const keys = Object.keys(enMessages);

describe('catalogues', () => {
  it('Hindi has exactly the English keys', () => {
    expect(Object.keys(hiMessages).sort()).toEqual([...keys].sort());
  });

  it('no message is empty', () => {
    for (const [k, v] of [...Object.entries(enMessages), ...Object.entries(hiMessages)]) expect(v.trim(), k).not.toBe('');
  });

  it('every translation keeps the placeholders of the English message, no more and no fewer', () => {
    for (const k of keys) expect(placeholdersOf(hiMessages[k]), k).toEqual(placeholdersOf(enMessages[k]));
  });

  it('bold markers stay paired in both languages', () => {
    for (const k of keys) {
      expect((enMessages[k].match(/\*\*/g) ?? []).length % 2, `en ${k}`).toBe(0);
      expect((hiMessages[k].match(/\*\*/g) ?? []).length % 2, `hi ${k}`).toBe(0);
      expect((hiMessages[k].match(/\*\*/g) ?? []).length, k).toBe((enMessages[k].match(/\*\*/g) ?? []).length);
    }
  });

  it('plural keys come in .one/.other pairs', () => {
    for (const k of keys.filter((x) => x.endsWith('.one'))) expect(enMessages[k.replace(/\.one$/, '.other')], k).toBeTruthy();
    for (const k of keys.filter((x) => x.endsWith('.other'))) expect(enMessages[k.replace(/\.other$/, '.one')], k).toBeTruthy();
  });

  it('Hindi messages are written in Devanagari (not left in English)', () => {
    for (const k of keys) expect(hiMessages[k], k).toMatch(/[ऀ-ॿ]/);
  });

  it('every navigation area, section and item has a message in both languages', () => {
    for (const area of Object.keys(NAVIGATION) as (keyof typeof NAVIGATION)[]) {
      expect(enMessages[`nav.area.${area}`], area).toBe(AREA_LABEL[area]);
      expect(hiMessages[`nav.area.${area}`], area).toBeTruthy();
      for (const s of NAVIGATION[area]) {
        expect(enMessages[`nav.section.${area}.${s.id}`], `${area}/${s.id}`).toBe(s.title);
        expect(hiMessages[`nav.section.${area}.${s.id}`]).toBeTruthy();
        for (const i of s.items) {
          expect(enMessages[`nav.item.${area}.${i.key}`], `${area}/${i.key}`).toBe(i.label);
          expect(hiMessages[`nav.item.${area}.${i.key}`]).toBeTruthy();
        }
      }
    }
  });
});

describe('interpolation and fallback', () => {
  it('fills {name} placeholders, leaving unknown ones visible', () => {
    expect(interpolate('Hello {name}, {n} new', { name: 'Asha', n: 3 })).toBe('Hello Asha, 3 new');
    expect(interpolate('Hello {name}', {})).toBe('Hello {name}');
    expect(interpolate('No placeholders')).toBe('No placeholders');
  });

  it('translates, with the same values in either language', () => {
    expect(translate('en', 'student.welcome', { name: 'Alex' })).toBe('Welcome back, Alex!');
    expect(translate('hi', 'student.welcome', { name: 'Alex' })).toBe('वापसी पर स्वागत है, Alex!');
  });

  it('falls back to the caller default, then to the key, and never throws', () => {
    expect(translate('hi', 'nav.item.student.nothing', undefined, 'Fallback')).toBe('Fallback');
    expect(translate('hi', 'nav.item.student.nothing')).toBe('nav.item.student.nothing');
  });
});

describe('plurals and formatting', () => {
  it('English: one and other', () => {
    expect(translatePlural('en', 'notif.unread', 1)).toBe('1 unread alert');
    expect(translatePlural('en', 'notif.unread', 0)).toBe('0 unread alerts');
    expect(translatePlural('en', 'notif.unread', 5)).toBe('5 unread alerts');
  });

  it('Hindi treats 0 and 1 as singular, as the language does', () => {
    expect(translatePlural('hi', 'notif.unread', 0)).toBe('0 अपठित सूचना');
    expect(translatePlural('hi', 'notif.unread', 1)).toBe('1 अपठित सूचना');
    expect(translatePlural('hi', 'notif.unread', 2)).toBe('2 अपठित सूचनाएँ');
  });

  it('groups numbers the Indian way and keeps Latin digits', () => {
    expect(formatNumber('en', 1234567)).toBe('12,34,567');
    expect(formatNumber('hi', 1234567)).toBe('12,34,567');
    expect(translatePlural('en', 'notif.unread', 1500)).toBe('1,500 unread alerts');
  });

  it("formats dates with the language's month names in UTC", () => {
    expect(formatDate('en', '2026-06-05T10:00:00Z')).toBe('5 June 2026');
    expect(formatDate('hi', '2026-06-05T10:00:00Z')).toMatch(/जून/);
    expect(formatDate('en', 'not a date')).toBe('');
  });
});

describe('choosing the language', () => {
  it('reads the best supported language from Accept-Language', () => {
    expect(fromAcceptLanguage('hi-IN,hi;q=0.9,en;q=0.8')).toBe('hi');
    expect(fromAcceptLanguage('fr-FR,fr;q=0.9,en;q=0.5')).toBe('en');
    expect(fromAcceptLanguage('en;q=0.4,hi;q=0.9')).toBe('hi');
    expect(fromAcceptLanguage('fr,de')).toBeNull();
    expect(fromAcceptLanguage('hi;q=0')).toBeNull();
    expect(fromAcceptLanguage(null)).toBeNull();
  });

  it("prefers the person's choice, then the organisation's, then the browser's, then English", () => {
    expect(resolveLocale({ chosen: 'en', tenantDefault: 'hi', acceptLanguage: 'hi' })).toBe('en');
    expect(resolveLocale({ chosen: 'xx', tenantDefault: 'hi', acceptLanguage: 'en' })).toBe('hi');
    expect(resolveLocale({ acceptLanguage: 'hi-IN' })).toBe('hi');
    expect(resolveLocale({})).toBe('en');
  });

  it('reads the language cookie', () => {
    expect(localeFromCookie('a=1; lms-locale=hi; b=2')).toBe('hi');
    expect(localeFromCookie('lms-locale=zz')).toBeNull();
    expect(localeFromCookie(undefined)).toBeNull();
  });
});
