import { logger } from './logger';
import { prisma } from './prisma';
import { AuditSanitizer } from '@enterprise-lms/security';

export interface AuditLogOptions {
  tenantId: string;
  userId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  ipAddress?: string;
  userAgent?: string;
  diffJson?: any;
}

export async function logAuditEvent(options: AuditLogOptions) {
  try {
    const sanitizedDiff = options.diffJson
      ? (AuditSanitizer.sanitize(options.diffJson) as any)
      : undefined;

    return await prisma.auditLog.create({
      data: {
        tenantId: options.tenantId,
        userId: options.userId ?? null,
        action: options.action,
        resourceType: options.resourceType,
        resourceId: options.resourceId ?? null,
        ipAddress: options.ipAddress ?? null,
        userAgent: options.userAgent ?? null,
        diffJson: sanitizedDiff ?? null,
      },
    });
  } catch (error) {
    // Avoid failing user requests if audit logging encounters an issue
    logger.error({ err: error }, '[AUDIT_ERROR] Failed to record audit log');
    return null;
  }
}

/**
 * Whitelists the fields recorded in an audit diff, so the log never stores whole records
 * (which can hold PII, large free-text fields, or secrets added to a table later).
 */
export function pick<T extends Record<string, any>, K extends keyof T>(
  source: T | null | undefined,
  keys: readonly K[]
): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  if (!source) return out;
  for (const key of keys) {
    if (key in source) out[key] = source[key];
  }
  return out;
}
