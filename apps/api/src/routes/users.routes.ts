import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { invalidateSessionCache } from '../lib/session';
import { logAuditEvent, pick } from '../lib/audit';
import { authenticateJWT, requireRole, tenantIdOf } from '../middleware/auth';
import { GlobalRole, UserStatus } from '@enterprise-lms/database';
import { HttpError, route } from '../lib/http';
import { httpUrl, pageMeta, paginationShape, parseBody, parseQuery } from '../lib/validate';
import { COURSE_STAFF_ROLES, canSeeAllCourses, isAdminRole } from '../lib/access';
import { assertSeatAvailable } from '../lib/features';
import { sendInvitation } from '../lib/invitations';
import { dispatchWebhook } from '../lib/webhooks';

const router = Router();

export const updateUserSchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  avatarUrl: httpUrl.or(z.literal('')).nullable().optional(),
  role: z.nativeEnum(GlobalRole).optional(),
  status: z.nativeEnum(UserStatus).optional(),
});

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  role: z.nativeEnum(GlobalRole).default('STUDENT'),
});

export const listQuery = z.object({
  ...paginationShape,
  role: z.nativeEnum(GlobalRole).optional(),
  status: z.nativeEnum(UserStatus).optional(),
  search: z.string().trim().max(100).optional(),
});

const USER_AUDIT_FIELDS = ['firstName', 'lastName', 'avatarUrl', 'role', 'status'] as const;

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

/** GET /api/v1/users - users of the tenant (admins only) */
router.get(
  '/',
  authenticateJWT,
  requireRole('SUPER_ADMIN', 'TENANT_ADMIN'),
  route('Failed to retrieve tenant users', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const { page, limit, role, status, search } = parseQuery(req, listQuery);

    const where: any = { tenantId };
    if (role) where.role = role;
    if (status) where.status = status;
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
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: { ...safeUserSelect, _count: { select: { enrollments: true, teachingCourses: true } } },
      }),
    ]);

    return res.status(200).json({
      data: users.map((u) => ({
        ...u,
        enrollmentCount: u._count.enrollments,
        teachingCourseCount: u._count.teachingCourses,
      })),
      pagination: pageMeta(page, limit, total),
    });
  })
);

/**
 * POST /api/v1/users - invite a person (administrators only)
 * Creates an INVITED account and emails a link to choose a password; using the link activates it.
 * Counts against the seat quota. Only a SUPER_ADMIN may invite another SUPER_ADMIN.
 */
router.post(
  '/',
  authenticateJWT,
  requireRole('SUPER_ADMIN', 'TENANT_ADMIN'),
  route('Failed to invite user', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const actor = req.user!;
    const input = parseBody(req, inviteSchema);

    if (input.role === 'SUPER_ADMIN' && actor.role !== 'SUPER_ADMIN') {
      throw new HttpError(403, 'Only a super administrator can grant the super administrator role');
    }
    if (await prisma.user.findFirst({ where: { tenantId, email: input.email }, select: { id: true } })) {
      throw new HttpError(409, 'A person with this e-mail address already exists');
    }
    await assertSeatAvailable(tenantId);

    let created;
    try {
      created = await prisma.user.create({
        data: { tenantId, email: input.email, firstName: input.firstName, lastName: input.lastName, role: input.role, status: 'INVITED', passwordHash: null, emailVerified: false },
        select: safeUserSelect,
      });
    } catch (err: any) {
      if (err?.code === 'P2002') throw new HttpError(409, 'A person with this e-mail address already exists');
      throw err;
    }

    const result = await sendInvitation({ id: created.id, tenantId, email: created.email, firstName: created.firstName });
    const invitationSent = result === 'sent';
    await logAuditEvent({
      tenantId,
      userId: actor.id,
      action: 'USER_INVITED',
      resourceType: 'USER',
      resourceId: created.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: { email: created.email, role: created.role, invitationSent },
    });
    void dispatchWebhook(tenantId, 'user.provisioned', { userId: created.id, email: created.email });

    return res.status(201).json({ data: created, invitationSent, emailConfigured: result !== 'not_configured' });
  })
);

/** POST /api/v1/users/:id/invite - send a fresh invitation link to someone who has not accepted yet */
router.post(
  '/:id/invite',
  authenticateJWT,
  requireRole('SUPER_ADMIN', 'TENANT_ADMIN'),
  route('Failed to resend invitation', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const target = await prisma.user.findFirst({ where: { id: String(req.params.id), tenantId }, select: { id: true, email: true, firstName: true, status: true } });
    if (!target) throw new HttpError(404, 'User not found');
    if (target.status !== 'INVITED') throw new HttpError(409, 'Only people who have not yet accepted their invitation can be sent one');

    const result = await sendInvitation({ id: target.id, tenantId, email: target.email, firstName: target.firstName });
    const invitationSent = result === 'sent';
    await logAuditEvent({
      tenantId,
      userId: req.user!.id,
      action: 'USER_INVITATION_RESENT',
      resourceType: 'USER',
      resourceId: target.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: { invitationSent },
    });
    return res.status(200).json({ data: { id: target.id, invitationSent, emailConfigured: result !== 'not_configured' } });
  })
);

