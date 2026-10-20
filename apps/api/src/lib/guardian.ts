import { z } from 'zod';
import { runWithTenant } from '@enterprise-lms/database';
import { basePrisma, prisma } from './prisma';
import { HttpError } from './http';
import { logAuditEvent } from './audit';
import { mailDelivers, sendMail } from './mailer';
import { generateOneTimeToken, hashOneTimeToken } from './one-time-token';
import { tenantUrl } from './tenant-url';

// Children's data (DPDP Act s.9): a person under 18 (isMinor, set by an administrator or declared by the person)
// needs a parent's or guardian's verifiable consent before agreeing to anything (lib/consent.ts), and camera,
// microphone and snapshot monitoring is refused until it is on file. The guardian gets an e-mailed link with a
// single-use token (only its hash is stored, valid for GUARDIAN_LINK_DAYS) and confirms on a page of the
// organisation's own address; that sets guardianConsentAt and is audited with the guardian's address and browser.

export const GUARDIAN_LINK_DAYS = 7;
/** Requests one person may trigger per day (the guardian's inbox is not ours to flood). */
export const GUARDIAN_REQUESTS_PER_DAY = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface GuardianContext {
  ipAddress?: string;
  userAgent?: string;
}

export const setMinorSchema = z.object({
  isMinor: z.boolean(),
  /** The parent or guardian to ask; can also be given when requesting consent. */
  guardianEmail: z.string().trim().toLowerCase().email().max(320).nullable().optional(),
});
export const guardianRequestSchema = z.object({ guardianEmail: z.string().trim().toLowerCase().email().max(320) });
export const guardianTokenSchema = z.object({ token: z.string().min(20).max(400) });

const audit = (tenantId: string, userId: string | null, action: string, targetId: string, diffJson: Record<string, unknown>, ctx: GuardianContext = {}) =>
  logAuditEvent({ tenantId, userId, action, resourceType: 'USER', resourceId: targetId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, diffJson });

const NOT_VALID = 'This link is not valid or has expired.';

/** The raw link token carries the organisation (not secret) so the public page can find the right records. */
const linkToken = (tenantId: string, token: string) => `${tenantId}.${token}`;
function splitToken(raw: string): { tenantId: string; token: string } {
  const i = raw.indexOf('.');
  if (i < 1 || i === raw.length - 1) throw new HttpError(400, NOT_VALID);
  return { tenantId: raw.slice(0, i), token: raw.slice(i + 1) };
}

export async function minorStatus(tenantId: string, userId: string, now = new Date()) {
  const u = await prisma.user.findFirst({ where: { id: userId, tenantId }, select: { isMinor: true, guardianEmail: true, guardianConsentAt: true } });
  if (!u) throw new HttpError(404, 'User not found');
  const pending = u.isMinor && !u.guardianConsentAt ? await prisma.guardianConsentRequest.findFirst({ where: { tenantId, userId, usedAt: null, expiresAt: { gt: now } }, orderBy: { createdAt: 'desc' }, select: { expiresAt: true } }) : null;
  return {
    isMinor: u.isMinor,
    /** Masked (a***@example.com) so a shared screen does not give the address away. */
    guardianEmail: u.guardianEmail ? u.guardianEmail.replace(/^(.).*(@.*)$/, '$1***$2') : null,
    guardianConsentAt: u.guardianConsentAt?.toISOString() ?? null,
    pendingRequestExpiresAt: pending?.expiresAt.toISOString() ?? null,
  };
}

/**
 * Marks a person as a minor, or (administrators only) clears it. A person can declare themselves a minor but not
 * undo it. Clearing also forgets the guardian's address and consent.
 */
export async function setMinor(tenantId: string, targetId: string, actor: { id: string; admin: boolean }, input: z.infer<typeof setMinorSchema>, ctx: GuardianContext) {
  const u = await prisma.user.findFirst({ where: { id: targetId, tenantId, erasedAt: null }, select: { id: true, email: true, isMinor: true } });
  if (!u) throw new HttpError(404, 'User not found');
  if (!input.isMinor && !actor.admin) throw new HttpError(403, 'Only an administrator can clear the under-18 mark');
  if (input.guardianEmail && input.guardianEmail === u.email.toLowerCase()) throw new HttpError(400, 'The guardian needs a different e-mail address');
  await prisma.user.update({
    where: { id: targetId },
    data: input.isMinor
      ? { isMinor: true, ...(input.guardianEmail !== undefined ? { guardianEmail: input.guardianEmail, guardianConsentAt: null } : {}) }
      : { isMinor: false, guardianEmail: null, guardianConsentAt: null },
  });
  if (!input.isMinor) await prisma.guardianConsentRequest.deleteMany({ where: { tenantId, userId: targetId } });
  await audit(tenantId, actor.id, input.isMinor ? 'MINOR_MARKED' : 'MINOR_CLEARED', targetId, { before: u.isMinor, after: input.isMinor, byAdmin: actor.admin }, ctx);
  return minorStatus(tenantId, targetId);
}

