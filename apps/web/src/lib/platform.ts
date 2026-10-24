// Shapes and small helpers for the platform operator's page (/platform).

import type { Translator } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n-core';

/**
 * The user-facing messages of the helpers below: one source of truth for the catalogue key and the English
 * text. The English-returning helpers read `en`; screens translate through `key` (see platformMessageKey and
 * the `t` variants). {placeholders} are filled by fillTemplate / the translator.
 */
export const PLATFORM_MESSAGES = {
  orgNameMissing: { key: 'site.reg.err.orgName', en: "Enter the organisation's name." },
  orgNameLink: { key: 'site.reg.err.orgNameLink', en: 'Leave web addresses out of the name.' },
  orgNameChars: { key: 'site.reg.err.orgNameChars', en: "Use letters, digits, spaces and . , ' & ( ) - only in the name." },
  personNameMissing: { key: 'site.reg.err.personName', en: "Enter the contact's first and last name." },
  personNameChars: { key: 'site.reg.err.personNameChars', en: "Use letters, spaces and . ' - only in names." },
  inviteSent: { key: 'operator.invite.sent', en: 'An activation e-mail was sent to {email}.' },
  inviteFailed: {
    key: 'operator.invite.failed',
    en: 'The activation e-mail to {email} could not be sent. The organisation exists; resend the invitation once mail works.',
  },
  inviteNotConfigured: {
    key: 'operator.invite.not_configured',
    en: 'This server cannot send e-mail, so {email} was not told. Configure mail (SMTP_URL) and resend the invitation.',
  },
  holdExpired: {
    key: 'operator.req.holdExpired',
    en: 'Expired: waited more than 30 days, so it no longer reserves its address. Approving still works while the address is free.',
  },
  holdUntil: { key: 'operator.req.holdUntil', en: 'Reserves its address until {date}.' },
} as const satisfies Record<string, { key: MessageKey; en: string }>;

export type PlatformMessageId = keyof typeof PLATFORM_MESSAGES;

const fillTemplate = (template: string, vars: Record<string, string>) => template.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);

/** The catalogue key of one of the helpers' fixed English messages (not the ones with {placeholders}), or undefined for any other text. */
export function platformMessageKey(msg: string): MessageKey | undefined {
  for (const m of Object.values(PLATFORM_MESSAGES)) if (m.en === msg && !m.en.includes('{')) return m.key;
  return undefined;
}

export type Tier = 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';
export type OrgStatus = 'ACTIVE' | 'TRIAL' | 'SUSPENDED' | 'ARCHIVED';
export type RequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type InvitationResult = 'sent' | 'failed' | 'not_configured';

export const TIERS: readonly Tier[] = ['STARTER', 'PROFESSIONAL', 'ENTERPRISE'];

export interface Org {
  id: string;
  slug: string;
  name: string;
  /** The live, verified custom domain. */
  customDomain: string | null;
  /** A custom domain waiting for DNS verification; it does not work yet. */
  pendingCustomDomain: string | null;
  tier: Tier;
  status: OrgStatus;
  seatQuota: number | null;
  seatsUsed: number;
  features: Record<string, boolean>;
  overrides: Record<string, boolean>;
  /** When the trial ends (status TRIAL), or null without a trial. */
  trialEndsAt?: string | null;
  /** Set once the trial has ended: the organisation is read-only until `readOnlyUntil`, then suspended. */
  trialExpiredAt?: string | null;
  readOnlyUntil?: string | null;
}

/** The platform's trial defaults: `defaultDays` (ORG_TRIAL_DAYS, 0 = new organisations start active) and the read-only grace after a trial. */
export interface TrialSettings {
  defaultDays: number;
  graceDays: number;
}

/** Where an organisation stands with its trial: none, running, or ended (read-only grace). */
export function trialPhase(o: Pick<Org, 'status' | 'trialEndsAt' | 'trialExpiredAt'>): 'none' | 'running' | 'read-only' {
  if (o.status !== 'TRIAL') return 'none';
  return o.trialExpiredAt ? 'read-only' : 'running';
}

/** Organisations whose running trial ends within `days` days of `now` (the overview's "Trials ending this week"). */
export function trialsEndingWithin(orgs: Org[], days = 7, now = Date.now()): Org[] {
  const until = now + days * 86_400_000;
  return orgs.filter((o) => trialPhase(o) === 'running' && o.trialEndsAt && new Date(o.trialEndsAt).getTime() <= until);
}

export interface OrgRequest {
  id: string;
  organizationName: string;
  slug: string;
  institutionType: string | null;
  country: string | null;
  website: string | null;
  expectedLearners: number | null;
  contactFirstName: string;
  contactLastName: string;
  contactEmail: string;
  contactPhone: string | null;
  message: string | null;
  status: RequestStatus;
  decisionNote: string | null;
  decidedAt: string | null;
  decidedByEmail: string | null;
  createdTenantId: string | null;
  createdAt: string;
  /** When the applicant confirmed their e-mail; only confirmed requests are listed. */
  verifiedAt: string | null;
  /** Until when the request reserves its address. */
  holdExpiresAt: string | null;
  /** Pending past its hold: it no longer keeps others from the address. */
  expired: boolean;
}

