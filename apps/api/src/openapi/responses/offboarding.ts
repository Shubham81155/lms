import { z } from 'zod';
import type { OperationDoc } from '../docs';
import { deletionSchema } from '../../routes/offboarding.routes';

/** Organisation offboarding (routes/offboarding.routes.ts): full exports and scheduled deletion. */

const ok = (schema: z.ZodTypeAny, status = 200) => ({ status, schema });

const TenantExportJob = z.object({
  id: z.string(),
  tenantId: z.string(),
  status: z.enum(['QUEUED', 'RUNNING', 'READY', 'FAILED', 'EXPIRED']),
  /** Taken by the deletion job just before the organisation was deleted; only the platform operator sees it. */
  isFinal: z.boolean(),
  sizeBytes: z.number().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  /** The file is removed after this (7 days; 90 for a final export). */
  expiresAt: z.string().nullable(),
  error: z.string().nullable(),
});

const OffboardingState = z.object({
  tenantId: z.string(),
  slug: z.string(),
  name: z.string(),
  /** False for the platform operator's own organisation, which can never be deleted. */
  deletable: z.boolean(),
  /** Days between scheduling a deletion and carrying it out. */
  graceDays: z.number(),
  deletion: z
    .object({
      scheduledAt: z.string(),
      requestedAt: z.string().nullable(),
      requestedBy: z.string().nullable(),
      byOperator: z.boolean(),
      /** Whether the caller may cancel it (a deletion the operator scheduled: only the operator). */
      canCancel: z.boolean(),
    })
    .nullable(),
  /** The 20 most recent exports, newest first. */
  exports: z.array(TenantExportJob),
});

const OffboardingOverview = z.object({
  scheduled: z.array(
    z.object({ tenantId: z.string(), slug: z.string(), name: z.string(), scheduledAt: z.string(), requestedBy: z.string().nullable(), byOperator: z.boolean() })
  ),
  deleted: z.array(
    z.object({
      id: z.string(),
      tenantId: z.string(),
      slug: z.string(),
      name: z.string(),
      deletedAt: z.string(),
      requestedBy: z.string().nullable(),
      /** Nobody can take the address until then. */
      slugHeldUntil: z.string(),
      /** Rows deleted per table, and stored files removed. */
      summary: z.unknown(),
      finalExport: TenantExportJob.nullable(),
    })
  ),
});

const zip = { status: 200, contentType: 'application/zip', schema: z.string(), description: 'The ZIP (attachment). With S3 storage the answer is instead a 302 to a link valid for 5 minutes.' };

export const OFFBOARDING_DOCS: Record<string, OperationDoc> = {
  'GET /api/v1/admin/offboarding': {
    summary: "Administrators: the organisation's scheduled deletion (if any) and its 20 most recent full exports.",
    response: ok(z.object({ data: OffboardingState })),
    errors: [404],
  },
  'POST /api/v1/admin/offboarding/export': {
    summary: 'Administrators: queue a full export: a ZIP of every table of the organisation (JSON lines) and its stored files, without passwords, tokens, secrets or keys. A background job builds it; it can be downloaded for 7 days. Audited. 409 while one is already being prepared.',
    response: ok(z.object({ data: TenantExportJob }), 202),
    errors: [404, 409],
  },
  'GET /api/v1/admin/offboarding/export/:id/download': {
    summary: "Administrators: download a ready export of their organisation. Audited. 409 while it is being built, 410 once expired.",
    response: zip,
    errors: [404, 409, 410],
  },
  'POST /api/v1/admin/offboarding/deletion': {
    summary: "Administrators: schedule the organisation and all its data for deletion in ORG_DELETION_GRACE_DAYS (30 by default). `confirmSlug` must be the organisation's address. It stays usable until then and the administrators are e-mailed; a final export is taken before the deletion. Not the platform operator's organisation (409). Audited.",
    body: deletionSchema,
    response: ok(z.object({ data: OffboardingState })),
    errors: [400, 404, 409],
  },
  'DELETE /api/v1/admin/offboarding/deletion': {
    summary: 'Administrators: cancel the scheduled deletion (403 when the platform operator scheduled it). Administrators are e-mailed. Audited.',
    response: ok(z.object({ data: OffboardingState })),
    errors: [404, 409],
  },
  'GET /api/v1/operator/offboarding': {
    summary: 'Platform operator: organisations scheduled for deletion, and the deleted ones with their final export and how long their address stays reserved.',
    response: ok(z.object({ data: OffboardingOverview })),
  },
  'GET /api/v1/operator/tenants/:id/offboarding': {
    summary: "Platform operator: an organisation's scheduled deletion and exports, final ones included (as GET /admin/offboarding).",
    response: ok(z.object({ data: OffboardingState })),
    errors: [404],
  },
  'POST /api/v1/operator/tenants/:id/export': {
    summary: 'Platform operator: queue a full export of an organisation (as POST /admin/offboarding/export). Audited in both trails.',
    response: ok(z.object({ data: TenantExportJob }), 202),
    errors: [404, 409],
  },
  'POST /api/v1/operator/tenants/:id/deletion': {
    summary: "Platform operator: schedule an organisation's deletion (as POST /admin/offboarding/deletion); only the operator can cancel it. Never the operator's own organisation. Audited in both trails.",
    body: deletionSchema,
    response: ok(z.object({ data: OffboardingState })),
    errors: [400, 404, 409],
  },
  'DELETE /api/v1/operator/tenants/:id/deletion': {
    summary: "Platform operator: cancel an organisation's scheduled deletion. Audited in both trails.",
    response: ok(z.object({ data: OffboardingState })),
    errors: [404, 409],
  },
  'GET /api/v1/operator/exports/:exportId/download': {
    summary: 'Platform operator: download any ready export, including the final export of a deleted organisation. Audited.',
    response: zip,
    errors: [404, 409, 410],
  },
};