/** GET /api/v1/users/:id - own profile, or any profile for admins */
router.get(
  '/:id',
  authenticateJWT,
  route('Failed to retrieve user profile', async (req, res) => {
    const id = String(req.params.id);
    if (req.user!.id !== id && !isAdminRole(req.user!.role)) {
      throw new HttpError(403, 'Forbidden: Access to this profile is restricted');
    }

    const user = await prisma.user.findFirst({
      where: { id, tenantId: tenantIdOf(req) },
      select: { ...safeUserSelect, _count: { select: { enrollments: true, teachingCourses: true } } },
    });
    if (!user) throw new HttpError(404, 'User not found');
    return res.status(200).json({ data: user });
  })
);

/**
 * PATCH /api/v1/users/:id
 * Anyone may edit their own name and avatar. Roles and status are administrator-only, and:
 *  - only a SUPER_ADMIN may grant the SUPER_ADMIN role or change a SUPER_ADMIN's account
 *  - nobody may change their own role or status (no self-promotion, no locking yourself out)
 */
router.patch(
  '/:id',
  authenticateJWT,
  route('Failed to update user profile', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const actor = req.user!;
    const id = String(req.params.id);
    const isSelf = actor.id === id;
    const isAdmin = isAdminRole(actor.role);

    if (!isSelf && !isAdmin) throw new HttpError(403, 'Forbidden: Cannot update this user');
    const input = parseBody(req, updateUserSchema);

    const existing = await prisma.user.findFirst({ where: { id, tenantId }, select: safeUserSelect });
    if (!existing) throw new HttpError(404, 'User not found');

    const data: Record<string, unknown> = {};
    if (input.firstName !== undefined) data.firstName = input.firstName;
    if (input.lastName !== undefined) data.lastName = input.lastName;
    if (input.avatarUrl !== undefined) data.avatarUrl = input.avatarUrl || null;

    if (input.role !== undefined || input.status !== undefined) {
      if (!isAdmin) throw new HttpError(403, 'Only administrators can modify user roles and status');
      if (isSelf) throw new HttpError(403, 'You cannot change your own role or status');

      const touchesSuperAdmin = existing.role === 'SUPER_ADMIN' || input.role === 'SUPER_ADMIN';
      if (touchesSuperAdmin && actor.role !== 'SUPER_ADMIN') {
        throw new HttpError(403, 'Only a super administrator can grant or change the super administrator role');
      }
      if (input.role !== undefined) data.role = input.role;
      if (input.status !== undefined) {
        data.status = input.status;
        if (input.status !== existing.status) data.tokenVersion = { increment: 1 };
      }
    }

    const updated = await prisma.user.update({ where: { id }, data, select: safeUserSelect });
    invalidateSessionCache(id);

    await logAuditEvent({
      tenantId,
      userId: actor.id,
      action: 'USER_UPDATED',
      resourceType: 'USER',
      resourceId: id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: { before: pick(existing, USER_AUDIT_FIELDS), after: pick(updated, USER_AUDIT_FIELDS) },
    });

    return res.status(200).json({ data: updated });
  })
);

/**
 * GET /api/v1/users/:id/enrollments
 * Yourself; admins and auditors for anyone; instructors only the enrollments in courses they teach.
 */
router.get(
  '/:id/enrollments',
  authenticateJWT,
  route('Failed to retrieve user enrollments', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const actor = req.user!;
    const id = String(req.params.id);
    parseQuery(req, z.object({}).passthrough());

    const isSelf = actor.id === id;
    const isCourseStaff = (COURSE_STAFF_ROLES as readonly string[]).includes(actor.role);
    if (!isSelf && !canSeeAllCourses(actor.role) && !isCourseStaff) {
      throw new HttpError(403, 'Forbidden: Access to enrollments is restricted');
    }

    const user = await prisma.user.findFirst({
      where: { id, tenantId },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    if (!user) throw new HttpError(404, 'User not found');

    const enrollments = await prisma.enrollment.findMany({
      where: {
        userId: id,
        tenantId,
        ...(!isSelf && !canSeeAllCourses(actor.role)
          ? { course: { instructors: { some: { userId: actor.id } } } }
          : {}),
      },
      orderBy: { enrolledAt: 'desc' },
      include: {
        course: {
          select: {
            id: true, code: true, title: true, description: true, thumbnailUrl: true, status: true, passingGradePercent: true,
          },
        },
        certificate: { select: { id: true, certificateNumber: true, issuedAt: true, pdfUrl: true } },
      },
    });

    return res.status(200).json({ user, data: enrollments });
  })
);

export default router;