/** Sends the guardian the consent link. Earlier unused links stop working. */
export async function requestGuardianConsent(tenantId: string, userId: string, guardianEmail: string, actor: { id: string }, ctx: GuardianContext, now = new Date()) {
  const u = await prisma.user.findFirst({ where: { id: userId, tenantId, erasedAt: null }, select: { id: true, email: true, firstName: true, isMinor: true, guardianConsentAt: true } });
  if (!u) throw new HttpError(404, 'User not found');
  if (!u.isMinor) throw new HttpError(409, 'This person is not marked as under 18');
  if (u.guardianConsentAt) throw new HttpError(409, 'A guardian has already given consent');
  if (guardianEmail === u.email.toLowerCase()) throw new HttpError(400, 'The guardian needs a different e-mail address');
  const today = await prisma.guardianConsentRequest.count({ where: { tenantId, userId, createdAt: { gt: new Date(now.getTime() - DAY_MS) } } });
  if (today >= GUARDIAN_REQUESTS_PER_DAY) throw new HttpError(429, 'Too many requests today; try again tomorrow');
  if (!mailDelivers()) throw new HttpError(503, 'This platform cannot send e-mail, so a guardian cannot be asked');

  const { token, tokenHash } = generateOneTimeToken();
  // Earlier unused links stop working; the rows stay, so the daily limit still counts them.
  await prisma.guardianConsentRequest.updateMany({ where: { tenantId, userId, usedAt: null }, data: { usedAt: now } });
  await prisma.guardianConsentRequest.create({ data: { tenantId, userId, guardianEmail, tokenHash, expiresAt: new Date(now.getTime() + GUARDIAN_LINK_DAYS * DAY_MS) } });
  await prisma.user.update({ where: { id: userId }, data: { guardianEmail } });

  const t = await basePrisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, slug: true, customDomain: true } });
  if (!t) throw new HttpError(404, 'Organisation not found');
  const link = `${tenantUrl(t)}/guardian-consent?token=${encodeURIComponent(linkToken(tenantId, token))}`;
  await sendMail({
    to: guardianEmail,
    subject: `${t.name}: consent needed for ${u.firstName}`,
    text: `Hello,\n\n${u.firstName} has an account at ${t.name}. Because they are under 18, we need a parent's or guardian's consent before we process their personal data.\n\nPlease read what we collect and why, and give or refuse consent here (the link works once, for ${GUARDIAN_LINK_DAYS} days):\n\n${link}\n\nIf you do not know ${t.name} or ${u.firstName}, ignore this message: nothing happens without your confirmation.\n\n${t.name}`,
  });
  await audit(tenantId, actor.id, 'GUARDIAN_CONSENT_REQUESTED', userId, { requestedBy: actor.id === userId ? 'MINOR' : 'ADMIN' }, ctx);
  return minorStatus(tenantId, userId, now);
}

async function openRequest(raw: string, now: Date) {
  const { tenantId, token } = splitToken(raw);
  const request = await runWithTenant(tenantId, () =>
    prisma.guardianConsentRequest.findFirst({ where: { tenantId, tokenHash: hashOneTimeToken(token), usedAt: null, expiresAt: { gt: now } } })
  );
  if (!request) throw new HttpError(400, NOT_VALID);
  return { tenantId, request };
}

/** What the guardian is asked to confirm; changes nothing (mail scanners open links). */
export async function guardianConsentInfo(raw: string, now = new Date()) {
  const { tenantId, request } = await openRequest(raw, now);
  const info = await runWithTenant(tenantId, async () => {
    const u = await prisma.user.findFirst({ where: { id: request.userId, tenantId }, select: { firstName: true, isMinor: true } });
    const t = await basePrisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
    return u?.isMinor ? { organisation: t?.name ?? '', firstName: u.firstName } : null;
  });
  if (!info) throw new HttpError(400, NOT_VALID);
  return { ...info, expiresAt: request.expiresAt.toISOString() };
}

/** The guardian's confirmation. The link is claimed first, so it works once. */
export async function confirmGuardianConsent(raw: string, ctx: GuardianContext, now = new Date()) {
  const { tenantId, request } = await openRequest(raw, now);
  return runWithTenant(tenantId, async () => {
    const claimed = await prisma.guardianConsentRequest.updateMany({ where: { id: request.id, tenantId, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
    if (claimed.count !== 1) throw new HttpError(400, NOT_VALID);
    const done = await prisma.user.updateMany({ where: { id: request.userId, tenantId, isMinor: true, erasedAt: null }, data: { guardianConsentAt: now, guardianEmail: request.guardianEmail } });
    if (done.count !== 1) throw new HttpError(400, NOT_VALID);
    await audit(tenantId, null, 'GUARDIAN_CONSENT_GIVEN', request.userId, { guardianEmail: request.guardianEmail }, ctx);
    return { confirmedAt: now.toISOString() };
  });
}

/**
 * Camera, microphone and snapshot monitoring (proctoring) of a minor is refused until a guardian consented
 * (DPDP Act s.9(3): no tracking or behavioural monitoring of children without it).
 */
export async function minorMonitoringBlocked(tenantId: string, userId: string): Promise<boolean> {
  const u = await prisma.user.findFirst({ where: { id: userId, tenantId }, select: { isMinor: true, guardianConsentAt: true } });
  return !!u?.isMinor && !u.guardianConsentAt;
}

export const MONITORING_BLOCKED_MESSAGE = 'Camera and microphone monitoring needs a parent or guardian to give consent first';
