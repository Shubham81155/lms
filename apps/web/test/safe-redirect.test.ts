import { describe, expect, it } from 'vitest';
import { safeNextPath } from '../src/lib/safe-redirect';

describe('safeNextPath', () => {
  it.each(['/student', '/courses/abc?tab=2', '/admin#billing', '/'])('keeps %s', (p) => expect(safeNextPath(p)).toBe(p));

  it.each([
    '//evil.com',
    '/\\evil.com',
    '/\t/evil.com',
    '/\n/evil.com',
    '\\\\evil.com',
    'https://evil.com',
    'evil.com',
    'javascript:alert(1)',
    '',
    null,
    undefined,
    '/%0d/evil.com\r',
  ])('refuses %j', (p) => expect(safeNextPath(p as string | null | undefined)).toBeNull());
});
