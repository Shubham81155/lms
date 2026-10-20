import { z } from 'zod';
import type { OperationDoc } from '../docs';
import { fileRequestSchema, fulfilRequestSchema, rejectRequestSchema, requestsQuerySchema, retentionRunSchema, updateRequestSchema } from '../../routes/privacy.routes';
import { retentionPolicySchema } from '../../lib/retention';
import { REQUEST_KINDS, REQUEST_STATUSES } from '../../lib/data-requests';

/** Data-subject requests and data retention (routes/privacy.routes.ts, lib/data-requests.ts, lib/retention.ts). */

const ok = (schema: z.ZodTypeAny, status = 200) => ({ status, schema });
const Pagination = z.object({ page: z.number(), limit: z.number(), total: z.number(), totalPages: z.number() });

/** A request as its requester sees it. */
const MyRequest = z.object({
  id: z.string(),
  kind: z.enum(REQUEST_KINDS),
  status: z.enum(REQUEST_STATUSES),
  details: z.string().nullable(),
  receivedAt: z.string(),
  dueAt: z.string(),
  /** Whole days to the deadline (negative once overdue); null for a closed request. */
  daysLeft: z.number().nullable(),
  overdue: z.boolean(),
  /** What the person is told when it is closed. */
  resolution: z.string().nullable(),
  /** The person can download their data from this request. */
  exportAttached: z.boolean(),
  closedAt: z.string().nullable(),
});

/** The same for administrators, with who filed it and the internal fields. */
const QueueRequest = MyRequest.extend({
  requesterId: z.string(),
  requester: z.object({ name: z.string(), email: z.string().nullable() }).nullable(),
  assignedToId: z.string().nullable(),
  notes: z.string().nullable(),
  closedById: z.string().nullable(),
});

const Counts = z.record(z.string(), z.number());
const RunSummary = z.object({ at: z.string(), dryRun: z.boolean(), counts: Counts, remaining: Counts });

const Policy = z.object({
  enabled: z.boolean(),
  dryRun: z.boolean(),
  notificationsDays: z.number().nullable(),
  tokensDays: z.number().nullable(),
  proctoringDays: z.number().nullable(),
  supportAccessDays: z.number().nullable(),
  infectedFilesDays: z.number().nullable(),
  lastRun: RunSummary.nullable(),
  /** Most rows of one class a run removes. */
  rowCap: z.number(),
  classes: z.array(z.object({ key: z.string(), label: z.string(), min: z.number(), field: z.string(), what: z.string() })),
});

export const DSAR_DOCS: Record<string, OperationDoc> = {
  'POST /api/v1/privacy/requests': {
    summary: 'File a request about your own data: access, erasure, correction, restriction, objection, FERPA directory opt-out or other. It is due in DSAR_DUE_DAYS (30). At most five open requests per person and one per kind (409). You and the administrators are e-mailed. Audited.',
    body: fileRequestSchema,
    response: ok(z.object({ data: MyRequest }), 201),
    errors: [400, 404, 409],
  },
  'GET /api/v1/privacy/requests/mine': {
    summary: 'The requests you filed, newest first (the last 50).',
    response: ok(z.object({ data: z.array(MyRequest) })),
  },
  'POST /api/v1/privacy/requests/:id/cancel': {
    summary: 'Withdraw one of your requests while it is open. Audited.',
    response: ok(z.object({ data: MyRequest })),
    errors: [404, 409],
  },
  'GET /api/v1/privacy/requests/:id/export': {
    summary: 'Download your data (attachment, same file as /privacy/me/export) once an access request of yours was fulfilled with the data attached. 409 for any other request.',
    response: { status: 200, contentType: 'application/json', schema: z.record(z.string(), z.unknown()), description: 'Attachment (personal-data-<id>.json).' },
    errors: [404, 409],
  },
  'GET /api/v1/privacy/requests': {
    summary: "Administrators: the organisation's request queue, most urgent first, with who filed each, filters (status, kind, overdue, assignee) and the number of open and overdue requests.",
    query: requestsQuerySchema,
    response: ok(z.object({ data: z.array(QueueRequest), pagination: Pagination, summary: z.object({ open: z.number(), overdue: z.number() }) })),
    errors: [400],
  },
  'PATCH /api/v1/privacy/requests/:id': {
    summary: 'Administrators: hand a request to an active administrator (a first assignment starts the work and tells the person; null puts it back in the queue) or edit its internal notes. Not for a request you filed yourself (403). Audited.',
    body: updateRequestSchema,
    response: ok(z.object({ data: QueueRequest })),
    errors: [400, 403, 404, 409],
  },
  'POST /api/v1/privacy/requests/:id/fulfil': {
    summary: 'Administrators: close a request as done and carry out what its kind calls for: an access request gets the data attached for download, an erasure request erases the account (409 for the only administrator), a directory opt-out is applied; other kinds are answered by the resolution text (required for OTHER). The person is e-mailed. Not for a request you filed yourself (403). Audited.',
    body: fulfilRequestSchema,
    response: ok(z.object({ data: QueueRequest })),
    errors: [400, 403, 404, 409],
  },
  'POST /api/v1/privacy/requests/:id/reject': {
    summary: 'Administrators: decline a request; the reason is shown to the person and e-mailed. Not for a request you filed yourself (403). Audited.',
    body: rejectRequestSchema,
    response: ok(z.object({ data: QueueRequest })),
    errors: [400, 403, 404, 409],
  },
  'GET /api/v1/privacy/retention': {
    summary: "Administrators: the organisation's data-retention policy (off by default), the classes it can cover with their minimum days, and what the last run did.",
    response: ok(z.object({ data: Policy })),
  },
  'PUT /api/v1/privacy/retention': {
    summary: 'Administrators: set how long each class of data is kept (null leaves a class alone). Grades, certificates, submissions and the audit trail are never touched. While dryRun is true a run only counts. Audited.',
    body: retentionPolicySchema,
    response: ok(z.object({ data: Policy })),
    errors: [400],
  },
  'POST /api/v1/privacy/retention/run': {
    summary: 'Administrators: run the policy now. With dryRun, or while the policy is not enabled, it only counts what it would remove. 409 until a policy has been saved. Audited with the counts.',
    body: retentionRunSchema,
    response: ok(z.object({ data: RunSummary })),
    errors: [400, 409],
  },
};
