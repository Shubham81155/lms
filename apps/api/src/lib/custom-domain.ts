import crypto from 'crypto';
import { Resolver } from 'node:dns/promises';
import type { Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { runWithTenant } from '@enterprise-lms/database';
import { config } from '../config';
import { basePrisma } from './prisma';
import { HttpError } from './http';
import { logAuditEvent } from './audit';
import { rateLimitStore } from './rate-limit-store';
import { baseDomainHost, isUnderBaseDomain, platformHostnames } from './platform-hosts';

// Custom domains with proof of ownership. An organisation (or the platform operator for it) asks for a domain;
// it waits as `pendingCustomDomain` until DNS carries the TXT record `_lms-verify.<domain>` = `lms-verify=<token>`,
// and only then becomes the live `customDomain` that requests resolve by and e-mail links use. A live domain
// stays live while a new one waits, so changing domains never leaves the organisation without one.

export const TXT_LABEL = '_lms-verify';
export const TXT_PREFIX = 'lms-verify=';
/** A pending domain left unverified this long no longer keeps another organisation from asking for it. */
export const PENDING_CLAIM_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A domain an organisation may use. The base domain and its subdomains are the platform's and other
 * organisations' addresses (the API looks a host there up by its subdomain only), and the platform's own
 * hosts are not an organisation's to take.
 */
export const customDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'Enter a domain such as learn.university.edu')
  .refine((d) => !isUnderBaseDomain(d), 'Use a domain of the organisation, not an address under the platform domain')
  .refine((d) => !platformHostnames().includes(d), 'That domain is one of the platform addresses');

export const setDomainSchema = z.object({ domain: customDomainSchema }).strict();
/** `pending` withdraws only the domain waiting for verification; `all` (the default) also removes the live one. */
export const removeDomainQuery = z.object({ scope: z.enum(['all', 'pending']).default('all') });

// --------------------------------------------------------------------------- DNS

/** "Check now" looks DNS up: 20 checks per person per 10 minutes, for administrators and the operator alike. */
export const domainCheckLimiter = rateLimit({
  windowMs: 10 * 60_000,
  limit: 20,
  keyGenerator: (req) => `${(req as Request).user!.tenantId}:${(req as Request).user!.id}`,
  store: rateLimitStore('custom-domain-check'),
  passOnStoreError: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many domain checks. DNS changes take a while to appear; try again in a few minutes.' },
});

/** The lookups verification needs; replaceable in tests (setDnsResolver). */
export interface DnsLookup {
  resolveTxt(name: string): Promise<string[][]>;
  resolveCname(name: string): Promise<string[]>;
  resolve4(name: string): Promise<string[]>;
  resolve6(name: string): Promise<string[]>;
}

let dns: DnsLookup | null = null;
const resolver = (): DnsLookup => (dns ??= new Resolver({ timeout: config.CUSTOM_DOMAIN_DNS_TIMEOUT_MS, tries: 2 }));

/** Replaces the DNS resolver (tests); null goes back to the system's. */
export function setDnsResolver(r: DnsLookup | null) {
  dns = r;
}

class DnsTimeout extends Error {
  code = 'ETIMEOUT';
}

