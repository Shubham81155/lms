import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// The periodic re-check of live custom domains: the TXT record that proved a domain must stay. A definite
// failure starts a grace period and warns the administrators once; a passing DNS problem neither starts nor
// advances it; a success ends it; still failing after the grace period, the domain is removed and the
// organisation keeps its subdomain. DNS is a fake resolver; time is passed in. Real PostgreSQL and RLS.

const DAY = 24 * 60 * 60 * 1000;
let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;
let recheck: typeof import('../src/lib/custom-domain-recheck.js');
let domains: typeof import('../src/lib/custom-domain.js');
let jobLock: typeof import('../src/lib/job-lock.js');

// name -> TXT values, or an error code. Every TXT lookup is logged.
let txt: Record<string, string[] | string> = {};
const looked: string[] = [];
const outbox: { to: string; subject: string; text: string }[] = [];
const dnsError = (code: string) => Object.assign(new Error(code), { code });

const T0 = new Date();
const at = (days: number) => new Date(T0.getTime() + days * DAY);
const record = (domain: string) => `_lms-verify.${domain}`;
const value = (token: string) => `lms-verify=${token}`;

beforeAll(async () => {
  process.env.PLATFORM_OPERATOR_TENANT = 'ops';
  process.env.DEFAULT_TENANT_SLUG = 'default-tenant';
  process.env.TENANT_BASE_DOMAIN = 'lms.test';
  process.env.CUSTOM_DOMAIN_RECHECK_GRACE_DAYS = '7';
  process.env.CUSTOM_DOMAIN_RECHECK_INTERVAL_SECONDS = '86400';
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  const live = (id: string, slug: string, name: string, domain: string | null, token: string | null, extra: object = {}) =>
    admin.tenant.create({
      data: {
        id,
        slug,
        name,
        customDomain: domain,
        customDomainLiveToken: token,
        customDomainVerifiedAt: domain ? new Date() : null,
        ...extra,
      },
    });
  await live('t-def', 'default-tenant', 'Default', null, null);
  await live('t-ok', 'okay', 'Okay College', 'learn.okay.edu', 'tok-ok');
  await live('t-a', 'alpha', 'Alpha', 'learn.alpha.edu', 'tok-a');
  await live('t-w', 'wrong', 'Wrong College', 'learn.wrong.edu', 'tok-w');
  await live('t-f', 'flaky', 'Flaky College', 'learn.flaky.edu', 'tok-f');
  // A domain the operator set without verification (or proved before tokens were kept) is never re-checked.
  await live('t-legacy', 'legacy', 'Legacy College', 'learn.legacy.edu', null);
  await live('t-gone', 'gone', 'Gone', 'learn.gone.edu', 'tok-gone', { status: 'ARCHIVED' });
  const user = (id: string, tenantId: string, email: string, role: string, extra: object = {}) =>
    admin.user.create({ data: { id, tenantId, email, firstName: 'A', lastName: 'B', role: role as any, emailVerified: true, ...extra } });
  await user('a-admin', 't-a', 'admin@alpha.edu', 'TENANT_ADMIN');
  await user('a-super', 't-a', 'super@alpha.edu', 'SUPER_ADMIN');
  await user('a-student', 't-a', 'student@alpha.edu', 'STUDENT');
  await user('a-old', 't-a', 'old-admin@alpha.edu', 'TENANT_ADMIN', { status: 'SUSPENDED' });
  await user('w-admin', 't-w', 'admin@wrong.edu', 'TENANT_ADMIN');
  await user('f-admin', 't-f', 'admin@flaky.edu', 'TENANT_ADMIN');
  await user('ok-admin', 't-ok', 'admin@okay.edu', 'TENANT_ADMIN');
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
  const mailer = await import('../src/lib/mailer.js');
  mailer.setMailer({
    async send(m) {
      outbox.push(m);
    },
  });
  domains = await import('../src/lib/custom-domain.js');
  recheck = await import('../src/lib/custom-domain-recheck.js');
  jobLock = await import('../src/lib/job-lock.js');
  domains.setDnsResolver({
    resolveTxt: (name) => {
      looked.push(name);
      const v = txt[name];
      if (typeof v === 'string') return Promise.reject(dnsError(v));
      return v ? Promise.resolve(v.map((s) => [s])) : Promise.reject(dnsError('ENOTFOUND'));
    },
    resolveCname: () => Promise.reject(dnsError('ENODATA')),
    resolve4: () => Promise.reject(dnsError('ENODATA')),
    resolve6: () => Promise.reject(dnsError('ENODATA')),
  });
}, 240_000);

