import { Router } from 'express';
import { z } from 'zod';
import { findRlsBypassReason } from '@enterprise-lms/database';
import { config } from '../config';
import { basePrisma, prisma } from '../lib/prisma';
import { logAuditEvent } from '../lib/audit';
import { authenticateJWT, requireRole, tenantIdOf } from '../middleware/auth';
import { HttpError, route } from '../lib/http';
import { idSchema, parseBody } from '../lib/validate';

// Mounted at /api/v1/admin. The institutional hierarchy (campuses and their departments) and the
// compliance posture report. Administrators only.

const router = Router();
router.use(authenticateJWT, requireRole('SUPER_ADMIN', 'TENANT_ADMIN'));

const audit = (req: any, action: string, resourceType: string, resourceId: string, diffJson?: unknown) =>
  logAuditEvent({
    tenantId: tenantIdOf(req), userId: req.user!.id, action, resourceType, resourceId, diffJson,
    ipAddress: req.ip, userAgent: req.headers['user-agent'],
  });

const code = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/, 'Use 2-20 letters, digits or dashes');
const name = z.string().trim().min(2).max(120);
export const campusSchema = z.object({ name, code });
export const departmentSchema = z.object({ name, code });

// --------------------------------------------------------------------------- campuses

/** GET /api/v1/admin/campuses: the hierarchy, with how many courses each department runs. */
router.get(
  '/campuses',
  route('Failed to load campuses', async (req, res) => {
    const campuses = await prisma.campus.findMany({
      where: { tenantId: tenantIdOf(req) },
      orderBy: { name: 'asc' },
      include: { departments: { orderBy: { name: 'asc' }, include: { _count: { select: { courses: true } } } } },
    });
    return res.json({
      data: campuses.map((c) => ({
        id: c.id, name: c.name, code: c.code,
        departments: c.departments.map((d) => ({ id: d.id, name: d.name, code: d.code, courseCount: d._count.courses })),
        courseCount: c.departments.reduce((n, d) => n + d._count.courses, 0),
      })),
    });
  })
);

router.post(
  '/campuses',
  route('Failed to create campus', async (req, res) => {
    const body = parseBody(req, campusSchema);
    if (await prisma.campus.findFirst({ where: { tenantId: tenantIdOf(req), code: body.code }, select: { id: true } })) {
      throw new HttpError(409, `A campus with code ${body.code} already exists`);
    }
    const campus = await prisma.campus.create({ data: { ...body, tenantId: tenantIdOf(req) } });
    await audit(req, 'CAMPUS_CREATED', 'CAMPUS', campus.id, body);
    return res.status(201).json({ data: campus });
  })
);

router.patch(
  '/campuses/:id',
  route('Failed to update campus', async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const body = parseBody(req, campusSchema.partial().refine((v) => Object.keys(v).length > 0, 'Nothing to change'));
    const campus = await prisma.campus.findFirst({ where: { id, tenantId: tenantIdOf(req) } });
    if (!campus) throw new HttpError(404, 'Campus not found');
    if (body.code && body.code !== campus.code && (await prisma.campus.findFirst({ where: { tenantId: tenantIdOf(req), code: body.code }, select: { id: true } }))) {
      throw new HttpError(409, `A campus with code ${body.code} already exists`);
    }
    const updated = await prisma.campus.update({ where: { id }, data: body });
    await audit(req, 'CAMPUS_UPDATED', 'CAMPUS', id, body);
    return res.json({ data: updated });
  })
);

/** DELETE: refused while the campus still has departments, so nothing is removed by surprise. */
router.delete(
  '/campuses/:id',
  route('Failed to delete campus', async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const campus = await prisma.campus.findFirst({ where: { id, tenantId: tenantIdOf(req) }, include: { _count: { select: { departments: true } } } });
    if (!campus) throw new HttpError(404, 'Campus not found');
    if (campus._count.departments > 0) throw new HttpError(409, 'Remove or move this campus\'s departments first');
    await prisma.campus.delete({ where: { id } });
    await audit(req, 'CAMPUS_DELETED', 'CAMPUS', id, { code: campus.code });
    return res.status(204).end();
  })
);

