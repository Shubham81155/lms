import { z } from 'zod';
import { prisma, runInTenantTransaction } from './prisma';
import { HttpError } from './http';
import { logAuditEvent } from './audit';

// Consent (DPDP Act s.6): an organisation lists the purposes it asks people to agree to, in plain language; each
// person grants or withdraws each one, and every answer is appended to ConsentRecord (never changed or deleted by
// the application). Withdrawing is as easy as giving: one call, effective at once. A purpose marked `required` is
// one the service cannot run without; withdrawing it is allowed, and the answer says what follows (the person may
// ask for erasure; nothing is erased on their behalf). Who answered, from where and with which browser is in the
// audit trail. Changing a purpose's wording or `required` raises its version, so earlier answers stay tied to the
// wording the person saw.

export interface ConsentContext {
  ipAddress?: string;
  userAgent?: string;
}

export const purposeInputSchema = z.object({
  /** Short stable name, lower case (e.g. "marketing"); it identifies the purpose in the API and in records. */
  key: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_-]{1,39}$/, 'Use 2-40 lower-case letters, digits, "-" or "_", starting with a letter'),
  title: z.string().trim().min(2).max(120),
  /** What the data is used for, in words the person understands. */
  description: z.string().trim().min(10).max(2000),
  /** Administrator's note on why this purpose exists and its lawful basis; not shown to people. */
  lawfulBasis: z.string().trim().max(1000).nullable().optional(),
  required: z.boolean().default(false),
  active: z.boolean().default(true),
});
export const savePurposesSchema = z
  .object({ purposes: z.array(purposeInputSchema).min(1).max(30) })
  .refine((b) => new Set(b.purposes.map((p) => p.key)).size === b.purposes.length, { message: 'Each key may appear once' });
export type PurposeInput = z.infer<typeof purposeInputSchema>;

type Purpose = NonNullable<Awaited<ReturnType<typeof prisma.consentPurpose.findFirst>>>;

export const purposeView = (p: Purpose, admin: boolean) => ({
  key: p.key,
  title: p.title,
  description: p.description,
  required: p.required,
  version: p.version,
  ...(admin ? { lawfulBasis: p.lawfulBasis, active: p.active, updatedAt: p.updatedAt.toISOString() } : {}),
});

const snapshotOf = (p: { title: string; description: string }) => `${p.title}\n\n${p.description}`;

const audit = (
  tenantId: string,
  userId: string | null,
  action: string,
  resourceId: string,
  diffJson: Record<string, unknown>,
  ctx: ConsentContext = {}
) =>
  logAuditEvent({
    tenantId,
    userId,
    action,
    resourceType: 'CONSENT_PURPOSE',
    resourceId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    diffJson,
  });

export const listPurposes = (tenantId: string, includeInactive: boolean) =>
  prisma.consentPurpose.findMany({
    where: { tenantId, ...(includeInactive ? {} : { active: true }) },
    orderBy: [{ createdAt: 'asc' }, { key: 'asc' }],
  });

/**
 * Creates or updates purposes by key (purposes not in the list are left alone; switch one off with active: false).
 * Wording or `required` changes raise the version. Returns the organisation's purposes.
 */
export async function savePurposes(tenantId: string, admin: { id: string }, input: PurposeInput[], ctx: ConsentContext) {
  for (const p of input) {
    const existing = await prisma.consentPurpose.findUnique({ where: { tenantId_key: { tenantId, key: p.key } } });
    const lawfulBasis = p.lawfulBasis?.trim() || null;
    if (!existing) {
      const created = await prisma.consentPurpose.create({
        data: { tenantId, key: p.key, title: p.title, description: p.description, lawfulBasis, required: p.required, active: p.active },
      });
      await audit(tenantId, admin.id, 'CONSENT_PURPOSE_CREATED', created.id, { key: p.key, required: p.required, active: p.active }, ctx);
      continue;
    }
    const wordingChanged = existing.title !== p.title || existing.description !== p.description || existing.required !== p.required;
    if (!wordingChanged && existing.active === p.active && existing.lawfulBasis === lawfulBasis) continue;
    const updated = await prisma.consentPurpose.update({
      where: { id: existing.id },
      data: {
        title: p.title,
        description: p.description,
        lawfulBasis,
        required: p.required,
        active: p.active,
        ...(wordingChanged ? { version: { increment: 1 } } : {}),
      },
    });
    await audit(
      tenantId,
      admin.id,
      'CONSENT_PURPOSE_UPDATED',
      existing.id,
      {
        key: p.key,
        before: { title: existing.title, required: existing.required, active: existing.active, version: existing.version },
        after: { title: updated.title, required: updated.required, active: updated.active, version: updated.version },
      },
      ctx
    );
  }
  return listPurposes(tenantId, true);
}

/** What a person has answered for one purpose, from their newest record. */
async function latestFor(tenantId: string, userId: string, keys: string[]) {
  const rows = await prisma.consentRecord.findMany({
    where: { tenantId, userId, purposeKey: { in: keys } },
    orderBy: { createdAt: 'desc' },
    select: { purposeKey: true, version: true, granted: true, createdAt: true },
  });
  const out = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!out.has(r.purposeKey)) out.set(r.purposeKey, r);
  return out;
}

