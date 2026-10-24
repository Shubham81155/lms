import { describe, it, expect } from 'vitest';
import { dueText, dueLabel, kindLabel, statusLabel, isOpen, parseDays } from '../src/lib/dataRequests';
import { makeTranslator } from '../src/lib/i18n';

describe('dueText', () => {
  it('says how long is left, or how late', () => {
    expect(dueText(30)).toBe('Due in 30 days');
    expect(dueText(1)).toBe('Due in 1 day');
    expect(dueText(0)).toBe('Due today');
    expect(dueText(-1)).toBe('1 day overdue');
    expect(dueText(-4)).toBe('4 days overdue');
    expect(dueText(null)).toBe('');
  });
});

describe('isOpen', () => {
  it('is true for requests still being worked on only', () => {
    expect(isOpen({ status: 'OPEN' })).toBe(true);
    expect(isOpen({ status: 'IN_PROGRESS' })).toBe(true);
    for (const status of ['FULFILLED', 'REJECTED', 'CANCELLED'] as const) expect(isOpen({ status })).toBe(false);
  });
});

describe('parseDays', () => {
  it('empty keeps the data (null), a whole number in range is the days, anything else is invalid', () => {
    expect(parseDays('', 30)).toBeNull();
    expect(parseDays('  ', 30)).toBeNull();
    expect(parseDays('90', 30)).toBe(90);
    expect(parseDays('30', 30)).toBe(30);
    expect(parseDays('29', 30)).toBeUndefined();
    expect(parseDays('3650', 30)).toBe(3650);
    expect(parseDays('3651', 30)).toBeUndefined();
    expect(parseDays('1.5', 7)).toBeUndefined();
    expect(parseDays('-10', 7)).toBeUndefined();
    expect(parseDays('ten', 7)).toBeUndefined();
  });
});

describe('translating variants', () => {
  it('match the English helpers in English', () => {
    const en = makeTranslator('en');
    for (const d of [null, -4, -1, 0, 1, 30]) expect(dueLabel(en, d)).toBe(dueText(d));
    expect(kindLabel(en, 'ERASURE')).toBe('Erase my data');
    expect(statusLabel(en, 'IN_PROGRESS')).toBe('Being handled');
  });
  it('speak Hindi when asked', () => {
    const hi = makeTranslator('hi');
    expect(dueLabel(hi, 0)).not.toBe('Due today');
    expect(statusLabel(hi, 'OPEN')).toMatch(/[ऀ-ॿ]/);
  });
});
