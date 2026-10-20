import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// Organisation registration: public requests and their e-mail confirmation, the platform operator's decisions, creating and suspending
// organisations, and how people reach their organisation on a shared address. Real PostgreSQL and RLS.

const PASSWORD = 'CorrectHorse1!';
let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;
let mailer: typeof import('../src/lib/mailer.js');
let config: typeof import('../src/config.js').config;
const outbox: { to: string; subject: string; text: string }[] = [];
/** Every message of the run, for links sent in an earlier test. */
const allMail: { to: string; subject: string; text: string }[] = [];

beforeAll(async () => {
  process.env.PLATFORM_OPERATOR_TENANT = 'ops';
  process.env.ORG_REQUEST_RATE_LIMIT_MAX = '100';
  process.env.DEFAULT_TENANT_SLUG = 'default-tenant';
  process.env.TENANT_BASE_DOMAIN = 'lms.test';
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  await admin.tenant.create({ data: { id: 't-op', slug: 'ops', name: 'Operator' } });
  await admin.tenant.create({ data: { id: 't-h', slug: 'harvard', name: 'Harvard' } });
  const user = (id: string, tenantId: string, role: any) =>
    admin.user.create({ data: { id, tenantId, email: `${id}@x.edu`, firstName: id, lastName: 'L', role, passwordHash: bcrypt.hashSync(PASSWORD, 4), emailVerified: true } });
  await user('operator', 't-op', 'SUPER_ADMIN');
  await user('h-super', 't-h', 'SUPER_ADMIN'); // a super administrator, but not of the operator organisation
  await user('h-admin', 't-h', 'TENANT_ADMIN');
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
  mailer = await import('../src/lib/mailer.js');
  ({ config } = await import('../src/config.js'));
}, 240_000);

afterAll(async () => {
  await admin?.$disconnect();
  await db?.stop();
}, 60_000);

beforeEach(() => {
  outbox.length = 0;
  mailer.setMailer({
    async send(m) {
      outbox.push(m);
      allMail.push(m);
    },
  });
});

async function as(who: string, tenant: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').set('x-tenant-id', tenant).send({ email: `${who}@x.edu`, password: PASSWORD });
  expect(res.status, `login as ${who}`).toBe(200);
  return agent;
}

const ask = (slug: string, over: object = {}) => ({
  organizationName: `College ${slug}`,
  slug,
  institutionType: 'COLLEGE',
  country: 'India',
  website: 'https://college.example.edu',
  expectedLearners: 1200,
  contactFirstName: 'Ann',
  contactLastName: 'Lee',
  contactEmail: `Ann@${slug}.edu`,
  acceptTerms: true,
  ...over,
});
const send = (body: object) => request(app).post('/api/v1/organizations/requests').send(body);
const availability = async (slug: string) => (await request(app).get(`/api/v1/organizations/availability?slug=${encodeURIComponent(slug)}`)).body.data;
const requestFor = (slug: string) => admin.organizationRequest.findFirstOrThrow({ where: { slug }, orderBy: { createdAt: 'desc' } });
/** The token in the newest confirmation e-mail to this address. */
const tokenFor = (to: string) => {
  const mail = [...allMail].reverse().find((m) => m.to === to && m.subject === 'Confirm your organisation request');
  expect(mail, `confirmation mail to ${to}`).toBeTruthy();
  return decodeURIComponent(mail!.text.match(/\/register\?confirm=(\S+)/)![1]);
};
const confirm = (token: string) => request(app).post('/api/v1/organizations/requests/confirm').send({ token });
/** Sends a request and confirms it, as an applicant clicking the link would. */
async function submit(slug: string, over: Record<string, unknown> = {}) {
  const body = ask(slug, over);
  expect((await send(body)).status, `request ${slug}`).toBe(201);
  const res = await confirm(tokenFor(String((body as any).contactEmail).toLowerCase()));
  expect(res.status, `confirm ${slug}`).toBe(200);
  return requestFor(slug);
}
const pendingSlugs = async (query = '') => (await (await as('operator', 'ops')).get(`/api/v1/operator/requests${query}`)).body.data.map((r: any) => r.slug);