/** The resolver's own timeout covers each try; this bounds the whole lookup, whatever the resolver does. */
function lookup<T>(fn: (r: DnsLookup) => Promise<T>): Promise<T> {
  const ms = config.CUSTOM_DOMAIN_DNS_TIMEOUT_MS * 2;
  let timer: NodeJS.Timeout;
  return Promise.race([
    fn(resolver()),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new DnsTimeout('DNS lookup timed out')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const NOT_FOUND = new Set(['ENODATA', 'ENOTFOUND', 'NXDOMAIN', 'ENONAME']);
const stripDot = (h: string) => h.toLowerCase().replace(/\.$/, '');

export const txtRecordName = (domain: string) => `${TXT_LABEL}.${domain}`;
export const txtRecordValue = (token: string) => `${TXT_PREFIX}${token}`;

export interface TxtCheck {
  ok: boolean;
  /** What is wrong, in words an administrator can act on. */
  error: string | null;
  /** The answer is a definite no (no record, or a different value), not a failed lookup (timeout, SERVFAIL...). */
  definite: boolean;
}

/** Whether DNS carries the proof. */
export async function checkTxt(domain: string, token: string): Promise<TxtCheck> {
  const name = txtRecordName(domain);
  const expected = txtRecordValue(token);
  let records: string[];
  try {
    // A long TXT value can arrive split into several strings: they form one value.
    records = (await lookup((r) => r.resolveTxt(name))).map((chunks) => chunks.join('').trim());
  } catch (err: any) {
    if (NOT_FOUND.has(err?.code))
      return {
        ok: false,
        definite: true,
        error: `No TXT record found at ${name}. DNS changes can take a while to appear; check again later.`,
      };
    if (err?.code === 'ETIMEOUT') return { ok: false, definite: false, error: 'The DNS lookup timed out. Try again in a few minutes.' };
    return { ok: false, definite: false, error: `The DNS lookup failed${err?.code ? ` (${err.code})` : ''}. Try again in a few minutes.` };
  }
  if (records.includes(expected)) return { ok: true, definite: true, error: null };
  return {
    ok: false,
    definite: true,
    error: records.some((v) => v.startsWith(TXT_PREFIX))
      ? `The TXT record at ${name} has a different value. It must be exactly ${expected}.`
      : `The TXT record at ${name} does not contain ${expected}.`,
  };
}

export interface RoutingHint {
  /** CUSTOM_DOMAIN_TARGET, or null when none is configured. */
  target: string | null;
  /** Whether the domain points at the target (a CNAME, or the same addresses); null when there is no target. */
  pointsAtPlatform: boolean | null;
  detail: string;
}

/** Only a hint: whether visitors would reach the platform on the domain. Verification does not depend on it. */
export async function routingHint(domain: string): Promise<RoutingHint> {
  const target = config.CUSTOM_DOMAIN_TARGET ?? null;
  if (!target) return { target, pointsAtPlatform: null, detail: 'Point the domain at the platform as your platform operator tells you.' };
  const quiet = <T>(p: Promise<T[]>) => p.catch(() => [] as T[]);
  const cnames = (await quiet(lookup((r) => r.resolveCname(domain)))).map(stripDot);
  if (cnames.includes(target)) return { target, pointsAtPlatform: true, detail: `${domain} is a CNAME for ${target}.` };
  const [mine4, mine6, theirs4, theirs6] = await Promise.all([
    quiet(lookup((r) => r.resolve4(domain))),
    quiet(lookup((r) => r.resolve6(domain))),
    quiet(lookup((r) => r.resolve4(target))),
    quiet(lookup((r) => r.resolve6(target))),
  ]);
  const theirs = new Set([...theirs4, ...theirs6]);
  if ([...mine4, ...mine6].some((a) => theirs.has(a)))
    return { target, pointsAtPlatform: true, detail: `${domain} resolves to the platform's addresses.` };
  if (!cnames.length && !mine4.length && !mine6.length)
    return { target, pointsAtPlatform: false, detail: `${domain} does not resolve yet. Add a CNAME record pointing at ${target}.` };
  return {
    target,
    pointsAtPlatform: false,
    detail: `${domain} does not point at ${target} yet. Add a CNAME record pointing at ${target} (replacing other records for it).`,
  };
}

// --------------------------------------------------------------------------- state

const select = {
  id: true,
  slug: true,
  status: true,
  customDomain: true,
  customDomainVerifiedAt: true,
  pendingCustomDomain: true,
  customDomainToken: true,
  customDomainRequestedAt: true,
  customDomainCheckedAt: true,
  customDomainError: true,
  customDomainLiveToken: true,
  customDomainRecheckedAt: true,
  customDomainRecheckError: true,
  customDomainFailingSince: true,
} as const;

type DomainRow = {
  slug: string;
  customDomain: string | null;
  customDomainVerifiedAt: Date | null;
  pendingCustomDomain: string | null;
  customDomainToken: string | null;
  customDomainRequestedAt: Date | null;
  customDomainCheckedAt: Date | null;
  customDomainError: string | null;
  customDomainLiveToken: string | null;
  customDomainRecheckedAt: Date | null;
  customDomainRecheckError: string | null;
  customDomainFailingSince: Date | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** When a live domain whose TXT record has been missing since `failingSince` is removed. */
export const removalDate = (failingSince: Date) => new Date(failingSince.getTime() + config.CUSTOM_DOMAIN_RECHECK_GRACE_DAYS * DAY_MS);

/** Fields that reset the re-check state of the live domain (it changed, or was removed). */
export const clearedRecheck = {
  customDomainRecheckedAt: null,
  customDomainRecheckError: null,
  customDomainFailingSince: null,
  customDomainWarnedAt: null,
} as const;

/** What the admin area and the platform console show: the live domain, the one waiting and the exact TXT record. */
export function domainView(t: DomainRow) {
  const base = config.TENANT_BASE_DOMAIN;
  return {
    /** The organisation's address under the platform domain, which always works. */
    subdomain: base ? `${t.slug}.${base}` : null,
    customDomain: t.customDomain,
    verifiedAt: t.customDomainVerifiedAt,
    pending:
      t.pendingCustomDomain && t.customDomainToken
        ? {
            domain: t.pendingCustomDomain,
            txtName: txtRecordName(t.pendingCustomDomain),
            txtValue: txtRecordValue(t.customDomainToken),
            requestedAt: t.customDomainRequestedAt,
            checkedAt: t.customDomainCheckedAt,
            error: t.customDomainError,
          }
        : null,
    /**
     * The periodic re-check of the live domain: its TXT record must stay. Null when there is no live domain, or it
     * was set without verification (it is then not re-checked).
     */
    recheck:
      t.customDomain && t.customDomainLiveToken
        ? {
            txtName: txtRecordName(t.customDomain),
            txtValue: txtRecordValue(t.customDomainLiveToken),
            checkedAt: t.customDomainRecheckedAt,
            /** Why the last re-check failed (a passing DNS problem included), or null. */
            error: t.customDomainRecheckError,
            /** Since when the record has been missing or wrong; null while it is fine. */
            failingSince: t.customDomainFailingSince,
            /** When the domain is removed unless the record is back by then. */
            removesAt: t.customDomainFailingSince ? removalDate(t.customDomainFailingSince) : null,
          }
        : null,
    /** Where to point the domain (CNAME), when the platform says. */
    target: config.CUSTOM_DOMAIN_TARGET ?? null,
  };
}

async function load(tenantId: string) {
  const t = await basePrisma.tenant.findUnique({ where: { id: tenantId }, select });
  if (!t) throw new HttpError(404, 'Organisation not found');
  return t;
}

export async function getDomainState(tenantId: string) {
  return domainView(await load(tenantId));
}

// --------------------------------------------------------------------------- changes

export interface DomainActor {
  /** The acting person's organisation: the target itself, or the platform operator's. */
  tenantId: string;
  userId: string;
  ipAddress?: string;
  userAgent?: string;
}

/** Audited in the organisation's trail and, when the platform operator acts, in the operator's too. */
async function audit(targetId: string, actor: DomainActor, action: string, diffJson: Record<string, unknown>) {
  const entry = { action, resourceType: 'TENANT', resourceId: targetId, ipAddress: actor.ipAddress, userAgent: actor.userAgent, diffJson };
  if (actor.tenantId === targetId)
    return void (await runWithTenant(targetId, () => logAuditEvent({ ...entry, tenantId: targetId, userId: actor.userId })));
  await runWithTenant(actor.tenantId, () => logAuditEvent({ ...entry, tenantId: actor.tenantId, userId: actor.userId }));
  // The operator's user id is not one of the organisation's users.
  await runWithTenant(targetId, () =>
    logAuditEvent({ ...entry, tenantId: targetId, userId: undefined, diffJson: { ...diffJson, by: 'PLATFORM_OPERATOR' } })
  );
}

/** The secret part of the TXT record value. */
export const newDomainToken = () => crypto.randomBytes(16).toString('hex');
const isUniqueViolation = (err: any) => err?.code === 'P2002';
const TAKEN = 'That domain is already used by another organisation';

/**
 * Asks for `domain`: it waits for verification with a new token, replacing any other domain waiting (the live
 * one stays). Asking again for the domain already waiting keeps its token; asking for the live one withdraws
 * the one waiting. 409 when another organisation has it live, or is verifying it and asked within a week.
 */
export async function requestCustomDomain(tenantId: string, domain: string, actor: DomainActor) {
  const t = await load(tenantId);
  if (domain === t.customDomain) {
    if (!t.pendingCustomDomain) return domainView(t);
    return cancelPending(t, actor);
  }
  if (domain === t.pendingCustomDomain) return domainView(t);

  const holder = await basePrisma.tenant.findFirst({
    where: { id: { not: tenantId }, OR: [{ customDomain: domain }, { pendingCustomDomain: domain }] },
    select: { id: true, customDomain: true, customDomainRequestedAt: true },
  });
  if (holder?.customDomain === domain) throw new HttpError(409, TAKEN);
  if (holder) {
    // Someone who asked for a domain and never proved it cannot keep it from its owner for ever.
    const lapsed = !holder.customDomainRequestedAt || holder.customDomainRequestedAt.getTime() < Date.now() - PENDING_CLAIM_MS;
    if (!lapsed) throw new HttpError(409, 'Another organisation is verifying that domain. Ask your platform operator if it is yours.');
    const released = await basePrisma.tenant.updateMany({
      where: { id: holder.id, pendingCustomDomain: domain },
      data: {
        pendingCustomDomain: null,
        customDomainToken: null,
        customDomainRequestedAt: null,
        customDomainCheckedAt: null,
        customDomainError: null,
      },
    });
    if (released.count)
      await runWithTenant(holder.id, () =>
        logAuditEvent({
          tenantId: holder.id,
          action: 'CUSTOM_DOMAIN_REQUEST_LAPSED',
          resourceType: 'TENANT',
          resourceId: holder.id,
          diffJson: { pending: domain, reason: 'requested by another organisation after a week unverified' },
        })
      );
  }

  let saved;
  try {
    saved = await basePrisma.tenant.update({
      where: { id: tenantId },
      data: {
        pendingCustomDomain: domain,
        customDomainToken: newDomainToken(),
        customDomainRequestedAt: new Date(),
        customDomainCheckedAt: null,
        customDomainError: null,
      },
      select,
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, TAKEN);
    throw err;
  }
  await audit(tenantId, actor, 'CUSTOM_DOMAIN_REQUESTED', {
    tenant: t.slug,
    live: t.customDomain,
    before: t.pendingCustomDomain,
    pending: domain,
  });
  return domainView(saved);
}

async function cancelPending(t: Awaited<ReturnType<typeof load>>, actor: DomainActor) {
  const saved = await basePrisma.tenant.update({
    where: { id: t.id },
    data: {
      pendingCustomDomain: null,
      customDomainToken: null,
      customDomainRequestedAt: null,
      customDomainCheckedAt: null,
      customDomainError: null,
    },
    select,
  });
  await audit(t.id, actor, 'CUSTOM_DOMAIN_REQUEST_CANCELLED', { tenant: t.slug, pending: t.pendingCustomDomain, live: t.customDomain });
  return domainView(saved);
}

export interface CheckResult {
  verified: boolean;
  /** The domain checked. */
  domain: string;
  error: string | null;
  routing: RoutingHint;
}

/**
 * Looks the TXT record of the domain waiting up now. Found: it becomes the live domain (replacing the previous
 * one). Not found: it keeps waiting, with the reason saved for the admin area. 409 when nothing is waiting.
 */
export async function verifyCustomDomain(tenantId: string, actor: DomainActor) {
  const t = await load(tenantId);
  const domain = t.pendingCustomDomain;
  const token = t.customDomainToken;
  if (!domain || !token) throw new HttpError(409, 'There is no domain waiting for verification');

  const [txt, routing] = await Promise.all([checkTxt(domain, token), routingHint(domain)]);
  let error = txt.error;
  const now = new Date();
  // Only the request that was checked is changed: a newer request or a removal in the meantime wins.
  const same = { id: tenantId, pendingCustomDomain: domain, customDomainToken: token };
  if (txt.ok) {
    try {
      const moved = await basePrisma.tenant.updateMany({
        where: same,
        data: {
          customDomain: domain,
          customDomainVerifiedAt: now,
          customDomainLiveToken: token,
          ...clearedRecheck,
          customDomainRecheckedAt: now,
          pendingCustomDomain: null,
          customDomainToken: null,
          customDomainRequestedAt: null,
          customDomainCheckedAt: now,
          customDomainError: null,
        },
      });
      if (moved.count) await audit(tenantId, actor, 'CUSTOM_DOMAIN_VERIFIED', { tenant: t.slug, before: t.customDomain, after: domain });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      error = TAKEN;
    }
  }
  if (error) await basePrisma.tenant.updateMany({ where: same, data: { customDomainCheckedAt: now, customDomainError: error } });
  const check: CheckResult = { verified: !error, domain, error, routing };
  return { ...(await getDomainState(tenantId)), check };
}

/** Withdraws the domain waiting and, with scope `all`, the live one too (the organisation keeps its subdomain). */
export async function removeCustomDomain(tenantId: string, scope: 'all' | 'pending', actor: DomainActor) {
  const t = await load(tenantId);
  if (scope === 'pending' || !t.customDomain) return t.pendingCustomDomain ? cancelPending(t, actor) : domainView(t);
  const saved = await basePrisma.tenant.update({
    where: { id: tenantId },
    data: {
      customDomain: null,
      customDomainVerifiedAt: null,
      customDomainLiveToken: null,
      ...clearedRecheck,
      pendingCustomDomain: null,
      customDomainToken: null,
      customDomainRequestedAt: null,
      customDomainCheckedAt: null,
      customDomainError: null,
    },
    select,
  });
  await audit(tenantId, actor, 'CUSTOM_DOMAIN_REMOVED', { tenant: t.slug, live: t.customDomain, pending: t.pendingCustomDomain });
  return domainView(saved);
}

// --------------------------------------------------------------------------- TLS

/**
 * Whether the reverse proxy may get a certificate for `host`: a live custom domain, or `<slug>.<base>` of an
 * existing organisation. Suspended organisations keep theirs (people should see why they cannot sign in);
 * archived ones and pending domains never get one.
 */
export async function tlsAllowed(rawHost: string): Promise<boolean> {
  const host = stripDot(rawHost.trim()).split(':')[0];
  if (!host || host.length > 253) return false;
  const base = baseDomainHost();
  if (base && host.endsWith(`.${base}`)) {
    const slug = host.slice(0, -(base.length + 1));
    if (!slug || slug.includes('.')) return false;
    const t = await basePrisma.tenant.findUnique({ where: { slug }, select: { status: true } });
    return !!t && t.status !== 'ARCHIVED';
  }
  if (isUnderBaseDomain(host)) return false;
  const t = await basePrisma.tenant.findUnique({ where: { customDomain: host }, select: { status: true } });
  return !!t && t.status !== 'ARCHIVED';
}
