import dns from 'dns/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config';
import { assertSafeWebhookTarget, isBlockedIp } from '../src/lib/webhooks';
import { discover, exchangeCode } from '../src/lib/oidc';

// The address check behind webhook, OIDC and SAML URLs (assertSafeWebhookUrl): what a tenant administrator's URL may
// never reach, including the forms that slipped past a literal-prefix check.
describe('isBlockedIp', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '0.0.0.0',
    '100.64.0.1',
    '100.127.255.254',
    '224.0.0.1',
    '198.18.0.1',
    '::1',
    '::',
    '[::1]',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:169.254.169.254',
    '::ffff:a9fe:a9fe',
    '::ffff:10.0.0.1',
  ])('blocks %s', (ip) => expect(isBlockedIp(ip)).toBe(true));

  it.each([
    '8.8.8.8',
    '93.184.216.34',
    '100.63.0.1',
    '100.128.0.1',
    '172.32.0.1',
    '2606:4700:4700::1111',
    '::ffff:8.8.8.8',
    '::ffff:808:808',
  ])('allows %s', (ip) => expect(isBlockedIp(ip)).toBe(false));

  it('is what the URL parser hands over for a mapped literal', () => {
    expect(isBlockedIp(new URL('https://[::ffff:127.0.0.1]/').hostname)).toBe(true);
    expect(isBlockedIp(new URL('https://[::]/').hostname)).toBe(true);
  });
});

describe('assertSafeWebhookTarget & OIDC SSRF guard', () => {
  const originalNodeEnv = config.NODE_ENV;

  afterEach(() => {
    (config as { NODE_ENV: string }).NODE_ENV = originalNodeEnv;
    vi.restoreAllMocks();
  });

  it('blocks hostnames whose DNS resolves to private or metadata IP addresses in production', async () => {
    (config as { NODE_ENV: string }).NODE_ENV = 'production';
    vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '169.254.169.254', family: 4 }] as never);

    await expect(assertSafeWebhookTarget('https://metadata-rebind.example/jwks')).rejects.toThrow(/not allowed/);
  });

  it('allows hostnames resolving to public IP addresses in production', async () => {
    (config as { NODE_ENV: string }).NODE_ENV = 'production';
    vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);

    await expect(assertSafeWebhookTarget('https://idp.example.edu/.well-known/openid-configuration')).resolves.toBeUndefined();
  });

  it('blocks OIDC discovery and token exchange against DNS-rebound internal targets before calling fetch', async () => {
    (config as { NODE_ENV: string }).NODE_ENV = 'production';
    vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '10.0.0.5', family: 4 }] as never);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(discover('https://internal-idp.example')).rejects.toThrow(/not allowed/);
    await expect(
      exchangeCode(
        {
          issuer: 'https://internal-idp.example',
          authorization_endpoint: 'https://internal-idp.example/auth',
          token_endpoint: 'https://internal-idp.example/token',
          jwks_uri: 'https://internal-idp.example/jwks',
        },
        { clientId: 'c', clientSecret: 's', redirectUri: 'https://app.example/cb', code: 'code', verifier: 'ver' }
      )
    ).rejects.toThrow(/not allowed/);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