describe('asking for an organisation', () => {
  it('reports why an address cannot be used, and the address an available one gives', async () => {
    expect(await availability('new-college')).toEqual({ slug: 'new-college', available: true, url: 'http://new-college.lms.test' });
    expect(await availability('ab')).toMatchObject({ available: false, reason: 'invalid' });
    expect(await availability('-bad')).toMatchObject({ available: false, reason: 'invalid' });
    expect(await availability('admin')).toMatchObject({ available: false, reason: 'reserved' });
    expect(await availability('ops')).toMatchObject({ available: false, reason: 'reserved' }); // the operator's own
    expect(await availability('Harvard')).toMatchObject({ slug: 'harvard', available: false, reason: 'taken' });
    expect(await availability('harvard')).not.toHaveProperty('url');
  });

  it('stores an unconfirmed request and e-mails a confirmation link; the operators hear nothing yet', async () => {
    const res = await send(ask('new-college'));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'UNVERIFIED', slug: 'new-college', contactEmail: 'ann@new-college.edu', url: 'http://new-college.lms.test' });
    expect(new Date(res.body.data.confirmBy).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
    const stored = await requestFor('new-college');
    expect(stored).toMatchObject({ status: 'UNVERIFIED', organizationName: 'College new-college', country: 'India', expectedLearners: 1200, contactEmail: 'ann@new-college.edu', verifiedAt: null, holdsSlug: true });

    expect(outbox).toHaveLength(1);
    // The applicant's words stay out of the subject; the body shows the full address the organisation will have.
    expect(outbox[0]).toMatchObject({ to: 'ann@new-college.edu', subject: 'Confirm your organisation request' });
    expect(outbox[0].text).toContain('Requested address: new-college.lms.test');
    expect(outbox[0].text).not.toContain('College new-college');
    const token = tokenFor('ann@new-college.edu');
    // Only the token's hash is stored.
    expect(stored.verificationTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.verificationTokenHash).not.toBe(token);

    expect(await admin.notification.count({ where: { userId: 'operator' } })).toBe(0);
    expect(await admin.auditLog.count({ where: { tenantId: 't-op', action: 'ORGANIZATION_REQUESTED' } })).toBe(0);
    expect(await pendingSlugs()).toEqual([]);
    // It holds the address while the link is valid.
    expect(await availability('new-college')).toMatchObject({ available: false, reason: 'pending' });
  });

  it('confirming sends it to the operators, once', async () => {
    const res = await confirm(tokenFor('ann@new-college.edu'));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ status: 'PENDING', slug: 'new-college', organizationName: 'College new-college', contactEmail: 'ann@new-college.edu', url: 'http://new-college.lms.test' });
    const stored = await requestFor('new-college');
    expect(stored.verifiedAt).not.toBeNull();
    expect(stored.holdExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 3600_000);
    expect(await admin.notification.count({ where: { userId: 'operator', title: 'New organisation request: College new-college', link: '/platform#requests' } })).toBe(1);
    expect(await admin.auditLog.count({ where: { tenantId: 't-op', action: 'ORGANIZATION_REQUESTED' } })).toBe(1);
    expect(await pendingSlugs()).toEqual(['new-college']);

    // The link again: the same answer, nobody told twice.
    expect((await confirm(tokenFor('ann@new-college.edu'))).body.data.status).toBe('PENDING');
    expect(await admin.notification.count({ where: { userId: 'operator' } })).toBe(1);
    expect((await confirm('not-a-real-token-at-all-xxxxxxxx')).status).toBe(400);
    expect((await confirm('short')).status).toBe(400);
  });

  it('refuses a taken, pending, reserved or malformed request', async () => {
    expect((await send(ask('new-college'))).status).toBe(409); // pending
    expect((await send(ask('harvard'))).status).toBe(409);
    expect((await send(ask('platform'))).status).toBe(409);
    expect((await send(ask('x'))).status).toBe(400);
    expect((await send(ask('fine-college', { acceptTerms: false }))).status).toBe(400);
    expect((await send(ask('fine-college', { website: 'http://insecure.example' }))).status).toBe(400);
    expect((await send(ask('fine-college', { institutionType: 'CASTLE' }))).status).toBe(400);
    expect(outbox).toHaveLength(0);
  });

  it('keeps links and odd characters out of names, but takes any script', async () => {
    for (const organizationName of ['Visit www.cheap-pills.example', 'Prizes at https://spam.example', 'Spam <b>now</b>', 'Win $1000!!!', 'Line\nbreak']) {
      expect((await send(ask('fine-college', { organizationName }))).status, organizationName).toBe(400);
    }
    expect((await send(ask('fine-college', { contactFirstName: 'www.spam.example' }))).status).toBe(400);
    expect((await send(ask('fine-college', { contactLastName: 'Lee http://x.example' }))).status).toBe(400);
    expect(outbox).toHaveLength(0);
    const ok = await send(ask('ecole-superieure', { organizationName: "École Supérieure d'Art & Design (Lyon), No. 2", contactFirstName: 'Zoë', contactLastName: "O'Brien-Núñez" }));
    expect(ok.status).toBe(201);
    expect((await send(ask('delhi-vidyalaya', { organizationName: 'दिल्ली विद्यालय' }))).status).toBe(201);
  });

  it('allows a few open requests per e-mail address, besides the limit per network', async () => {
    const email = 'busy@applicant.edu';
    for (const slug of ['busy-one', 'busy-two', 'busy-three']) expect((await send(ask(slug, { contactEmail: email }))).status, slug).toBe(201);
    const fourth = await send(ask('busy-four', { contactEmail: 'BUSY@applicant.edu' }));
    expect(fourth.status).toBe(429);
    expect(await admin.organizationRequest.count({ where: { slug: 'busy-four' } })).toBe(0);
    // A link that lapsed no longer counts.
    await admin.organizationRequest.updateMany({ where: { slug: 'busy-one' }, data: { verificationExpiresAt: new Date(Date.now() - 1000), holdExpiresAt: new Date(Date.now() - 1000) } });
    expect((await send(ask('busy-four', { contactEmail: email }))).status).toBe(201);
  });

  it('an unconfirmed request holds its address only while its link is valid', async () => {
    // busy-one's link lapsed above: the address is free again, someone else takes it, and the old link is refused.
    expect(await availability('busy-one')).toMatchObject({ available: true });
    expect((await send(ask('busy-one', { contactEmail: 'second@applicant.edu' }))).status).toBe(201);
    const lapsed = await admin.organizationRequest.findFirstOrThrow({ where: { slug: 'busy-one', contactEmail: 'busy@applicant.edu' } });
    expect(lapsed.holdsSlug).toBe(false);
    const firstMail = allMail.find((m) => m.to === 'busy@applicant.edu' && m.text.includes('busy-one.lms.test'))!;
    const res = await confirm(decodeURIComponent(firstMail.text.match(/confirm=(\S+)/)![1]));
    expect(res.status).toBe(410);
  });

  it('is refused while registration is closed, or when no confirmation can be sent', async () => {
    config.ORG_REGISTRATION_ENABLED = false;
    try {
      const res = await send(ask('closed-college'));
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Organisation registration is closed');
    } finally {
      config.ORG_REGISTRATION_ENABLED = true;
    }
    mailer.setMailer({ mode: 'discarded', async send() {} });
    expect((await send(ask('mailless-college'))).status).toBe(503);
    mailer.setMailer({ async send() { throw new Error('SMTP down'); } });
    expect((await send(ask('mailless-college'))).status).toBe(503);
    expect(await admin.organizationRequest.count({ where: { slug: 'mailless-college' } })).toBe(0);
  });
});