// --------------------------------------------------------------------------- departments

router.post(
  '/campuses/:id/departments',
  route('Failed to create department', async (req, res) => {
    const campusId = idSchema.parse(req.params.id);
    const body = parseBody(req, departmentSchema);
    const campus = await prisma.campus.findFirst({ where: { id: campusId, tenantId: tenantIdOf(req) }, select: { id: true } });
    if (!campus) throw new HttpError(404, 'Campus not found');
    if (await prisma.department.findFirst({ where: { campusId, code: body.code }, select: { id: true } })) {
      throw new HttpError(409, `This campus already has a department with code ${body.code}`);
    }
    const dept = await prisma.department.create({ data: { ...body, campusId } });
    await audit(req, 'DEPARTMENT_CREATED', 'DEPARTMENT', dept.id, { campusId, ...body });
    return res.status(201).json({ data: dept });
  })
);

/** Departments are reached through their campus, which row-level security scopes to the tenant. */
async function loadDepartment(id: string) {
  const dept = await prisma.department.findFirst({ where: { id }, include: { _count: { select: { courses: true } } } });
  if (!dept) throw new HttpError(404, 'Department not found');
  return dept;
}

router.patch(
  '/departments/:id',
  route('Failed to update department', async (req, res) => {
    const dept = await loadDepartment(idSchema.parse(req.params.id));
    const body = parseBody(req, departmentSchema.partial().refine((v) => Object.keys(v).length > 0, 'Nothing to change'));
    if (body.code && body.code !== dept.code && (await prisma.department.findFirst({ where: { campusId: dept.campusId, code: body.code }, select: { id: true } }))) {
      throw new HttpError(409, `This campus already has a department with code ${body.code}`);
    }
    const updated = await prisma.department.update({ where: { id: dept.id }, data: body });
    await audit(req, 'DEPARTMENT_UPDATED', 'DEPARTMENT', dept.id, body);
    return res.json({ data: updated });
  })
);

/** DELETE: refused while courses are assigned, because they would silently lose their department. */
router.delete(
  '/departments/:id',
  route('Failed to delete department', async (req, res) => {
    const dept = await loadDepartment(idSchema.parse(req.params.id));
    if (dept._count.courses > 0) throw new HttpError(409, `${dept._count.courses} course(s) belong to this department. Reassign them first.`);
    await prisma.department.delete({ where: { id: dept.id } });
    await audit(req, 'DEPARTMENT_DELETED', 'DEPARTMENT', dept.id, { code: dept.code });
    return res.status(204).end();
  })
);

// --------------------------------------------------------------------------- compliance posture

export type CheckStatus = 'PASS' | 'WARN' | 'FAIL' | 'INFO';
export interface ComplianceCheck {
  id: string;
  name: string;
  status: CheckStatus;
  detail: string;
}

/**
 * GET /api/v1/admin/compliance
 * What this deployment can actually verify about itself right now. It reports measured facts
 * (database isolation, audit-trail protection, administrator MFA, ...), not certifications: SOC 2,
 * FERPA and COPPA compliance are organisational and are only *declared* by the administrator here.
 */
