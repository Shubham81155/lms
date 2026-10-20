import { describe, it, expect } from 'vitest';
import { dueText, isOpen, parseDays } from '../src/lib/dataRequests';

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
