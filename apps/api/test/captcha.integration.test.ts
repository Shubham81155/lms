import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// CAPTCHA (Cloudflare Turnstile) on the public organisation-registration request. Cloudflare's siteverify is
// replaced by a stub of fetch; the database is real.

const SECRET = 'test-turnstile-secret-0123456789';
const SITE_KEY = 'test-turnstile-site-key';
let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;
let config: typeof import('../src/config.js').config;
let captcha: typeof import('../src/lib/captcha.js');
const outbox: { to: string; subject: string; text: string }[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  process.env.ORG_REQUEST_RATE_LIMIT_MAX = '100';
  process.env.DEFAULT_TENANT_SLUG = 'default-tenant';
  process.env.TURNSTILE_SECRET_KEY = SECRET;
  process.env.TURNSTILE_SITE_KEY = SITE_KEY;
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
  ({ config } = await import('../src/config.js'));
  captcha = await import('../src/lib/captcha.js');
  const mailer = await import('../src/lib/mailer.js');
  mailer.setMailer({
    async send(m) {
      outbox.push(m);
    },
  });
}, 240_000);

afterAll(async () => {
  await admin?.$disconnect();
  await db?.stop();
}, 60_000);

/** siteverify's answer for the next calls. */
const answer = (body: object, status = 200) =>
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

beforeEach(() => {
  outbox.length = 0;
  config.TURNSTILE_SECRET_KEY = SECRET;
  config.TURNSTILE_SITE_KEY = SITE_KEY;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const ask = (slug: string, over: object = {}) => ({
  organizationName: `College ${slug}`,
  slug,
  institutionType: 'COLLEGE',
  contactFirstName: 'Ann',
  contactLastName: 'Lee',
  contactEmail: `ann@${slug}.edu`,
  acceptTerms: true,
  ...over,
});
const send = (body: object) => request(app).post('/api/v1/organizations/requests').send(body);
const requestsFor = (slug: string) => admin.organizationRequest.count({ where: { slug } });

describe('CAPTCHA on organisation requests', () => {
  it('names the site key to the web app', async () => {
    const res = await request(app).get('/api/v1/organizations/captcha');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { siteKey: SITE_KEY } });
  });

  it('refuses a request without a token, before asking Cloudflare or writing anything', async () => {
    const res = await send(ask('no-token'));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(captcha.CAPTCHA_REQUIRED_MESSAGE);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await requestsFor('no-token')).toBe(0);
    expect(outbox).toHaveLength(0);
  });

  it('checks the form before the CAPTCHA, so a bad form costs no siteverify call', async () => {
    const res = await send(ask('bad-form', { acceptTerms: false, captchaToken: 'tok' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a token Cloudflare does not accept', async () => {
    answer({ success: false, 'error-codes': ['invalid-input-response'] });
    const res = await send(ask('bad-token', { captchaToken: 'not-a-real-token' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(captcha.CAPTCHA_FAILED_MESSAGE);
    expect(res.body.details).toEqual({ errorCodes: ['invalid-input-response'] });
    expect(await requestsFor('bad-token')).toBe(0);
    expect(outbox).toHaveLength(0);
  });

  it('refuses a token solved for another form', async () => {
    answer({ success: true, action: 'find-organisation', hostname: 'localhost' });
    const res = await send(ask('other-action', { captchaToken: 'tok' }));
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual({ errorCodes: ['action-mismatch'] });
    expect(await requestsFor('other-action')).toBe(0);
  });

  it('answers 503 and lets nothing through when Cloudflare cannot be reached', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const res = await send(ask('cf-down', { captchaToken: 'tok' }));
    expect(res.status).toBe(503);
    expect(res.body.error).toBe(captcha.CAPTCHA_UNAVAILABLE_MESSAGE);
    expect(await requestsFor('cf-down')).toBe(0);
    expect(outbox).toHaveLength(0);

    answer({ error: 'bad gateway' }, 502);
    expect((await send(ask('cf-down', { captchaToken: 'tok' }))).status).toBe(503);
  });

  it('answers 503 when Cloudflare refuses our secret (a configuration problem, not the visitor)', async () => {
    answer({ success: false, 'error-codes': ['invalid-input-secret'] });
    expect((await send(ask('bad-secret', { captchaToken: 'tok' }))).status).toBe(503);
  });

  it('accepts a request with a passing token, sending Cloudflare the secret, token and client IP', async () => {
    answer({ success: true, action: 'org-request', hostname: 'localhost', 'error-codes': [] });
    const res = await send(ask('with-captcha', { captchaToken: 'good-token' }));
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('UNVERIFIED');
    expect(await requestsFor('with-captcha')).toBe(1);
    expect(outbox).toHaveLength(1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(init.method).toBe('POST');
    const form = init.body as URLSearchParams;
    expect(form.get('secret')).toBe(SECRET);
    expect(form.get('response')).toBe('good-token');
    expect(form.get('remoteip')).toBeTruthy();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('also takes the token from the cf-turnstile-response header', async () => {
    answer({ success: true, action: 'org-request' });
    const res = await request(app)
      .post('/api/v1/organizations/requests')
      .set('cf-turnstile-response', 'header-token')
      .send(ask('header-token'));
    expect(res.status).toBe(201);
    expect((fetchMock.mock.calls[0][1].body as URLSearchParams).get('response')).toBe('header-token');
  });

  it("skips the action check with Cloudflare's dummy secrets, which answer without one", async () => {
    config.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA';
    answer({ success: true, action: '', hostname: 'example.com' });
    expect(await captcha.verifyCaptcha('XXXX.DUMMY.TOKEN.XXXX', '127.0.0.1', { action: 'org-request', hostnames: ['lms.test'] })).toEqual({
      ok: true,
    });
  });

  it('checks the host name when asked to', async () => {
    answer({ success: true, action: 'org-request', hostname: 'evil.example' });
    expect(await captcha.verifyCaptcha('tok', null, { action: 'org-request', hostnames: ['lms.test'] })).toMatchObject({
      ok: false,
      reason: 'rejected',
    });
    answer({ success: true, action: 'org-request', hostname: 'lms.test' });
    expect(await captcha.verifyCaptcha('tok', null, { action: 'org-request', hostnames: ['lms.test'] })).toEqual({ ok: true });
  });

  it('is off without TURNSTILE_SECRET_KEY: no site key, and requests need no token', async () => {
    config.TURNSTILE_SECRET_KEY = undefined;
    config.TURNSTILE_SITE_KEY = undefined;
    expect((await request(app).get('/api/v1/organizations/captcha')).body).toEqual({ data: { siteKey: null } });
    const res = await send(ask('no-captcha'));
    expect(res.status).toBe(201);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('CAPTCHA on finding my organisation', () => {
  const find = (body: object) => request(app).post('/api/v1/organizations/find').send(body);

  it('refuses a lookup without a token, before asking Cloudflare or sending mail', async () => {
    const res = await find({ email: 'someone@x.edu' });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(outbox).toHaveLength(0);
  });

  it('checks the token for its own action', async () => {
    answer({ success: true, action: 'org-request', hostname: 'localhost' });
    expect((await find({ email: 'someone@x.edu', captchaToken: 'tok' })).status).toBe(400);
    answer({ success: true, action: 'find-organisation', hostname: 'localhost' });
    expect((await find({ email: 'someone@x.edu', captchaToken: 'tok' })).status).toBe(202);
  });
});