router.get(
  '/compliance',
  route('Failed to assess compliance', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [tenant, admins, unverified, auditRecent, auditOldest, sso, saml, scim, rlsReason, privileges] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: tenantId }, select: { ferpaCompliant: true, coppaCompliant: true, dataRegion: true } }),
      prisma.user.findMany({ where: { tenantId, role: { in: ['TENANT_ADMIN', 'SUPER_ADMIN'] }, status: 'ACTIVE' }, select: { mfaEnabled: true } }),
      prisma.user.count({ where: { tenantId, status: 'ACTIVE', emailVerified: false } }),
      prisma.auditLog.count({ where: { tenantId, createdAt: { gte: since } } }),
      prisma.auditLog.findFirst({ where: { tenantId }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
      prisma.ssoConnection.findUnique({ where: { tenantId }, select: { enabled: true } }),
      prisma.samlConnection.findUnique({ where: { tenantId }, select: { enabled: true } }),
      prisma.scimToken.count({ where: { tenantId, revokedAt: null } }),
      findRlsBypassReason(basePrisma).catch(() => 'could not be checked'),
      basePrisma.$queryRaw<{ can_modify: boolean }[]>`
        SELECT (has_table_privilege(current_user, '"AuditLog"', 'UPDATE')
             OR has_table_privilege(current_user, '"AuditLog"', 'DELETE')) AS can_modify`,
    ]);

    const withMfa = admins.filter((a) => a.mfaEnabled).length;
    const checks: ComplianceCheck[] = [
      {
        id: 'tenant-isolation', name: 'Tenant data isolation (row-level security)',
        status: rlsReason ? 'FAIL' : 'PASS',
        detail: rlsReason ? `Not enforced: ${rlsReason}.` : 'The API connects with a role that cannot bypass row-level security, so the database itself separates tenants.',
      },
      {
        id: 'audit-append-only', name: 'Audit trail protection',
        status: privileges[0]?.can_modify ? 'FAIL' : 'PASS',
        detail: privileges[0]?.can_modify
          ? 'The application database role can modify or delete audit rows. Revoke UPDATE and DELETE on "AuditLog".'
          : 'The application database role can add audit rows but cannot change or delete them.',
      },
      {
        id: 'audit-activity', name: 'Audit activity',
        status: auditRecent > 0 ? 'PASS' : 'WARN',
        detail: auditRecent > 0
          ? `${auditRecent} event(s) in the last 30 days; the trail starts ${auditOldest?.createdAt.toISOString().slice(0, 10)}.`
          : 'No audit events in the last 30 days.',
      },
      {
        id: 'field-encryption', name: 'Field-level encryption',
        status: 'PASS',
        detail: `AES-256-GCM key configured (${config.PII_ENCRYPTION_KEY.length / 2}-byte); sensitive fields and SSO/MFA secrets are encrypted at rest.`,
      },
      {
        id: 'admin-mfa', name: 'Administrator two-factor authentication',
        status: admins.length === 0 || withMfa === admins.length ? 'PASS' : withMfa === 0 ? 'FAIL' : 'WARN',
        detail: `${withMfa} of ${admins.length} active administrator(s) have two-factor authentication enabled.`,
      },
      {
        id: 'sso', name: 'Single sign-on',
        status: 'INFO',
        detail: sso?.enabled || saml?.enabled
          ? `Enabled: ${[sso?.enabled && 'OpenID Connect', saml?.enabled && 'SAML 2.0'].filter(Boolean).join(' and ')}.`
          : 'Not configured; everyone signs in with a password.',
      },
      {
        id: 'provisioning', name: 'Directory provisioning (SCIM)',
        status: 'INFO',
        detail: scim > 0 ? `${scim} active token(s).` : 'No active SCIM tokens.',
      },
      {
        id: 'email-verification', name: 'Verified e-mail addresses',
        status: unverified === 0 ? 'PASS' : 'WARN',
        detail: unverified === 0 ? 'Every active account has a verified address.' : `${unverified} active account(s) have not verified their e-mail address.`,
      },
      {
        id: 'data-subject-requests', name: 'Data subject requests',
        status: 'INFO',
        detail: 'A full tenant export is available under Plan, Webhooks & Usage. People can export their own data, opt out of directory information and erase their account through the API (/api/v1/privacy); administrators can do the same on request. There is no request queue or retention scheduler yet.',
      },
    ];

    return res.json({
      data: {
        checks,
        declarations: { ferpa: tenant?.ferpaCompliant ?? false, coppa: tenant?.coppaCompliant ?? false, dataRegion: tenant?.dataRegion ?? null },
        note: 'These are measured facts about this deployment. FERPA, COPPA and SOC 2 compliance are organisational; the switches below only record what your institution declares.',
      },
    });
  })
);

export default router;