/** The API's page information for paged lists. */
export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** What a pending request's hold on its address means for the operator, or null once it is decided. */
export function holdText(r: Pick<OrgRequest, 'status' | 'expired' | 'holdExpiresAt'>): string | null {
  if (r.status !== 'PENDING') return null;
  if (r.expired || !r.holdExpiresAt) return PLATFORM_MESSAGES.holdExpired.en;
  return fillTemplate(PLATFORM_MESSAGES.holdUntil.en, {
    date: new Date(r.holdExpiresAt).toLocaleDateString(undefined, { dateStyle: 'medium' }),
  });
}

/** holdText, translated. */
export function holdMessage(t: Translator, r: Pick<OrgRequest, 'status' | 'expired' | 'holdExpiresAt'>): string | null {
  if (r.status !== 'PENDING') return null;
  if (r.expired || !r.holdExpiresAt) return t(PLATFORM_MESSAGES.holdExpired.key);
  return t(PLATFORM_MESSAGES.holdUntil.key, { date: t.date(r.holdExpiresAt, { dateStyle: 'medium', timeZone: undefined }) });
}

/** Same rule as the API: 3-40 characters, a-z, 0-9 and hyphens, starting and ending with a letter or digit, and not "--" as the third and fourth characters (punycode "xn--" look-alikes). */
export const SLUG_RE = /^(?![a-z0-9]{2}--)[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;

export const isValidSlug = (slug: string) => SLUG_RE.test(slug);

/** A suggested web address from an organisation's name: "St. Mary's College" -> "st-marys-college". */
export function suggestSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

export const tierLabel = (t: string) => t.charAt(0) + t.slice(1).toLowerCase();

/** tierLabel, translated (plans.tier.*), falling back to the English label for an unknown tier. */
export const tierName = (t: Translator, tier: string) => t.dyn(`plans.tier.${tier}`, tierLabel(tier));

/** What an invitation result means for the person who just created an organisation. */
const INVITE_MESSAGE = {
  sent: PLATFORM_MESSAGES.inviteSent,
  failed: PLATFORM_MESSAGES.inviteFailed,
  not_configured: PLATFORM_MESSAGES.inviteNotConfigured,
} as const;

export function invitationMessage(result: InvitationResult | undefined, email: string): string {
  return fillTemplate(INVITE_MESSAGE[result ?? 'not_configured']?.en ?? PLATFORM_MESSAGES.inviteNotConfigured.en, { email });
}

/** invitationMessage, translated. */
export function invitationText(t: Translator, result: InvitationResult | undefined, email: string): string {
  const m = INVITE_MESSAGE[result ?? 'not_configured'] ?? PLATFORM_MESSAGES.inviteNotConfigured;
  return t(m.key, { email });
}

export interface PlatformSummary {
  organisations: number;
  byStatus: Record<OrgStatus, number>;
  seatsUsed: number;
  pending: number;
}

/** `pendingTotal`: the API's count of pending requests, when the list is only its first page. */
export function summarise(orgs: Org[], pendingRequests: OrgRequest[], pendingTotal?: number): PlatformSummary {
  const byStatus: Record<OrgStatus, number> = { ACTIVE: 0, TRIAL: 0, SUSPENDED: 0, ARCHIVED: 0 };
  for (const o of orgs) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
  return {
    organisations: orgs.length,
    byStatus,
    seatsUsed: orgs.reduce((n, o) => n + (o.seatsUsed ?? 0), 0),
    pending: pendingTotal ?? pendingRequests.filter((r) => r.status === 'PENDING').length,
  };
}

const hasLink = (v: string) => v.includes('://') || /www\./i.test(v);

/** Same rule as the API for an organisation's name: letters in any script, digits, spaces and . , ' & ( ) - but no web addresses. */
export function orgNameProblem(name: string): string | null {
  const v = name.trim();
  if (v.length < 2) return PLATFORM_MESSAGES.orgNameMissing.en;
  if (hasLink(v)) return PLATFORM_MESSAGES.orgNameLink.en;
  if (!/^[\p{L}\p{M}\p{N} .,'’&()-]+$/u.test(v)) return PLATFORM_MESSAGES.orgNameChars.en;
  return null;
}

/** Same rule as the API for a contact's first or last name: letters, spaces and . ' - but no web addresses. */
export function personNameProblem(name: string): string | null {
  const v = name.trim();
  if (!v) return PLATFORM_MESSAGES.personNameMissing.en;
  if (hasLink(v) || !/^[\p{L}\p{M} .'’-]+$/u.test(v)) return PLATFORM_MESSAGES.personNameChars.en;
  return null;
}
