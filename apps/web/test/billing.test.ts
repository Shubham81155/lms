import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatDay,
  formatInr,
  isRazorpayUrl,
  isValidGstin,
  MONTHLY_PAISE,
  parseLimit,
  parseRupees,
  planTotalPaise,
  rupeesText,
  usagePercent,
  YEARLY_PAISE,
  type Plan,
} from '@/lib/billing';

const plan: Plan = {
  id: 'p',
  code: 'growth',
  name: 'Growth',
  tier: 'PROFESSIONAL',
  seatLimit: 100,
  courseLimit: null,
  storageGb: null,
  monthlyPaise: 19999,
  yearlyPaise: 199999,
};

describe('formatInr', () => {
  it('groups digits the Indian way and drops decimals on whole rupees', () => {
    expect(formatInr(0)).toBe('₹0');
    expect(formatInr(19900)).toBe('₹199');
    expect(formatInr(123456700)).toBe('₹12,34,567');
    expect(formatInr(1234567)).toBe('₹12,345.67');
    expect(formatInr(1050)).toBe('₹10.50');
  });
  it('does not show a float artefact', () => {
    expect(formatInr(29)).toBe('₹0.29');
    expect(formatInr(110)).toBe('₹1.10');
  });
  it('shows a dash for a value that is not a number', () => {
    expect(formatInr(NaN)).toBe('—');
    expect(formatInr(Infinity)).toBe('—');
  });
});

describe('planTotalPaise', () => {
  it('multiplies the per-seat price in whole paise', () => {
    expect(planTotalPaise(plan, 'MONTH', 3)).toBe(59997);
    expect(planTotalPaise(plan, 'YEAR', 10)).toBe(1999990);
  });
});

describe('usagePercent', () => {
  it('is null without a limit and capped at 100', () => {
    expect(usagePercent(5, null)).toBeNull();
    expect(usagePercent(5, 0)).toBeNull();
    expect(usagePercent(5, 10)).toBe(50);
    expect(usagePercent(15, 10)).toBe(100);
  });
});

describe('formatBytes', () => {
  it('picks a unit', () => {
    expect(formatBytes(0)).toBe('0 KB');
    expect(formatBytes(10)).toBe('< 1 KB');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 ** 2)).toBe('5.0 MB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.00 GB');
    expect(formatBytes(NaN)).toBe('0 KB');
  });
});

describe('parseRupees', () => {
  it('turns rupees into paise exactly', () => {
    expect(parseRupees('199', MONTHLY_PAISE)).toBe(19900);
    expect(parseRupees('199.5', MONTHLY_PAISE)).toBe(19950);
    expect(parseRupees('0.29', MONTHLY_PAISE)).toBeUndefined();
    expect(parseRupees('1.15', MONTHLY_PAISE)).toBe(115);
    expect(parseRupees(' 1999 ', YEARLY_PAISE)).toBe(199900);
  });
  it('rejects zero, negatives, NaN, three decimals, exponents and out-of-range prices', () => {
    for (const v of ['', '0', '0.99', '-5', 'abc', '1e3', '1.234', '1,000', '.5', 'NaN', 'Infinity'])
      expect(parseRupees(v, MONTHLY_PAISE), v).toBeUndefined();
    expect(parseRupees('1000001', MONTHLY_PAISE)).toBeUndefined();
    expect(parseRupees('1000000', MONTHLY_PAISE)).toBe(100_000_000);
  });
  it('round-trips with rupeesText', () => {
    for (const paise of [100, 19900, 19950, 19905, 100_000_000]) expect(parseRupees(rupeesText(paise), YEARLY_PAISE)).toBe(paise);
    expect(rupeesText(19905)).toBe('199.05');
  });
});

describe('parseLimit', () => {
  it('blank is unlimited, otherwise a whole number from 1 to 10 million', () => {
    expect(parseLimit('')).toBeNull();
    expect(parseLimit('  ')).toBeNull();
    expect(parseLimit('25')).toBe(25);
    expect(parseLimit('10000000')).toBe(10_000_000);
  });
  it('rejects everything else', () => {
    for (const v of ['0', '-1', '1.5', '1e3', 'abc', 'NaN', '10000001', '+5']) expect(parseLimit(v), v).toBeUndefined();
  });
});

describe('isRazorpayUrl', () => {
  it('accepts https pages on razorpay.com only', () => {
    expect(isRazorpayUrl('https://rzp.io/i/abc')).toBe(true);
    expect(isRazorpayUrl('https://api.razorpay.com/v1/x')).toBe(true);
    expect(isRazorpayUrl('https://razorpay.com/x')).toBe(true);
  });
  it('rejects look-alikes, other schemes and non-strings', () => {
    expect(isRazorpayUrl('http://razorpay.com/x')).toBe(false);
    expect(isRazorpayUrl('https://notrzp.io/x')).toBe(false);
    expect(isRazorpayUrl('https://razorpay.com.evil.test/x')).toBe(false);
    expect(isRazorpayUrl('https://evilrazorpay.com/x')).toBe(false);
    expect(isRazorpayUrl('javascript:alert(1)')).toBe(false);
    expect(isRazorpayUrl('')).toBe(false);
    expect(isRazorpayUrl(undefined)).toBe(false);
  });
});

describe('formatDay', () => {
  it('formats a date and tolerates a missing or broken one', () => {
    expect(formatDay('2026-10-24T10:00:00Z')).toMatch(/2026/);
    expect(formatDay(null)).toBe('');
    expect(formatDay('not a date')).toBe('');
  });
});

describe('isValidGstin', () => {
  it('checks the shape', () => {
    expect(isValidGstin('29ABCDE1234F1Z5')).toBe(true);
    expect(isValidGstin('29abcde1234f1z5')).toBe(true);
    expect(isValidGstin('29ABCDE1234F1Z')).toBe(false);
    expect(isValidGstin('XXABCDE1234F1Z5')).toBe(false);
  });
});
