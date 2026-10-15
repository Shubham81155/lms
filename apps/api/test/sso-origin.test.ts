import { describe, it, expect } from 'vitest';
import { allowedOrigins, appOrigin, callbackUri, originFor, redirectUrisFor } from '../src/lib/sso-origin';

// Pure rules for choosing the origin of an SSO round trip (APP_URL is http://localhost:3000 in tests).

const APP = 'http://localhost:3000';
const custom = { customDomain: 'learn.example.edu' };
const plain = { customDomain: null };

describe('sso origin selection', () => {
  it('offers the platform address, plus the custom domain when there is one', () => {
    expect(appOrigin()).toBe(APP);
    expect(allowedOrigins(plain)).toEqual([APP]);
    expect(allowedOrigins(custom)).toEqual([APP, 'http://learn.example.edu']);
    expect(redirectUrisFor(custom)).toEqual([`${APP}/api/v1/auth/sso/callback`, 'http://learn.example.edu/api/v1/auth/sso/callback']);
    expect(callbackUri('https://x.example')).toBe('https://x.example/api/v1/auth/sso/callback');
  });

  it('picks the origin whose host the request used, case-insensitively', () => {
    expect(originFor(custom, 'learn.example.edu')).toBe('http://learn.example.edu');
    expect(originFor(custom, ' LEARN.Example.EDU ')).toBe('http://learn.example.edu');
    expect(originFor(custom, 'localhost:3000')).toBe(APP);
  });

  it('falls back to the platform address for anything it does not own', () => {
    for (const host of [undefined, '', 'evil.example', 'learn.example.edu:8443', 'learn.example.edu.', 'sub.learn.example.edu', 'example.edu']) {
      expect(originFor(custom, host), String(host)).toBe(APP);
    }
    expect(originFor(plain, 'learn.example.edu')).toBe(APP); // a tenant without a custom domain has none to use
  });
});
