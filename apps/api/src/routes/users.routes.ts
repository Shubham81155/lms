import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { logAuditEvent } from '../lib/audit';
import { authenticateJWT, requireRole } from '../middleware/auth';
import { GlobalRole, UserStatus } from '@enterprise-lms/database';

const router = Router();

const updateUserSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().url().optional().or(z.literal('')).nullable(),
  role: z.nativeEnum(GlobalRole).optional(),
  status: z.nativeEnum(UserStatus).optional(),
});

const safeUserSelect = {
  id: true,
  tenantId: true,
  email: true,
  firstName: true,
  lastName: true,
  avatarUrl: true,
  role: true,
  status: true,
  emailVerified: true,
  idpProvider: true,
  mfaEnabled: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
};

/**
 * GET /api/v1/users
 * List users within tenant with pagination, role filtering, and search (ADMIN only)
 */
router.get(
  '/',
  authenticateJWT,
  requireRole('SUPER_ADMIN', 'TENANT_ADMIN'),
  async (req: Request, res: Response) => {
    try {
      const tenantId = String(req.tenantId || req.user?.tenantId || 'default-tenant');
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 10));
      const skip = (page - 1) * limit;

      const search = req.query.search as string | undefined;
      const role = req.query.role as GlobalRole | undefined;
      const status = req.query.status as UserStatus | undefined;

      const where: any = { tenantId };

      if (role) {
        where.role = role;
      }

      if (status) {
        where.status = status;
      }

      if (search) {
        where.OR = [
          { email: { contains: search, mode: 'insensitive' } },
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
        ];
      }

      const [total, users] = await Promise.all([
        prisma.user.count({ where }),
        prisma.user.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          select: {
            ...safeUserSelect,
            _count: {
              select: {
                enrollments: true,
                teachingCourses: true,
              },
            },
          },
        }),
      ]);

      const formatted = users.map((u) => ({
        ...u,
        enrollmentCount: u._count.enrollments,
        teachingCourseCount: u._count.teachingCourses,
      }));

      return res.status(200).json({
        data: formatted,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error: any) {
      console.error('Error in GET /api/v1/users:', error);
      return res.status(500).json({ error: 'Failed to retrieve tenant users' });
    }
  }
);

/**
 * GET /api/v1/users/:id
 * Retrieve user profile (own profile or admin)
 */
router.get('/:id', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const tenantId = String(req.tenantId || req.user?.tenantId || 'default-tenant');
    const id = String(req.params.id);
    const currentUserId = req.user!.id;
    const currentUserRole = req.user!.role;

    const isSelf = currentUserId === id;
    const isAdmin = currentUserRole === 'SUPER_ADMIN' || currentUserRole === 'TENANT_ADMIN';

    if (!isSelf && !isAdmin) {
      return res.status(403).json({ error: 'Forbidden: Access to this profile is restricted' });
    }

    const user = await prisma.user.findFirst({
      where: { id, tenantId },
      select: {
        ...safeUserSelect,
        _count: {
          select: {
            enrollments: true,
            teachingCourses: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.status(200).json({ data: user });
  } catch (error: any) {
    console.error(`Error in GET /api/v1/users/${req.params.id}:`, error);
    return res.status(500).json({ error: 'Failed to retrieve user profile' });
  }
});

/**
 * PATCH /api/v1/users/:id
 * Update user profile
 */
router.patch('/:id', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const tenantId = String(req.tenantId || req.user?.tenantId || 'default-tenant');
    const id = String(req.params.id);
    const currentUserId = req.user!.id;
    const currentUserRole = req.user!.role;

    const isSelf = currentUserId === id;
    const isAdmin = currentUserRole === 'SUPER_ADMIN' || currentUserRole === 'TENANT_ADMIN';

    if (!isSelf && !isAdmin) {
      return res.status(403).json({ error: 'Forbidden: Cannot update this user' });
    }

    const parseResult = updateUserSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parseResult.error.format(),
      });
    }

    const existingUser = await prisma.user.findFirst({
      where: { id, tenantId },
      select: safeUserSelect,
    });

    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const dataToUpdate: any = {};
    const input = parseResult.data;

    if (input.firstName !== undefined) dataToUpdate.firstName = input.firstName;
    if (input.lastName !== undefined) dataToUpdate.lastName = input.lastName;
    if (input.avatarUrl !== undefined) dataToUpdate.avatarUrl = input.avatarUrl;

    // Role and status modifications are strictly reserved for admins
    if (input.role !== undefined) {
      if (!isAdmin) {
        return res.status(403).json({ error: 'Only administrators can modify user roles' });
      }
      dataToUpdate.role = input.role;
    }

    if (input.status !== undefined) {
      if (!isAdmin) {
        return res.status(403).json({ error: 'Only administrators can modify user status' });
      }
      dataToUpdate.status = input.status;
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: dataToUpdate,
      select: safeUserSelect,
    });

    await logAuditEvent({
      tenantId,
      userId: currentUserId,
      action: 'USER_UPDATED',
      resourceType: 'USER',
      resourceId: id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: { before: existingUser, after: updatedUser },
    });

    return res.status(200).json({ data: updatedUser });
  } catch (error: any) {
    console.error(`Error in PATCH /api/v1/users/${req.params.id}:`, error);
    return res.status(500).json({ error: 'Failed to update user profile' });
  }
});

/**
 * GET /api/v1/users/:id/enrollments
 * Get user's enrolled courses
 */
router.get('/:id/enrollments', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const tenantId = String(req.tenantId || req.user?.tenantId || 'default-tenant');
    const id = String(req.params.id);
    const currentUserId = req.user!.id;
    const currentUserRole = req.user!.role;

    const isSelf = currentUserId === id;
    const isStaff = ['INSTRUCTOR', 'TEACHING_ASSISTANT', 'TENANT_ADMIN', 'SUPER_ADMIN'].includes(
      currentUserRole
    );

    if (!isSelf && !isStaff) {
      return res.status(403).json({ error: 'Forbidden: Access to enrollments is restricted' });
    }

    // Verify user exists in tenant
    const user = await prisma.user.findFirst({
      where: { id, tenantId },
      select: { id: true, firstName: true, lastName: true, email: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const enrollments = await prisma.enrollment.findMany({
      where: {
        userId: id,
        tenantId,
      },
      orderBy: { enrolledAt: 'desc' },
      include: {
        course: {
          select: {
            id: true,
            code: true,
            title: true,
            description: true,
            thumbnailUrl: true,
            status: true,
            passingGradePercent: true,
          },
        },
        certificate: {
          select: {
            id: true,
            certificateNumber: true,
            issuedAt: true,
            pdfUrl: true,
          },
        },
      },
    });

    return res.status(200).json({
      user,
      data: enrollments,
    });
  } catch (error: any) {
    console.error(`Error in GET /api/v1/users/${req.params.id}/enrollments:`, error);
    return res.status(500).json({ error: 'Failed to retrieve user enrollments' });
  }
});

export default router;
