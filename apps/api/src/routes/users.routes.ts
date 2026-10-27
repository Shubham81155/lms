import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { invalidateSessionCache } from '../lib/session';
import { logAuditEvent, pick } from '../lib/audit';
import { authenticateJWT, requireRole, startSession, tenantIdOf } from '../middleware/auth';
import { GlobalRole, UserStatus } from '@enterprise-lms/database';
import { HttpError, route } from '../lib/http';
import { httpUrl, pageMeta, paginationShape, parseBody, parseQuery } from '../lib/validate';
import { COURSE_STAFF_ROLES, canSeeAllCourses, isAdminRole } from '../lib/access';
import { withSeat } from '../lib/features';
import { sendInvitation } from '../lib/invitations';
import { dispatchWebhook } from '../lib/webhooks';
import { parseCsv } from '../lib/csv';
import { PASSWORDLESS_MESSAGE, mayResetPasswordOf, setPasswordAndRevokeSessions } from '../lib/account-password';
import { createReadStream } from 'fs';
import { rm } from 'fs/promises';
import { linkOrUpload, fileLink } from '../lib/stored-files';
import { receiveUpload, newStorageKey, storage } from '../lib/storage';
import { virusScanner, ScanUnavailableError } from '../lib/virus-scan';
import { verifyPassword, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '../lib/password';

const router = Router();

export const setPasswordSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`).max(PASSWORD_MAX_LENGTH),
});

export const updateUserSchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  avatarUrl: linkOrUpload.or(z.literal('')).nullable().optional(),
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

    let created;
    try {
      created = await withSeat(tenantId, (tx) =>
        tx.user.create({
          data: {
            tenantId,
            email: input.email,
            firstName: input.firstName,
            lastName: input.lastName,
            role: input.role,
            status: 'INVITED',
            passwordHash: null,
            emailVerified: false,
          },
          select: safeUserSelect,
        })
      );
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

// --------------------------------------------------------------------------- bulk import

const IMPORT_MAX_ROWS = 2000;
const HEADER_ALIASES: Record<string, 'email' | 'firstName' | 'lastName' | 'role' | 'courseCode'> = {
  email: 'email',
  'e-mail': 'email',
  first_name: 'firstName',
  firstname: 'firstName',
  'first name': 'firstName',
  given_name: 'firstName',
  last_name: 'lastName',
  lastname: 'lastName',
  'last name': 'lastName',
  family_name: 'lastName',
  surname: 'lastName',
  role: 'role',
  course: 'courseCode',
  course_code: 'courseCode',
  'course code': 'courseCode',
};

export const importSchema = z.object({
  /** CSV text with a header row: email, first_name, last_name, and optionally role and course_code. */
  csv: z.string().min(1).max(2_000_000),
  /** Check every row and report what would happen, without changing anything. */
  dryRun: z.boolean().default(true),
  /** Role for rows without one. */
  defaultRole: z.nativeEnum(GlobalRole).default('STUDENT'),
  sendInvitations: z.boolean().default(true),
});

type ImportStatus = 'CREATE' | 'CREATED' | 'EXISTS' | 'ERROR';
interface ImportRow {
  line: number;
  email: string;
  status: ImportStatus;
  message?: string;
  /** Course code the person is (or would be) enrolled in. */
  enrol?: string;
}

/**
 * POST /api/v1/users/import - invite many people from a CSV file (administrators only).
 * Always validates every row first; with dryRun nothing changes. Otherwise new people are created as INVITED
 * (and sent invitations), and anyone with a course_code is enrolled in that course. People who already exist
 * are not changed, but are still enrolled. The seat quota is checked for the whole file before anything is created.
 */
router.post(
  '/import',
  authenticateJWT,
  requireRole('SUPER_ADMIN', 'TENANT_ADMIN'),
  route('Failed to import people', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const actor = req.user!;
    const input = parseBody(req, importSchema);

    let table: string[][];
    try {
      table = parseCsv(input.csv);
    } catch (e: any) {
      throw new HttpError(400, `The file is not valid CSV: ${e.message}`);
    }
    if (table.length < 2) throw new HttpError(400, 'The file needs a header row and at least one person');
    if (table.length - 1 > IMPORT_MAX_ROWS) throw new HttpError(400, `At most ${IMPORT_MAX_ROWS} people can be imported at once`);

    const columns = table[0].map((h) => HEADER_ALIASES[h.trim().toLowerCase()]);
    for (const needed of ['email', 'firstName', 'lastName'] as const) {
      if (!columns.includes(needed)) throw new HttpError(400, 'The header row needs the columns email, first_name and last_name');
    }
    const col = (row: string[], key: string) => {
      const i = columns.indexOf(key as never);
      return i >= 0 ? (row[i] ?? '').trim() : '';
    };

    const emails = table.slice(1).map((r) => col(r, 'email').toLowerCase());
    const codes = Array.from(
      new Set(
        table
          .slice(1)
          .map((r) => col(r, 'courseCode'))
          .filter(Boolean)
      )
    );
    const [existing, courses] = await Promise.all([
      prisma.user.findMany({ where: { tenantId, email: { in: emails.filter(Boolean) } }, select: { id: true, email: true } }),
      codes.length
        ? prisma.course.findMany({ where: { tenantId, code: { in: codes } }, select: { id: true, code: true } })
        : Promise.resolve([]),
    ]);
    const existingByEmail = new Map(existing.map((u) => [u.email, u.id]));
    const courseByCode = new Map(courses.map((c) => [c.code, c.id]));

    const seen = new Set<string>();
    const rows: (ImportRow & { firstName: string; lastName: string; role: GlobalRole })[] = table.slice(1).map((r, i) => {
      const line = i + 2;
      const email = col(r, 'email').toLowerCase();
      const firstName = col(r, 'firstName');
      const lastName = col(r, 'lastName');
      const roleText = col(r, 'role')
        .toUpperCase()
        .replace(/[\s-]+/g, '_');
      const courseCode = col(r, 'courseCode');
      const base = { line, email, firstName, lastName, role: input.defaultRole, ...(courseCode ? { enrol: courseCode } : {}) };
      const error = (message: string) => ({ ...base, status: 'ERROR' as const, message });

      if (!z.string().email().max(254).safeParse(email).success) return error('Not a valid e-mail address');
      if (seen.has(email)) return error('This e-mail address appears more than once in the file');
      seen.add(email);
      const role = roleText ? (GlobalRole as Record<string, GlobalRole>)[roleText] : input.defaultRole;
      if (!role) return error(`Unknown role "${col(r, 'role')}"`);
      if (role === 'SUPER_ADMIN' && actor.role !== 'SUPER_ADMIN')
        return error('Only a super administrator can grant the super administrator role');
      if (courseCode && !courseByCode.has(courseCode)) return error(`No course with the code "${courseCode}"`);
      if (existingByEmail.has(email))
        return {
          ...base,
          role,
          status: 'EXISTS' as const,
          message: courseCode ? 'Already has an account; will be enrolled' : 'Already has an account',
        };
      if (!firstName || !lastName || firstName.length > 100 || lastName.length > 100)
        return error('First and last name are required (up to 100 characters each)');
      return { ...base, role, status: 'CREATE' as const };
    });

    const toCreate = rows.filter((r) => r.status === 'CREATE');
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { seatQuota: true } });
    if (tenant?.seatQuota != null && toCreate.length > 0) {
      const used = await prisma.user.count({ where: { tenantId, status: { in: ['ACTIVE', 'INVITED'] } } });
      if (used + toCreate.length > tenant.seatQuota) {
        throw new HttpError(
          409,
          `This file adds ${toCreate.length} people, but only ${Math.max(0, tenant.seatQuota - used)} of ${tenant.seatQuota} seats are free`
        );
      }
    }

    let created = 0;
    let enrolled = 0;
    if (!input.dryRun) {
      for (const row of rows) {
        if (row.status === 'ERROR') continue;
        let userId = existingByEmail.get(row.email);
        if (row.status === 'CREATE') {
          try {
            const user = await prisma.user.create({
              data: {
                tenantId,
                email: row.email,
                firstName: row.firstName,
                lastName: row.lastName,
                role: row.role,
                status: 'INVITED',
                passwordHash: null,
                emailVerified: false,
              },
              select: { id: true },
            });
            userId = user.id;
            row.status = 'CREATED';
            created++;
            if (input.sendInvitations) await sendInvitation({ id: user.id, tenantId, email: row.email, firstName: row.firstName });
            void dispatchWebhook(tenantId, 'user.provisioned', { userId: user.id, email: row.email });
          } catch (err: any) {
            row.status = 'ERROR';
            row.message = err?.code === 'P2002' ? 'Already has an account' : 'Could not be created';
            continue;
          }
        }
        const courseId = row.enrol ? courseByCode.get(row.enrol) : undefined;
        if (userId && courseId) {
          const before = await prisma.enrollment.findUnique({ where: { courseId_userId: { courseId, userId } }, select: { status: true } });
          if (!before || before.status === 'DROPPED') {
            await prisma.enrollment.upsert({
              where: { courseId_userId: { courseId, userId } },
              create: { tenantId, courseId, userId, status: 'ENROLLED' },
              update: { status: 'ENROLLED', completedAt: null },
            });
            enrolled++;
          }
        }
      }
      await logAuditEvent({
        tenantId,
        userId: actor.id,
        action: 'USERS_IMPORTED',
        resourceType: 'USER',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        diffJson: {
          rows: rows.length,
          created,
          enrolled,
          errors: rows.filter((r) => r.status === 'ERROR').length,
          invitationsSent: input.sendInvitations,
        },
      });
    }

    return res.json({
      data: {
        dryRun: input.dryRun,
        summary: {
          rows: rows.length,
          toCreate: toCreate.length,
          created,
          existing: rows.filter((r) => r.status === 'EXISTS').length,
          enrolled,
          errors: rows.filter((r) => r.status === 'ERROR').length,
        },
        rows: rows.map(({ line, email, status, message, enrol }) => ({
          line,
          email,
          status,
          message: message ?? null,
          enrol: enrol ?? null,
        })),
      },
    });
  })
);

/** POST /api/v1/users/:id/invite - send a fresh invitation link to someone who has not accepted yet */
router.post(
  '/:id/invite',
  authenticateJWT,
  requireRole('SUPER_ADMIN', 'TENANT_ADMIN'),
  route('Failed to resend invitation', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const target = await prisma.user.findFirst({
      where: { id: String(req.params.id), tenantId },
      select: { id: true, email: true, firstName: true, status: true },
    });
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
    const rawId = String(req.params.id);
    const id = rawId === 'me' ? req.user!.id : rawId;
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
    const rawId = String(req.params.id);
    const id = rawId === 'me' ? req.user!.id : rawId;
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
 * POST /api/v1/users/:id/avatar
 * Uploads a profile picture for oneself or by an administrator.
 */
router.post(
  '/:id/avatar',
  authenticateJWT,
  route('Failed to upload profile picture', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const actor = req.user!;
    const rawId = String(req.params.id);
    const id = rawId === 'me' ? actor.id : rawId;
    const isSelf = actor.id === id;
    const isAdmin = isAdminRole(actor.role);

    if (!isSelf && !isAdmin) throw new HttpError(403, 'Forbidden: Cannot update this user profile picture');

    const existing = await prisma.user.findFirst({ where: { id, tenantId }, select: safeUserSelect });
    if (!existing) throw new HttpError(404, 'User not found');

    const contentType = String(req.headers['content-type'] ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(contentType)) {
      throw new HttpError(415, 'Profile picture must be an image (PNG, JPEG, WebP, or GIF)');
    }

    const { tempPath, sizeBytes, sha256 } = await receiveUpload(req, 5 * 1024 * 1024);
    const storageKey = newStorageKey(tenantId);
    let scannedAt: Date | null = null;
    try {
      const scanner = virusScanner();
      if (scanner) {
        let result;
        try {
          result = await scanner.scan(createReadStream(tempPath));
        } catch (e) {
          if (e instanceof ScanUnavailableError)
            throw new HttpError(503, 'Files cannot be checked for viruses right now. Try again in a few minutes.');
          throw e;
        }
        if (result.infected) {
          await logAuditEvent({
            tenantId,
            userId: actor.id,
            action: 'FILE_MALWARE_BLOCKED',
            resourceType: 'USER_AVATAR',
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
            diffJson: { contentType, sizeBytes, sha256, signature: result.signature },
          });
          throw new HttpError(422, 'This file contains malware and was not uploaded.');
        }
        scannedAt = new Date();
      }
      await storage().putFile(storageKey, tempPath, contentType);
    } finally {
      await rm(tempPath, { force: true });
    }

    let file;
    try {
      file = await prisma.storedFile.create({
        data: {
          tenantId,
          ownerId: id,
          purpose: 'AVATAR',
          storageKey,
          filename: `avatar-${id}.${contentType.split('/')[1] || 'jpg'}`,
          contentType,
          sizeBytes,
          sha256,
          scanStatus: scannedAt ? 'CLEAN' : 'NOT_SCANNED',
          scannedAt,
        },
      });
    } catch (e) {
      await storage()
        .delete(storageKey)
        .catch(() => undefined);
      throw e;
    }

    const newAvatarUrl = fileLink(file.id);
    const updated = await prisma.user.update({
      where: { id },
      data: { avatarUrl: newAvatarUrl },
      select: safeUserSelect,
    });
    invalidateSessionCache(id);

    await logAuditEvent({
      tenantId,
      userId: actor.id,
      action: 'USER_AVATAR_UPDATED',
      resourceType: 'USER',
      resourceId: id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: { before: existing.avatarUrl, after: newAvatarUrl },
    });

    return res.status(200).json({ data: updated, avatarUrl: newAvatarUrl });
  })
);

/**
 * DELETE /api/v1/users/:id/avatar
 * Removes the profile picture for oneself or by an administrator.
 */
router.delete(
  '/:id/avatar',
  authenticateJWT,
  route('Failed to remove profile picture', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const actor = req.user!;
    const rawId = String(req.params.id);
    const id = rawId === 'me' ? actor.id : rawId;
    const isSelf = actor.id === id;
    const isAdmin = isAdminRole(actor.role);

    if (!isSelf && !isAdmin) throw new HttpError(403, 'Forbidden: Cannot update this user');

    const existing = await prisma.user.findFirst({ where: { id, tenantId }, select: safeUserSelect });
    if (!existing) throw new HttpError(404, 'User not found');

    const updated = await prisma.user.update({
      where: { id },
      data: { avatarUrl: null },
      select: safeUserSelect,
    });
    invalidateSessionCache(id);

    await logAuditEvent({
      tenantId,
      userId: actor.id,
      action: 'USER_AVATAR_REMOVED',
      resourceType: 'USER',
      resourceId: id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: { before: existing.avatarUrl, after: null },
    });

    return res.status(200).json({ data: updated, avatarUrl: null });
  })
);

/**
 * POST /api/v1/users/:id/password
 * Changes password for oneself (requires currentPassword if set) or for a user by an admin.
 */
router.post(
  '/:id/password',
  authenticateJWT,
  route('Failed to update password', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const actor = req.user!;
    const rawId = String(req.params.id);
    const id = rawId === 'me' ? actor.id : rawId;
    const isSelf = actor.id === id;
    const isAdmin = isAdminRole(actor.role);

    if (!isSelf && !isAdmin) throw new HttpError(403, 'Forbidden: Cannot change password for this user');

    const { currentPassword, newPassword } = parseBody(req, setPasswordSchema);

    const target = await prisma.user.findFirst({
      where: { id, tenantId },
      select: { id: true, email: true, role: true, passwordHash: true, status: true },
    });
    if (!target) throw new HttpError(404, 'User not found');

    if (isSelf) {
      if (!target.passwordHash) throw new HttpError(409, PASSWORDLESS_MESSAGE);
      if (!currentPassword) throw new HttpError(400, 'Current password is required');
      const check = await verifyPassword(currentPassword, target.passwordHash);
      if (!check.valid) throw new HttpError(400, 'Current password is incorrect');
    } else if (!mayResetPasswordOf(actor.role, target.role)) {
      throw new HttpError(403, 'Forbidden: Only a super admin can change an administrator’s password');
    }

    await setPasswordAndRevokeSessions(id, newPassword);
    if (isSelf) await startSession(res, { id, role: target.role, email: target.email, tenantId });

    await logAuditEvent({
      tenantId,
      userId: actor.id,
      action: 'USER_PASSWORD_CHANGED',
      resourceType: 'USER',
      resourceId: id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: { selfChange: isSelf },
    });

    return res.status(200).json({ success: true, message: 'Password updated successfully' });
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
    const rawId = String(req.params.id);
    const id = rawId === 'me' ? req.user!.id : rawId;
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
        ...(!isSelf && !canSeeAllCourses(actor.role) ? { course: { instructors: { some: { userId: actor.id } } } } : {}),
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
        certificate: { select: { id: true, certificateNumber: true, issuedAt: true, pdfUrl: true } },
      },
    });

    return res.status(200).json({ user, data: enrollments });
  })
);

export default router;
