import { describe, it, expect, vi, afterEach } from 'vitest';

// Cookie names and paths in production versus everywhere else (lib/cookie-name.ts).

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('../src/config.js');
});

async function load(nodeEnv: string) {
  vi.resetModules();
  vi.doMock('../src/config.js', () => ({ config: { NODE_ENV: nodeEnv } }));
  return import('../src/lib/cookie-name.js');
}

describe('cookie names', () => {
  it('uses __Host- cookies on path / in production', async () => {
    const { cookieName, cookiePath } = await load('production');
    expect(cookieName('lms_token')).toBe('__Host-lms_token');
    expect(cookiePath('/api/v1/auth/saml')).toBe('/');
  });

  it('keeps plain names and narrow paths elsewhere, where local http would refuse the prefix', async () => {
    for (const env of ['development', 'test']) {
      const { cookieName, cookiePath } = await load(env);
      expect(cookieName('lms_token')).toBe('lms_token');
      expect(cookiePath('/api/v1/auth/sso')).toBe('/api/v1/auth/sso');
    }
  });
});
