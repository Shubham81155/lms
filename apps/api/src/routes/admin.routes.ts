import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { csvRow } from '../lib/csv';
import { logAuditEvent, pick } from '../lib/audit';
import { authenticateJWT, requireRole, tenantIdOf } from '../middleware/auth';
import { EnrollmentStatus } from '@enterprise-lms/database';
import { HttpError, route } from '../lib/http';
import { httpUrl, idSchema, pageMeta, parseBody, parseQuery } from '../lib/validate';

const router = Router();

router.use(authenticateJWT);

const adminOnly = requireRole('SUPER_ADMIN', 'TENANT_ADMIN');

const color = z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/);

export const updateTenantSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  logoUrl: httpUrl.or(z.literal('')).nullable().optional(),
  primaryColor: color.optional(),
  secondaryColor: color.optional(),
  faviconUrl: httpUrl.or(z.literal('')).nullable().optional(),
  // Rendered into tenant pages, so it is bounded; sanitising it is tracked for the frontend phase.
  ferpaCompliant: z.boolean().optional(),
  coppaCompliant: z.boolean().optional(),
});

export const auditQuery = z
  .object({
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    action: z.string().trim().min(1).max(100).optional(),
    resourceType: z.string().trim().min(1).max(100).optional(),
    userId: idSchema.optional(),
    /** Part of the acting person's e-mail address. */
    actor: z.string().trim().min(1).max(254).optional(),
    resourceId: z.string().trim().min(1).max(200).optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
  })
  .refine((q) => !q.startDate || !q.endDate || q.startDate <= q.endDate, {
    message: 'startDate must not be after endDate',
  });

const TENANT_AUDIT_FIELDS = [
  'name',
  'logoUrl',
  'primaryColor',
  'secondaryColor',
  'faviconUrl',
  'ferpaCompliant',
  'coppaCompliant',
] as const;

/** GET /api/v1/admin/tenant */
router.get(
  '/tenant',
  adminOnly,
  route('Failed to retrieve tenant settings', async (req, res) => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantIdOf(req) },
      include: { _count: { select: { users: true, courses: true, campuses: true, ltiDeployments: true } } },
    });
    if (!tenant) throw new HttpError(404, 'Tenant configuration not found');

    return res.status(200).json({
      data: {
        ...tenant,
        userCount: tenant._count.users,
        courseCount: tenant._count.courses,
        campusCount: tenant._count.campuses,
        ltiDeploymentCount: tenant._count.ltiDeployments,
      },
    });
  })
);

/** PATCH /api/v1/admin/tenant */
router.patch(
  '/tenant',
  adminOnly,
  route('Failed to update tenant settings', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const input = parseBody(req, updateTenantSchema);

    const existing = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!existing) throw new HttpError(404, 'Tenant not found');

    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        name: input.name,
        logoUrl: input.logoUrl !== undefined ? input.logoUrl || null : undefined,
        primaryColor: input.primaryColor,
        secondaryColor: input.secondaryColor,
        faviconUrl: input.faviconUrl !== undefined ? input.faviconUrl || null : undefined,
        ferpaCompliant: input.ferpaCompliant,
        coppaCompliant: input.coppaCompliant,
      },
    });

    await logAuditEvent({
      tenantId,
      userId: req.user!.id,
      action: 'TENANT_SETTINGS_UPDATED',
      resourceType: 'TENANT',
      resourceId: tenantId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: {
        before: pick(existing, TENANT_AUDIT_FIELDS),
        after: pick(updated, TENANT_AUDIT_FIELDS),
      },
    });

    return res.status(200).json({ data: updated });
  })
);

function auditWhere(tenantId: string, q: z.infer<typeof auditQuery>) {
  const where: any = { tenantId };
  if (q.action) where.action = q.action;
  if (q.resourceType) where.resourceType = q.resourceType;
  if (q.resourceId) where.resourceId = q.resourceId;
  if (q.userId) where.userId = q.userId;
  if (q.actor) where.user = { email: { contains: q.actor, mode: 'insensitive' } };
  if (q.startDate || q.endDate) {
    where.createdAt = { ...(q.startDate ? { gte: q.startDate } : {}), ...(q.endDate ? { lte: q.endDate } : {}) };
  }
  return where;
}

