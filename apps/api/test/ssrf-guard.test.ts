import { describe, expect, it } from 'vitest';
import { isBlockedIp } from '../src/lib/webhooks';

// The address check behind webhook, OIDC and SAML URLs (assertSafeWebhookUrl): what a tenant administrator's URL may
// never reach, including the forms that slipped past a literal-prefix check.
describe('isBlockedIp', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '100.127.255.254', '224.0.0.1', '198.18.0.1',
    '::1', '::', '[::1]', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '::ffff:10.0.0.1',
  ])('blocks %s', (ip) => expect(isBlockedIp(ip)).toBe(true));

  it.each(['8.8.8.8', '93.184.216.34', '100.63.0.1', '100.128.0.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8', '::ffff:808:808'])('allows %s', (ip) =>
    expect(isBlockedIp(ip)).toBe(false)
  );

  it('is what the URL parser hands over for a mapped literal', () => {
    expect(isBlockedIp(new URL('https://[::ffff:127.0.0.1]/').hostname)).toBe(true);
    expect(isBlockedIp(new URL('https://[::]/').hostname)).toBe(true);
  });
});
