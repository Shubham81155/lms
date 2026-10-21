import crypto from 'crypto';
import { prisma } from './prisma';
import { logger } from './logger';

export const VERBS = {
  completed: { id: 'http://adlnet.gov/expapi/verbs/completed', display: { 'en-US': 'completed' } },
  passed: { id: 'http://adlnet.gov/expapi/verbs/passed', display: { 'en-US': 'passed' } },
  failed: { id: 'http://adlnet.gov/expapi/verbs/failed', display: { 'en-US': 'failed' } },
  attempted: { id: 'http://adlnet.gov/expapi/verbs/attempted', display: { 'en-US': 'attempted' } },
  launched: { id: 'http://adlnet.gov/expapi/verbs/launched', display: { 'en-US': 'launched' } },
} as const;

export interface RecordInput {
  tenantId: string;
  user: { id: string; email: string; firstName?: string; lastName?: string };
  verb: { id: string; display?: Record<string, string> };
  object: { id: string; name?: string; type?: string };
  result?: Record<string, unknown>;
}

/** Statement id is a UUID, as xAPI requires. */
export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/**
 * Stores a system-generated xAPI statement about `user` (exam completion, course completion...).
 * Never throws. Must run inside the tenant context of `tenantId`.
 */
export async function recordStatement(input: RecordInput): Promise<string | null> {
  const id = crypto.randomUUID();
  const timestamp = new Date();
  const statement = {
    id,
    actor: {
      objectType: 'Agent',
      mbox: `mailto:${input.user.email}`,
      ...(input.user.firstName ? { name: `${input.user.firstName} ${input.user.lastName ?? ''}`.trim() } : {}),
    },
    verb: input.verb,
    object: {
      objectType: 'Activity',
      id: input.object.id,
      definition: { ...(input.object.name ? { name: { 'en-US': input.object.name } } : {}), ...(input.object.type ? { type: input.object.type } : {}) },
    },
    ...(input.result ? { result: input.result } : {}),
    timestamp: timestamp.toISOString(),
  };
  try {
    // Children's data (DPDP Act s.9(3)): no learning-activity tracking of a minor without a guardian's consent.
    const person = await prisma.user.findFirst({ where: { id: input.user.id, tenantId: input.tenantId }, select: { isMinor: true, guardianConsentAt: true } });
    if (person?.isMinor && !person.guardianConsentAt) return null;
    await prisma.xapiStatement.create({
      data: {
        id,
        tenantId: input.tenantId,
        actorUserId: input.user.id,
        verbId: input.verb.id,
        objectId: input.object.id,
        statementJson: statement as any,
        timestamp,
      },
    });
    return id;
  } catch (err) {
    logger.warn({ err }, 'xapi statement not recorded');
    return null;
  }
}
