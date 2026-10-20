import { describe, it, expect } from 'vitest';
import { lockedInReadOnly } from '@/lib/support-read-only';

const c = (tag: string, type = '', inForm = false, allowed = false) => ({ tag, type, inForm, allowed });

describe('lockedInReadOnly', () => {
  it('locks fields', () => {
    expect(lockedInReadOnly(c('input'))).toBe(true);
    expect(lockedInReadOnly(c('input', 'checkbox'))).toBe(true);
    expect(lockedInReadOnly(c('textarea'))).toBe(true);
    expect(lockedInReadOnly(c('select'))).toBe(true);
  });

  it('locks buttons that submit or sit in a form', () => {
    expect(lockedInReadOnly(c('button', 'submit'))).toBe(true);
    expect(lockedInReadOnly(c('button', 'button', true))).toBe(true);
    expect(lockedInReadOnly(c('button', '', true))).toBe(true);
  });

  it('leaves navigation buttons, hidden and search inputs alone', () => {
    expect(lockedInReadOnly(c('button', 'button'))).toBe(false);
    expect(lockedInReadOnly(c('button'))).toBe(false);
    expect(lockedInReadOnly(c('input', 'hidden'))).toBe(false);
    expect(lockedInReadOnly(c('input', 'SEARCH'))).toBe(false);
  });

  it('leaves everything inside role="search" or data-readonly-ok alone', () => {
    expect(lockedInReadOnly(c('input', 'text', true, true))).toBe(false);
    expect(lockedInReadOnly(c('select', '', false, true))).toBe(false);
    expect(lockedInReadOnly(c('button', 'submit', true, true))).toBe(false);
  });
});
