import http from 'http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { encryptSecret } from '../src/lib/mfa';
import { prisma } from '../src/lib/prisma';
import { deliverWebhook, resolveWebhookSecret, signPayload } from '../src/lib/webhooks';

describe('webhook secret encryption (SEC-10)', () => {
  let server: http.Server;
  let url: string;
  const received: { signature?: string; timestamp?: string; body: string }[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        received.push({
          signature: typeof req.headers['x-lms-signature'] === 'string' ? req.headers['x-lms-signature'] : undefined,
          timestamp: typeof req.headers['x-lms-timestamp'] === 'string' ? req.headers['x-lms-timestamp'] : undefined,
          body,
        });
        res.statusCode = 200;
        res.end('ok');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    url = `http://127.0.0.1:${addr.port}/hook`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('encrypts and decrypts webhook secrets using iv:tag:cipher format', () => {
    const plain = 'whsec_test_secret_value_12345';
    const encrypted = encryptSecret(plain);
    expect(encrypted).not.toBe(plain);
    expect(encrypted).toMatch(/^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/i);
    expect(resolveWebhookSecret(encrypted)).toBe(plain);
  });

  it('falls back to plaintext for legacy or seeded secrets', () => {
    expect(resolveWebhookSecret('whsec_legacy_plaintext')).toBe('whsec_legacy_plaintext');
    expect(resolveWebhookSecret('legacy:secret:with:colons')).toBe('legacy:secret:with:colons');
    expect(resolveWebhookSecret('short:tag:cipher')).toBe('short:tag:cipher');
  });

  it('rejects tampered encrypted secrets', () => {
    const [iv, tag, cipher] = encryptSecret('whsec_tamper_test').split(':');
    const flipped = (cipher[0] === '0' ? '1' : '0') + cipher.slice(1);
    expect(() => resolveWebhookSecret(`${iv}:${tag}:${flipped}`)).toThrow();
  });

  it('signs webhook deliveries with the decrypted secret and supports legacy plaintext rows', async () => {
    const createSpy = vi.spyOn(prisma.webhookDelivery, 'create').mockResolvedValue({} as never);
    try {
      const plain = 'whsec_delivery_roundtrip_key';
      const encrypted = encryptSecret(plain);
      const body = JSON.stringify({ event: 'webhook.test' });

      const encryptedRes = await deliverWebhook({ id: 'ep-1', url, secret: encrypted }, 'tenant-1', 'webhook.test', body);
      expect(encryptedRes).toEqual({ success: true, statusCode: 200, error: null });

      const lastEncrypted = received.at(-1)!;
      expect(lastEncrypted.signature).toBe(`sha256=${signPayload(plain, lastEncrypted.timestamp!, body)}`);

      const legacyRes = await deliverWebhook({ id: 'ep-2', url, secret: plain }, 'tenant-1', 'webhook.test', body);
      expect(legacyRes).toEqual({ success: true, statusCode: 200, error: null });

      const lastLegacy = received.at(-1)!;
      expect(lastLegacy.signature).toBe(`sha256=${signPayload(plain, lastLegacy.timestamp!, body)}`);
    } finally {
      createSpy.mockRestore();
    }
  });
});
