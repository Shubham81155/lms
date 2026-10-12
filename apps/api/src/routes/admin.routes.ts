import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { logAuditEvent } from '../lib/audit';
import { authenticateJWT, requireRole } from '../middleware/auth';
import { EnrollmentStatus } from '@enterprise-lms/database';

const router = Router();

// Restrict all routes in this module to Tenant and Super Admins
router.use(authenticateJWT, requireRole('SUPER_ADMIN', 'TENANT_ADMIN'));

const updateTenantSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  logoUrl: z.string().url().optional().or(z.literal('')).nullable(),
  primaryColor: z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/).optional(),
  secondaryColor: z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/).optional(),
  faviconUrl: z.string().url().optional().or(z.literal('')).nullable(),
  customCss: z.string().optional().nullable(),
  ferpaCompliant: z.boolean().optional(),
  coppaCompliant: z.boolean().optional(),
});

/**
 * GET /api/v1/admin/tenant
 * Retrieve tenant configuration, branding, and high-level entity counts
 */
router.get('/tenant', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || 'default-tenant';

    const tenant = await prisma.tenant.findFirst({
      where: {
        OR: [{ id: tenantId }, { slug: tenantId }],
      },
      include: {
        _count: {
          select: {
            users: true,
            courses: true,
            campuses: true,
            ltiDeployments: true,
          },
        },
      },
    });

    if (!tenant) {
      return res.status(404).json({ error: 'Tenant configuration not found' });
    }

    return res.status(200).json({
      data: {
        ...tenant,
        userCount: tenant._count.users,
        courseCount: tenant._count.courses,
        campusCount: tenant._count.campuses,
        ltiDeploymentCount: tenant._count.ltiDeployments,
      },
    });
  } catch (error: any) {
    console.error('Error in GET /api/v1/admin/tenant:', error);
    return res.status(500).json({ error: 'Failed to retrieve tenant settings' });
  }
});

/**
 * PATCH /api/v1/admin/tenant
 * Update tenant branding and compliance settings
 */
router.patch('/tenant', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || 'default-tenant';
    const currentUserId = req.user!.id;

    const parseResult = updateTenantSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parseResult.error.format(),
      });
    }

    const existingTenant = await prisma.tenant.findFirst({
      where: {
        OR: [{ id: tenantId }, { slug: tenantId }],
      },
    });

    if (!existingTenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const input = parseResult.data;

    const updated = await prisma.tenant.update({
      where: { id: existingTenant.id },
      data: {
        name: input.name,
        logoUrl: input.logoUrl !== undefined ? input.logoUrl : undefined,
        primaryColor: input.primaryColor,
        secondaryColor: input.secondaryColor,
        faviconUrl: input.faviconUrl !== undefined ? input.faviconUrl : undefined,
        customCss: input.customCss !== undefined ? input.customCss : undefined,
        ferpaCompliant: input.ferpaCompliant,
        coppaCompliant: input.coppaCompliant,
      },
    });

    await logAuditEvent({
      tenantId: existingTenant.id,
      userId: currentUserId,
      action: 'TENANT_SETTINGS_UPDATED',
      resourceType: 'TENANT',
      resourceId: existingTenant.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: { before: existingTenant, after: updated },
    });

    return res.status(200).json({ data: updated });
  } catch (error: any) {
    console.error('Error in PATCH /api/v1/admin/tenant:', error);
    return res.status(500).json({ error: 'Failed to update tenant settings' });
  }
});

/**
 * GET /api/v1/admin/audit-logs
 * List tamper-evident audit logs with filters (action, resourceType, date range) & pagination
 */
router.get('/audit-logs', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || 'default-tenant';
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const skip = (page - 1) * limit;

    const action = req.query.action as string | undefined;
    const resourceType = req.query.resourceType as string | undefined;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;

    const where: any = {
      tenantId,
    };

    if (action) {
      where.action = action;
    }

    if (resourceType) {
      where.resourceType = resourceType;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              role: true,
            },
          },
        },
      }),
    ]);

    return res.status(200).json({
      data: logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    console.error('Error in GET /api/v1/admin/audit-logs:', error);
    return res.status(500).json({ error: 'Failed to retrieve audit logs' });
  }
});

/**
 * GET /api/v1/admin/stats
 * Dashboard overview metrics (total users, courses, enrollments, completions, and breakdown)
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || 'default-tenant';

    const [
      totalUsers,
      totalCourses,
      totalEnrollments,
      completedEnrollments,
      activeEnrollments,
      roleDistribution,
    ] = await Promise.all([
      prisma.user.count({ where: { tenantId } }),
      prisma.course.count({ where: { tenantId } }),
      prisma.enrollment.count({ where: { tenantId } }),
      prisma.enrollment.count({
        where: { tenantId, status: EnrollmentStatus.COMPLETED },
      }),
      prisma.enrollment.count({
        where: {
          tenantId,
          status: { in: [EnrollmentStatus.ENROLLED, EnrollmentStatus.IN_PROGRESS] },
        },
      }),
      prisma.user.groupBy({
        by: ['role'],
        where: { tenantId },
        _count: { role: true },
      }),
    ]);

    const roleCounts = roleDistribution.reduce((acc, curr) => {
      acc[curr.role] = curr._count.role;
      return acc;
    }, {} as Record<string, number>);

    const completionRate =
      totalEnrollments > 0
        ? parseFloat(((completedEnrollments / totalEnrollments) * 100).toFixed(2))
        : 0;

    return res.status(200).json({
      data: {
        totalUsers,
        totalCourses,
        totalEnrollments,
        completedEnrollments,
        activeEnrollments,
        completionRate,
        roleCounts,
      },
    });
  } catch (error: any) {
    console.error('Error in GET /api/v1/admin/stats:', error);
    return res.status(500).json({ error: 'Failed to retrieve admin stats' });
  }
});

export default router;