describe('the platform operator decides', () => {
  it('is for super administrators of the operator organisation only', async () => {
    expect((await (await as('h-super', 'harvard')).get('/api/v1/operator/requests')).status).toBe(403);
    expect((await (await as('h-admin', 'harvard')).get('/api/v1/operator/requests')).status).toBe(403);
    expect((await request(app).get('/api/v1/operator/requests')).status).toBe(401);
  });

  it('lists confirmed pending requests, newest first, a page at a time', async () => {
    await submit('second-college');
    const op = await as('operator', 'ops');
    const list = await op.get('/api/v1/operator/requests');
    expect(list.status).toBe(200);
    expect(list.body.data.map((r: any) => r.slug)).toEqual(['second-college', 'new-college']);
    expect(list.body.data[0]).toMatchObject({ status: 'PENDING', institutionType: 'COLLEGE', contactPhone: null, decidedAt: null, createdTenantId: null, expired: false });
    expect(list.body.data[0].verifiedAt).toBeTruthy();
    expect(list.body.pagination).toEqual({ page: 1, limit: 25, total: 2, totalPages: 1 });
    const second = await op.get('/api/v1/operator/requests?limit=1&page=2');
    expect(second.body.data.map((r: any) => r.slug)).toEqual(['new-college']);
    expect(second.body.pagination).toEqual({ page: 2, limit: 1, total: 2, totalPages: 2 });
    expect((await op.get('/api/v1/operator/requests?limit=1000')).status).toBe(400);
  });

  it('approves: the organisation and its invited administrator exist, and the invitation is sent', async () => {
    const op = await as('operator', 'ops');
    const r = await requestFor('new-college');
    outbox.length = 0;
    const res = await op.post(`/api/v1/operator/requests/${r.id}/approve`).send({ tier: 'PROFESSIONAL', seatQuota: 50, note: 'Welcome' });
    expect(res.status).toBe(200);
    expect(res.body.data.invitation).toBe('sent');
    expect(res.body.data.organization).toMatchObject({ slug: 'new-college', name: 'College new-college', tier: 'PROFESSIONAL', seatQuota: 50, status: 'ACTIVE', seatsUsed: 1 });
    expect(res.body.data.request).toMatchObject({ status: 'APPROVED', decisionNote: 'Welcome', decidedByEmail: 'operator@x.edu', createdTenantId: res.body.data.organization.id });

    const tenantId = res.body.data.organization.id;
    expect(await admin.user.findFirst({ where: { tenantId } })).toMatchObject({ email: 'ann@new-college.edu', role: 'TENANT_ADMIN', status: 'INVITED', passwordHash: null });
    // A new organisation gets the setup checklist; one that existed before does not.
    expect((await admin.tenant.findUniqueOrThrow({ where: { id: tenantId } })).setupChecklist).toBe(true);
    expect((await admin.tenant.findUniqueOrThrow({ where: { id: 't-h' } })).setupChecklist).toBe(false);
    expect((await admin.organizationRequest.findUniqueOrThrow({ where: { id: r.id } })).holdsSlug).toBe(false);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].subject).toBe('College new-college is ready on the learning platform');
    expect(outbox[0].text).toMatch(/http:\/\/new-college\.lms\.test\/reset-password\?token=[\w-]+&invite=1$/m);
    expect(await admin.auditLog.count({ where: { tenantId, action: 'ORGANIZATION_CREATED' } })).toBe(1);
    expect(await admin.auditLog.count({ where: { tenantId: 't-op', action: 'ORGANIZATION_REQUEST_APPROVED' } })).toBe(1);

    // Decided once.
    expect((await op.post(`/api/v1/operator/requests/${r.id}/approve`).send({})).status).toBe(409);
    expect((await op.post(`/api/v1/operator/requests/${r.id}/reject`).send({ reason: 'Changed my mind' })).status).toBe(409);
    expect(await admin.tenant.count({ where: { slug: 'new-college' } })).toBe(1);
    expect(await availability('new-college')).toMatchObject({ reason: 'taken' });
  });

  it('never shows or decides unconfirmed requests', async () => {
    const op = await as('operator', 'ops');
    const unconfirmed = await requestFor('busy-two');
    expect(unconfirmed.status).toBe('UNVERIFIED');
    expect((await op.post(`/api/v1/operator/requests/${unconfirmed.id}/approve`).send({})).status).toBe(404);
    expect((await op.post(`/api/v1/operator/requests/${unconfirmed.id}/reject`).send({ reason: 'Not confirmed yet' })).status).toBe(404);
    expect((await op.get('/api/v1/operator/requests?status=UNVERIFIED')).status).toBe(400);
  });

  it('a failed invitation does not undo an approval: the organisation exists and the request says so', async () => {
    const op = await as('operator', 'ops');
    const r = await submit('mailfail-college');
    mailer.setMailer({ async send() { throw new Error('SMTP down'); } });
    const res = await op.post(`/api/v1/operator/requests/${r.id}/approve`).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.invitation).toBe('failed');
    expect(res.body.data.request).toMatchObject({ status: 'APPROVED', createdTenantId: res.body.data.organization.id });
    expect(await admin.tenant.count({ where: { slug: 'mailfail-college' } })).toBe(1);
  });

  it('a pending request past its 30 days is flagged, frees its address, and an approval that fails is put back', async () => {
    const op = await as('operator', 'ops');
    const stale = await submit('stale-college');
    await admin.organizationRequest.update({ where: { id: stale.id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
    const listed = (await op.get('/api/v1/operator/requests')).body.data.find((x: any) => x.slug === 'stale-college');
    expect(listed).toMatchObject({ status: 'PENDING', expired: true });
    expect(await availability('stale-college')).toMatchObject({ available: true });

    // Someone else asks for the address; the stale request can then no longer be approved, and stays pending.
    await submit('stale-college', { contactEmail: 'rival@stale.edu' });
    const res = await op.post(`/api/v1/operator/requests/${stale.id}/approve`).send({});
    expect(res.status).toBe(409);
    expect(await admin.organizationRequest.findUniqueOrThrow({ where: { id: stale.id } })).toMatchObject({ status: 'PENDING', decidedAt: null, createdTenantId: null });
    expect(await admin.tenant.count({ where: { slug: 'stale-college' } })).toBe(0);
  });

  it('the new administrator activates through the link and lands in the right organisation', async () => {
    const op = await as('operator', 'ops');
    const r = await submit('third-college');
    outbox.length = 0;
    await op.post(`/api/v1/operator/requests/${r.id}/approve`).send({});
    const token = outbox[0].text.match(/token=([\w-]+)/)![1];
    const reset = await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'A-new-password-123' });
    expect(reset.status).toBe(200);
    expect(reset.body.organization).toEqual({ slug: 'third-college', name: 'College third-college', url: 'http://third-college.lms.test' });

    // Each organisation is reached at its own address; the header still wins over the host.
    const login = await request(app).post('/api/v1/auth/login').set('Host', 'third-college.lms.test').send({ email: 'ann@third-college.edu', password: 'A-new-password-123' });
    expect(login.status).toBe(200);
    expect((await request(app).get('/api/v1/tenant/config').set('Host', 'third-college.lms.test')).body.slug).toBe('third-college');
    expect((await request(app).get('/api/v1/tenant/config').set('Host', 'third-college.lms.test').set('x-tenant-id', 'harvard')).body.slug).toBe('harvard');
    // The bare base address names no organisation, and a cookie no longer picks one.
    expect((await request(app).post('/api/v1/auth/login').set('Host', 'lms.test').set('Cookie', 'lms_org=third-college').send({ email: 'ann@third-college.edu', password: 'A-new-password-123' })).status).not.toBe(200);
  });

  it('rejects with a reason the applicant is e-mailed', async () => {
    const op = await as('operator', 'ops');
    const r = await requestFor('second-college');
    expect((await op.post(`/api/v1/operator/requests/${r.id}/reject`).send({ reason: 'no' })).status).toBe(400);
    const res = await op.post(`/api/v1/operator/requests/${r.id}/reject`).send({ reason: 'We only serve accredited institutions.' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'REJECTED', decisionNote: 'We only serve accredited institutions.', createdTenantId: null, expired: false });
    expect(outbox.at(-1)).toMatchObject({ to: 'ann@second-college.edu', subject: 'Your organisation request' });
    expect(outbox.at(-1)!.text).toContain('We only serve accredited institutions.');
    expect(outbox.at(-1)!.text).toContain('Requested address: second-college.lms.test');
    expect((await op.post(`/api/v1/operator/requests/${r.id}/reject`).send({ reason: 'Again, no thanks' })).status).toBe(409);
    expect(await admin.tenant.count({ where: { slug: 'second-college' } })).toBe(0);
    // A rejected request frees the address, and the list by status shows it.
    expect(await availability('second-college')).toMatchObject({ slug: 'second-college', available: true });
    expect(await pendingSlugs('?status=REJECTED')).toEqual(['second-college']);
  });
});

