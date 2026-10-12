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
    console.error('[AUDIT_ERROR] Failed to record audit log:', error);
    return null;
  }
}
