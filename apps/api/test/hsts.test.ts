import { describe, it, expect, vi, afterEach } from 'vitest';

// HSTS: includeSubDomains only on the platform's own hosts, never preload (lib/platform-hosts.ts).

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('../src/config.js');
});

async function load() {
  vi.resetModules();
  vi.doMock('../src/config.js', () => ({
    config: {
      TENANT_BASE_DOMAIN: 'lms.example.com',
      APP_URL: 'https://app.example.org',
      corsOrigins: [],
      CUSTOM_DOMAIN_TARGET: 'domains.lms.example.com',
    },
  }));
  return import('../src/lib/platform-hosts.js');
}

describe('hstsHeaderFor', () => {
  it('adds includeSubDomains on the base domain and tenant subdomains', async () => {
    const { hstsHeaderFor } = await load();
    expect(hstsHeaderFor('lms.example.com')).toBe('max-age=31536000; includeSubDomains');
    expect(hstsHeaderFor('Acme.LMS.example.com')).toBe('max-age=31536000; includeSubDomains');
    expect(hstsHeaderFor('app.example.org')).toBe('max-age=31536000; includeSubDomains');
  });

  it('keeps max-age only on customer custom domains, with no includeSubDomains or preload', async () => {
    const { hstsHeaderFor } = await load();
    for (const h of ['learn.university.edu', 'evil-lms.example.com.attacker.io', 'notlms.example.com']) {
      expect(hstsHeaderFor(h)).toBe('max-age=31536000');
    }
  });
});