describe('organisations created and suspended by the operator', () => {
  it('may take an address only a request holds; that request is closed and its applicant told', async () => {
    const op = await as('operator', 'ops');
    const held = await submit('held-college');
    expect((await send(ask('held-college', { contactEmail: 'late@held.edu' }))).status).toBe(409); // it is held
    outbox.length = 0;
    const res = await op.post('/api/v1/operator/tenants').send({ name: 'Held College', slug: 'held-college', adminFirstName: 'Cy', adminLastName: 'Dee', adminEmail: 'cy@held.edu' });
    expect(res.status).toBe(201);
    expect(await admin.organizationRequest.findUniqueOrThrow({ where: { id: held.id } })).toMatchObject({ status: 'REJECTED', holdsSlug: false, decisionNote: 'The address was given to another organisation.' });
    const told = outbox.find((m) => m.to === 'ann@held-college.edu');
    expect(told).toMatchObject({ subject: 'Your organisation request' });
    expect(told!.text).toContain('held-college.lms.test');
    // A tenant still blocks: no second organisation at the address.
    expect((await op.post('/api/v1/operator/tenants').send({ name: 'Held Again', slug: 'held-college', adminFirstName: 'A', adminLastName: 'B', adminEmail: 'a@b.edu' })).status).toBe(409);
  });

  it('creates one directly, with an invited administrator', async () => {
    const op = await as('operator', 'ops');
    const res = await op.post('/api/v1/operator/tenants').send({ name: 'Direct Academy', slug: 'direct-academy', customDomain: 'learn.direct.edu', adminFirstName: 'Bo', adminLastName: 'Ray', adminEmail: 'bo@direct.edu' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ invitation: 'sent', organization: { slug: 'direct-academy', customDomain: null, pendingCustomDomain: 'learn.direct.edu', tier: 'STARTER', seatQuota: 100, status: 'ACTIVE' } });
    expect(await admin.user.findFirst({ where: { email: 'bo@direct.edu' } })).toMatchObject({ role: 'TENANT_ADMIN', status: 'INVITED' });
    expect((await op.post('/api/v1/operator/tenants').send({ name: 'Copy', slug: 'direct-academy', adminFirstName: 'A', adminLastName: 'B', adminEmail: 'a@b.edu' })).status).toBe(409);
    expect((await op.post('/api/v1/operator/tenants').send({ name: 'Copy', slug: 'other-academy', customDomain: 'learn.direct.edu', adminFirstName: 'A', adminLastName: 'B', adminEmail: 'a@b.edu' })).status).toBe(409);
    expect((await op.post('/api/v1/operator/tenants').send({ name: 'Copy', slug: 'api', adminFirstName: 'A', adminLastName: 'B', adminEmail: 'a@b.edu' })).status).toBe(409);
    expect((await (await as('h-admin', 'harvard')).post('/api/v1/operator/tenants').send({ name: 'X', slug: 'xx-college', adminFirstName: 'A', adminLastName: 'B', adminEmail: 'a@b.edu' })).status).toBe(403);
  });

  it('suspends and reactivates, but never its own organisation', async () => {
    const op = await as('operator', 'ops');
    const off = await op.patch('/api/v1/operator/tenants/t-h/status').send({ status: 'SUSPENDED' });
    expect(off.status).toBe(200);
    expect(off.body.data.status).toBe('SUSPENDED');
    expect((await request(app).post('/api/v1/auth/login').set('x-tenant-id', 'harvard').send({ email: 'h-admin@x.edu', password: PASSWORD })).status).not.toBe(200);
    expect((await request(app).get('/api/v1/organizations/lookup?slug=harvard')).status).toBe(404);
    const on = await op.patch('/api/v1/operator/tenants/t-h/status').send({ status: 'ACTIVE' });
    expect(on.body.data.status).toBe('ACTIVE');
    expect(await admin.auditLog.count({ where: { tenantId: 't-h', action: { in: ['TENANT_SUSPENDED', 'TENANT_REACTIVATED'] } } })).toBe(2);
    expect((await op.patch('/api/v1/operator/tenants/t-op/status').send({ status: 'SUSPENDED' })).status).toBe(409);
    expect((await op.patch('/api/v1/operator/tenants/t-h/status').send({ status: 'ARCHIVED' })).status).toBe(400);
  });
});

describe('finding an organisation and knowing who operates the platform', () => {
  it('looks up active organisations by address', async () => {
    expect((await request(app).get('/api/v1/organizations/lookup?slug=harvard')).body).toEqual({ data: { slug: 'harvard', name: 'Harvard' } });
    expect((await request(app).get('/api/v1/organizations/lookup?slug=no-such-place')).status).toBe(404);
  });

  it('tells the web app who is a platform operator', async () => {
    expect((await (await as('operator', 'ops')).get('/api/v1/auth/me')).body.user.platformOperator).toBe(true);
    expect((await (await as('h-super', 'harvard')).get('/api/v1/auth/me')).body.user.platformOperator).toBe(false);
    expect((await (await as('h-admin', 'harvard')).get('/api/v1/auth/me')).body.user.platformOperator).toBe(false);
  });
});