afterAll(async () => {
  domains?.setDnsResolver(null);
  await admin?.$disconnect();
  await db?.stop();
}, 60_000);

beforeEach(() => {
  outbox.length = 0;
  looked.length = 0;
});

const run = (now: Date) => recheck.recheckCustomDomains({ now, pauseMs: 0 });
const tenant = (id: string) => admin.tenant.findUniqueOrThrow({ where: { id } });
const audits = (tenantId: string, action: string) => admin.auditLog.findMany({ where: { tenantId, action } });
const orgAt = (host: string) => request(app).get('/api/v1/tenant/config').set('Host', host);

describe('re-checking live custom domains', () => {
  it('checks only verified live domains of organisations that are not archived', async () => {
    txt = {
      [record('learn.okay.edu')]: [value('tok-ok'), 'v=spf1 -all'],
      [record('learn.wrong.edu')]: [value('tok-w')],
      [record('learn.flaky.edu')]: [value('tok-f')],
      // learn.alpha.edu: no record at all.
    };
    const res = await run(at(0));
    expect(looked.sort()).toEqual([
      record('learn.alpha.edu'),
      record('learn.flaky.edu'),
      record('learn.okay.edu'),
      record('learn.wrong.edu'),
    ]);
    expect(res).toMatchObject({ checked: 4, ok: 3, failing: 1, transient: 0, warned: 1, removed: 0 });
    const ok = await tenant('t-ok');
    expect(ok.customDomainRecheckedAt?.getTime()).toBe(at(0).getTime());
    expect(ok).toMatchObject({ customDomainRecheckError: null, customDomainFailingSince: null, customDomainWarnedAt: null });
    const legacy = await tenant('t-legacy');
    expect(legacy.customDomainRecheckedAt).toBeNull();
  });

  it('warns the active administrators once when the record goes missing, and starts the grace period', async () => {
    // Run at(0) above found learn.alpha.edu without its record.
    const a = await tenant('t-a');
    expect(a.customDomainFailingSince?.getTime()).toBe(at(0).getTime());
    expect(a.customDomainWarnedAt?.getTime()).toBe(at(0).getTime());
    expect(a.customDomainRecheckError).toMatch(/No TXT record found at _lms-verify\.learn\.alpha\.edu/);
    expect(a.customDomain).toBe('learn.alpha.edu');
    expect(await audits('t-a', 'CUSTOM_DOMAIN_RECHECK_FAILING')).toHaveLength(1);

    // The admin area shows when it will be removed.
    const view = await domains.getDomainState('t-a');
    expect(view.recheck).toMatchObject({ txtName: record('learn.alpha.edu'), txtValue: value('tok-a') });
    expect(view.recheck?.removesAt?.getTime()).toBe(at(7).getTime());
    expect((await domains.getDomainState('t-legacy')).recheck).toBeNull();

    // Not yet due: checked less than a day ago.
    expect((await run(at(0.5))).checked).toBe(0);

    // Still missing two days later: the grace period does not restart and nobody is warned again.
    const res = await run(at(2));
    expect(res).toMatchObject({ failing: 1, warned: 0, removed: 0 });
    const again = await tenant('t-a');
    expect(again.customDomainFailingSince?.getTime()).toBe(at(0).getTime());
    expect(again.customDomainRecheckedAt?.getTime()).toBe(at(2).getTime());
    expect(outbox.filter((m) => m.to.endsWith('@alpha.edu'))).toHaveLength(0);
    expect(await audits('t-a', 'CUSTOM_DOMAIN_RECHECK_FAILING')).toHaveLength(1);
  });

  it('sent the warning to active administrators only, with the record and the deadline', async () => {
    // A fresh failure: learn.wrong.edu now has a different value.
    txt[record('learn.wrong.edu')] = [value('someone-else')];
    await run(at(3));
    const mails = outbox.filter((m) => m.to.endsWith('@wrong.edu'));
    expect(mails.map((m) => m.to)).toEqual(['admin@wrong.edu']);
    expect(mails[0].subject).toMatch(/learn\.wrong\.edu/);
    expect(mails[0].text).toContain(`${record('learn.wrong.edu')} = ${value('tok-w')}`);
    expect(mails[0].text).toMatch(/different value/);
    expect(mails[0].text).toContain('within 7 days');
    expect(mails[0].text).toContain('wrong.lms.test');
    const w = await tenant('t-w');
    expect(w.customDomainFailingSince?.getTime()).toBe(at(3).getTime());
  });

  it('a passing DNS problem records the error but neither starts nor advances the grace period', async () => {
    txt[record('learn.flaky.edu')] = 'ETIMEOUT';
    txt[record('learn.alpha.edu')] = 'ESERVFAIL';
    const res = await run(at(4));
    expect(res.transient).toBe(2);
    const f = await tenant('t-f');
    expect(f).toMatchObject({ customDomain: 'learn.flaky.edu', customDomainFailingSince: null, customDomainWarnedAt: null });
    expect(f.customDomainRecheckError).toMatch(/timed out/);
    const a = await tenant('t-a');
    expect(a.customDomainFailingSince?.getTime()).toBe(at(0).getTime());
    expect(a.customDomainRecheckError).toMatch(/ESERVFAIL/);
    expect(outbox.filter((m) => !m.to.endsWith('@wrong.edu'))).toHaveLength(0);

    // Long after any grace period, a transient failure never removes a domain.
    txt[record('learn.wrong.edu')] = [value('tok-w')];
    const late = await run(at(30));
    expect(late.removed).toBe(0);
    expect((await tenant('t-a')).customDomain).toBe('learn.alpha.edu');
    expect((await tenant('t-f')).customDomain).toBe('learn.flaky.edu');
  });

  it('a success ends the failure, and a later failure warns again', async () => {
    // Run at(30) found learn.wrong.edu correct again.
    const w = await tenant('t-w');
    expect(w).toMatchObject({
      customDomain: 'learn.wrong.edu',
      customDomainFailingSince: null,
      customDomainWarnedAt: null,
      customDomainRecheckError: null,
    });
    expect(await audits('t-w', 'CUSTOM_DOMAIN_RECHECK_RECOVERED')).toHaveLength(1);

    delete txt[record('learn.wrong.edu')];
    const res = await run(at(31));
    expect(res.warned).toBe(1);
    expect(outbox.map((m) => m.to)).toContain('admin@wrong.edu');
    expect((await tenant('t-w')).customDomainFailingSince?.getTime()).toBe(at(31).getTime());
  });

  it('removes the domain still failing after the grace period; the organisation keeps its subdomain', async () => {
    expect((await orgAt('learn.alpha.edu')).body.slug).toBe('alpha');
    txt[record('learn.alpha.edu')] = [value('tok-other')];
    const res = await run(at(32));
    // learn.alpha.edu has failed since day 0; learn.wrong.edu only since day 31.
    expect(res.removed).toBe(1);
    const a = await tenant('t-a');
    expect(a).toMatchObject({
      slug: 'alpha',
      customDomain: null,
      customDomainVerifiedAt: null,
      customDomainLiveToken: null,
      customDomainFailingSince: null,
      customDomainWarnedAt: null,
      customDomainRecheckedAt: null,
      customDomainRecheckError: null,
    });
    expect((await tenant('t-w')).customDomain).toBe('learn.wrong.edu');

    const [removed] = await audits('t-a', 'CUSTOM_DOMAIN_REMOVED_UNVERIFIED');
    expect(removed.diffJson).toMatchObject({ live: 'learn.alpha.edu', by: 'SYSTEM' });

    const mails = outbox.filter((m) => m.to.endsWith('@alpha.edu'));
    expect(mails.map((m) => m.to).sort()).toEqual(['admin@alpha.edu', 'super@alpha.edu']);
    expect(mails[0].subject).toMatch(/learn\.alpha\.edu no longer works/);
    expect(mails[0].text).toContain('alpha.lms.test');

    // The domain no longer resolves to the organisation; its subdomain does.
    expect((await orgAt('learn.alpha.edu')).body.slug).not.toBe('alpha');
    expect((await orgAt('alpha.lms.test')).body.slug).toBe('alpha');
    expect((await domains.getDomainState('t-a')).recheck).toBeNull();

    // Removed domains are not checked again.
    looked.length = 0;
    await run(at(40));
    expect(looked).not.toContain(record('learn.alpha.edu'));
  });

  it('runs under the job lock', async () => {
    txt[record('learn.wrong.edu')] = [value('tok-w')];
    const res = await jobLock.withJobLock(recheck.RECHECK_JOB, () => run(at(50)));
    expect(res?.checked).toBeGreaterThan(0);
    expect((await tenant('t-w')).customDomainFailingSince).toBeNull();
  });
});