function myView(p: Purpose, last?: { version: number; granted: boolean; createdAt: Date }) {
  return {
    ...purposeView(p, false),
    /** granted, withdrawn, or none (never answered). */
    status: last ? (last.granted ? 'GRANTED' : 'WITHDRAWN') : 'NONE',
    answeredAt: last?.createdAt.toISOString() ?? null,
    /** The person agreed to an older wording: ask again. */
    outdated: !!last && last.granted && last.version < p.version,
  };
}

/** The organisation's active purposes with the caller's answer to each. */
export async function myConsents(tenantId: string, userId: string) {
  const purposes = await listPurposes(tenantId, false);
  const latest = await latestFor(
    tenantId,
    userId,
    purposes.map((p) => p.key)
  );
  return purposes.map((p) => myView(p, latest.get(p.key)));
}

export const REQUIRED_WITHDRAWAL_CONSEQUENCE =
  'This purpose is needed to run your account. Withdrawing it is recorded now, and the organisation may no longer be able to provide the service to you. You can ask for your data to be erased under "Your data requests".';

/**
 * Records the person's answer. A minor needs a guardian's consent on file before agreeing to anything; withdrawing
 * is always allowed. Answering the same way twice appends nothing.
 */
export async function setConsent(tenantId: string, user: { id: string }, key: string, granted: boolean, ctx: ConsentContext) {
  const purpose = await prisma.consentPurpose.findUnique({ where: { tenantId_key: { tenantId, key } } });
  if (!purpose || !purpose.active) throw new HttpError(404, 'Consent purpose not found');
  if (granted) {
    const person = await prisma.user.findFirst({ where: { id: user.id, tenantId }, select: { isMinor: true, guardianConsentAt: true } });
    if (person?.isMinor && !person.guardianConsentAt) throw new HttpError(403, 'A parent or guardian has to give consent for you first');
  }
  const last = (await latestFor(tenantId, user.id, [key])).get(key);
  const unchanged = last && last.granted === granted && (!granted || last.version === purpose.version);
  if (!unchanged) {
    await prisma.consentRecord.create({
      data: {
        tenantId,
        userId: user.id,
        purposeId: purpose.id,
        purposeKey: key,
        version: purpose.version,
        granted,
        textSnapshot: snapshotOf(purpose),
        source: 'USER',
      },
    });
    await audit(
      tenantId,
      user.id,
      granted ? 'CONSENT_GRANTED' : 'CONSENT_WITHDRAWN',
      purpose.id,
      { key, version: purpose.version, required: purpose.required },
      ctx
    );
  }
  const now = (await latestFor(tenantId, user.id, [key])).get(key);
  return { purpose: myView(purpose, now), consequence: !granted && purpose.required ? REQUIRED_WITHDRAWAL_CONSEQUENCE : null };
}

/** The person's full consent history, for the personal-data export. */
export const consentHistory = (tenantId: string, userId: string) =>
  prisma.consentRecord.findMany({
    where: { tenantId, userId },
    orderBy: { createdAt: 'asc' },
    select: { purposeKey: true, version: true, granted: true, textSnapshot: true, source: true, createdAt: true },
  });

/** Per purpose and version: how many people last granted, last withdrew, and (for the current version) never answered. */
export async function consentReport(tenantId: string) {
  const purposes = await listPurposes(tenantId, true);
  const rows = await runInTenantTransaction(
    tenantId,
    (tx) =>
      tx.$queryRaw<{ purposeKey: string; version: number; granted: boolean; n: bigint }[]>`
      SELECT "purposeKey", "version", "granted", COUNT(*) AS n FROM (
        SELECT DISTINCT ON ("userId", "purposeKey") "userId", "purposeKey", "version", "granted"
        FROM "ConsentRecord" WHERE "tenantId" = ${tenantId} ORDER BY "userId", "purposeKey", "createdAt" DESC
      ) latest GROUP BY "purposeKey", "version", "granted"`
  );
  const people = await prisma.user.count({ where: { tenantId, erasedAt: null, status: { in: ['ACTIVE', 'INVITED'] } } });
  return purposes.map((p) => {
    const mine = rows.filter((r) => r.purposeKey === p.key);
    const count = (granted: boolean, version?: number) =>
      mine.filter((r) => r.granted === granted && (version === undefined || r.version === version)).reduce((a, r) => a + Number(r.n), 0);
    const versions = [...new Set(mine.map((r) => r.version))].sort((a, b) => a - b);
    const answered = mine.reduce((a, r) => a + Number(r.n), 0);
    return {
      key: p.key,
      title: p.title,
      required: p.required,
      active: p.active,
      currentVersion: p.version,
      granted: count(true),
      withdrawn: count(false),
      /** Active people with no answer to this purpose at all (people who have since left may still have one). */
      noAnswer: Math.max(0, people - answered),
      byVersion: versions.map((v) => ({ version: v, granted: count(true, v), withdrawn: count(false, v) })),
    };
  });
}