const AUDITORS = ['SUPER_ADMIN', 'TENANT_ADMIN', 'AUDITOR'] as const;

/** GET /api/v1/admin/audit-logs/actions: the action names recorded so far, for filtering. */
router.get(
  '/audit-logs/actions',
  requireRole(...AUDITORS),
  route('Failed to list audit actions', async (req, res) => {
    const rows = await prisma.auditLog.groupBy({
      by: ['action'],
      where: { tenantId: tenantIdOf(req) },
      _count: { action: true },
      orderBy: { action: 'asc' },
    });
    return res.json({ data: rows.map((r) => ({ action: r.action, count: r._count.action })) });
  })
);

const EXPORT_MAX = 50_000;
const EXPORT_PAGE = 2_000;

/**
 * GET /api/v1/admin/audit-logs/export.csv: the filtered audit trail as CSV (newest first, at most 50,000
 * rows), streamed in pages. The export itself is audited.
 */
router.get(
  '/audit-logs/export.csv',
  requireRole(...AUDITORS),
  route('Failed to export audit logs', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const q = parseQuery(req, auditQuery);
    const where = auditWhere(tenantId, q);
    await logAuditEvent({
      tenantId,
      userId: req.user!.id,
      action: 'AUDIT_LOG_EXPORTED',
      resourceType: 'AUDIT_LOG',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: { filters: { ...q, page: undefined, limit: undefined } },
    });

    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.write('﻿');
    res.write(csvRow(['time', 'action', 'resource_type', 'resource_id', 'user_email', 'user_role', 'ip_address', 'user_agent', 'details']));
    let cursor: string | undefined;
    for (let sent = 0; sent < EXPORT_MAX;) {
      const batch = await prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: Math.min(EXPORT_PAGE, EXPORT_MAX - sent),
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: { user: { select: { email: true, role: true } } },
      });
      for (const l of batch) {
        res.write(
          csvRow([
            l.createdAt,
            l.action,
            l.resourceType,
            l.resourceId,
            l.user?.email,
            l.user?.role,
            l.ipAddress,
            l.userAgent,
            l.diffJson ? JSON.stringify(l.diffJson) : '',
          ])
        );
      }
      sent += batch.length;
      if (batch.length < EXPORT_PAGE) break;
      cursor = batch[batch.length - 1].id;
    }
    res.end();
  })
);

/** GET /api/v1/admin/audit-logs - administrators and auditors */
router.get(
  '/audit-logs',
  requireRole('SUPER_ADMIN', 'TENANT_ADMIN', 'AUDITOR'),
  route('Failed to retrieve audit logs', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const q = parseQuery(req, auditQuery);
    const { page, limit } = q;
    const where = auditWhere(tenantId, q);

    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, email: true, firstName: true, lastName: true, role: true } } },
      }),
    ]);

    return res.status(200).json({ data: logs, pagination: pageMeta(page, limit, total) });
  })
);

/** GET /api/v1/admin/stats */
router.get(
  '/stats',
  adminOnly,
  route('Failed to retrieve admin stats', async (req, res) => {
    const tenantId = tenantIdOf(req);

    const [totalUsers, totalCourses, totalEnrollments, completedEnrollments, activeEnrollments, roleDistribution] = await Promise.all([
      prisma.user.count({ where: { tenantId } }),
      prisma.course.count({ where: { tenantId } }),
      prisma.enrollment.count({ where: { tenantId } }),
      prisma.enrollment.count({ where: { tenantId, status: EnrollmentStatus.COMPLETED } }),
      prisma.enrollment.count({
        where: { tenantId, status: { in: [EnrollmentStatus.ENROLLED, EnrollmentStatus.IN_PROGRESS] } },
      }),
      prisma.user.groupBy({ by: ['role'], where: { tenantId }, _count: { role: true } }),
    ]);

    const roleCounts = roleDistribution.reduce(
      (acc, curr) => {
        acc[curr.role] = curr._count.role;
        return acc;
      },
      {} as Record<string, number>
    );

    return res.status(200).json({
      data: {
        totalUsers,
        totalCourses,
        totalEnrollments,
        completedEnrollments,
        activeEnrollments,
        completionRate: totalEnrollments > 0 ? parseFloat(((completedEnrollments / totalEnrollments) * 100).toFixed(2)) : 0,
        roleCounts,
      },
    });
  })
);

export default router;
