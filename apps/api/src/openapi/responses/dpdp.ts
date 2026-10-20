import { z } from 'zod';
import type { OperationDoc } from '../docs';
import { breachQuerySchema, BREACH_SEVERITIES, BREACH_STATUSES, createBreachSchema, updateBreachSchema } from '../../lib/breaches';
import { savePurposesSchema } from '../../lib/consent';
import { guardianRequestSchema, guardianTokenSchema, setMinorSchema } from '../../lib/guardian';
import { grievanceOfficerSchema } from '../../routes/dpdp.routes';

/** DPDP Act readiness: consent, breach register, grievance officer, guardian consent (routes/dpdp.routes.ts). */

const ok = (schema: z.ZodTypeAny, status = 200) => ({ status, schema });

const MyConsent = z.object({
  key: z.string(),
  title: z.string(),
  description: z.string(),
  required: z.boolean(),
  version: z.number(),
  /** GRANTED, WITHDRAWN, or NONE (never answered). */
  status: z.enum(['GRANTED', 'WITHDRAWN', 'NONE']),
  answeredAt: z.string().nullable(),
  /** Agreed to an older wording: ask again. */
  outdated: z.boolean(),
});

const AdminPurpose = z.object({
  key: z.string(),
  title: z.string(),
  description: z.string(),
  required: z.boolean(),
  version: z.number(),
  lawfulBasis: z.string().nullable(),
  active: z.boolean(),
  updatedAt: z.string(),
});

const ConsentReportRow = z.object({
  key: z.string(),
  title: z.string(),
  required: z.boolean(),
  active: z.boolean(),
  currentVersion: z.number(),
  granted: z.number(),
  withdrawn: z.number(),
  noAnswer: z.number(),
  byVersion: z.array(z.object({ version: z.number(), granted: z.number(), withdrawn: z.number() })),
});

const Breach = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  categories: z.array(z.string()),
  affectedEstimate: z.number().nullable(),
  severity: z.enum(BREACH_SEVERITIES),
  status: z.enum(BREACH_STATUSES),
  detectedAt: z.string(),
  occurredAt: z.string().nullable(),
  containment: z.string().nullable(),
  ownerId: z.string().nullable(),
  boardNotifiedAt: z.string().nullable(),
  peopleNotifiedAt: z.string().nullable(),
  noNotificationReason: z.string().nullable(),
  closedAt: z.string().nullable(),
  /** detectedAt + 72 hours. */
  dueAt: z.string(),
  /** Whole hours left on the clock (negative once overdue); null when the Board has been told or the breach is closed. */
  hoursLeft: z.number().nullable(),
  overdue: z.boolean(),
  createdById: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const GrievanceNotice = z.object({
  organisation: z.string(),
  officer: z.object({ name: z.string(), email: z.string(), phone: z.string().nullable(), address: z.string().nullable() }).nullable(),
  /** Days the organisation commits to answer a grievance within. */
  responseDays: z.number().nullable(),
});

const MinorStatus = z.object({
  isMinor: z.boolean(),
  /** Masked, e.g. a***@example.com. */
  guardianEmail: z.string().nullable(),
  guardianConsentAt: z.string().nullable(),
  /** When the link in the guardian's pending e-mail stops working. */
  pendingRequestExpiresAt: z.string().nullable(),
});

export const DPDP_DOCS: Record<string, OperationDoc> = {
  'GET /api/v1/privacy/consents': {
    summary: "The organisation's active consent purposes in plain language, each with your own answer (GRANTED, WITHDRAWN or NONE) and whether it is outdated (you agreed to an older wording).",
    response: ok(z.object({ data: z.array(MyConsent) })),
  },
  'POST /api/v1/privacy/consents/:key/grant': {
    summary: 'Give consent to one purpose. Appends to the consent history (with the wording you saw) and the audit trail. A person under 18 needs a guardian\'s consent on file first (403). Answering the same way twice records nothing new.',
    response: ok(z.object({ data: z.object({ purpose: MyConsent, consequence: z.string().nullable() }) })),
    errors: [403, 404],
  },
  'POST /api/v1/privacy/consents/:key/withdraw': {
    summary: 'Withdraw consent to one purpose, as easy as giving it and effective at once. For a required purpose the answer carries `consequence` (what withdrawing means; nothing is erased on your behalf). Audited.',
    response: ok(z.object({ data: z.object({ purpose: MyConsent, consequence: z.string().nullable() }) })),
    errors: [404],
  },
  'GET /api/v1/privacy/consents/report': {
    summary: 'Administrators: per purpose and wording version, how many people last granted and last withdrew, and how many active people never answered.',
    response: ok(z.object({ data: z.array(ConsentReportRow) })),
  },
  'GET /api/v1/privacy/consent-purposes': {
    summary: 'Administrators: every consent purpose (inactive ones too) with the lawful-basis note.',
    response: ok(z.object({ data: z.array(AdminPurpose) })),
  },
  'PUT /api/v1/privacy/consent-purposes': {
    summary: 'Administrators: create or update purposes by key (purposes left out stay; switch one off with active: false). Changing the wording or `required` raises the version. Audited.',
    body: savePurposesSchema,
    response: ok(z.object({ data: z.array(AdminPurpose) })),
    errors: [400],
  },
  'GET /api/v1/privacy/breaches': {
    summary: "Administrators: the organisation's personal-data breach register, newest first, with the number open and overdue (Board not notified within 72 hours of detection).",
    query: breachQuerySchema,
    response: ok(z.object({ data: z.array(Breach), summary: z.object({ open: z.number(), overdue: z.number() }) })),
    errors: [400],
  },
  'POST /api/v1/privacy/breaches': {
    summary: 'Administrators: register a breach. The 72-hour clock to notify the Data Protection Board starts at detectedAt (default now). Audited.',
    body: createBreachSchema,
    response: ok(z.object({ data: Breach }), 201),
    errors: [400],
  },
  'GET /api/v1/privacy/breaches/:id': {
    summary: 'Administrators: one breach.',
    response: ok(z.object({ data: Breach })),
    errors: [404],
  },
  'PATCH /api/v1/privacy/breaches/:id': {
    summary: 'Administrators: record containment, owner, who was told and when. The status follows (containment: CONTAINED; Board notified: NOTIFIED) unless given. CLOSED needs boardNotifiedAt or noNotificationReason; a closed breach cannot be changed (409). Audited.',
    body: updateBreachSchema,
    response: ok(z.object({ data: Breach })),
    errors: [400, 404, 409],
  },
  'GET /api/v1/privacy/grievance-officer': {
    summary: "Public: the grievance officer and response time of the organisation the address (host) names, for its privacy notice. `officer` is null until one is set.",
    response: ok(z.object({ data: GrievanceNotice })),
    errors: [404, 429],
  },
  'PUT /api/v1/privacy/grievance-officer': {
    summary: 'Administrators: set the grievance officer (name and e-mail together, or both null to clear) and the response time. Audited.',
    body: grievanceOfficerSchema,
    response: ok(z.object({ data: GrievanceNotice })),
    errors: [400],
  },
  'GET /api/v1/privacy/me/minor': {
    summary: 'Whether you are marked as under 18 and whether a parent or guardian has given consent.',
    response: ok(z.object({ data: MinorStatus })),
  },
  'PUT /api/v1/privacy/me/minor': {
    summary: 'Declare yourself under 18 (isMinor must be true; only an administrator can clear it, 403). Audited.',
    body: setMinorSchema,
    response: ok(z.object({ data: MinorStatus })),
    errors: [400, 403],
  },
  'POST /api/v1/privacy/me/guardian-consent': {
    summary: "E-mail your parent or guardian a single-use consent link (valid 7 days; earlier links stop working; three requests a day, 429). 409 if you are not marked under 18 or consent is already on file; 503 when the platform cannot send e-mail. Audited.",
    body: guardianRequestSchema,
    response: ok(z.object({ data: MinorStatus })),
    errors: [400, 409, 429, 503],
  },
  'PUT /api/v1/privacy/users/:id/minor': {
    summary: 'Administrators: mark a person as under 18, or clear it (this also forgets the guardian and their consent). Audited.',
    body: setMinorSchema,
    response: ok(z.object({ data: MinorStatus })),
    errors: [400, 404],
  },
  'POST /api/v1/privacy/users/:id/guardian-consent': {
    summary: "Administrators: e-mail a minor's guardian the single-use consent link. Same rules as the person's own request.",
    body: guardianRequestSchema,
    response: ok(z.object({ data: MinorStatus })),
    errors: [400, 404, 409, 429, 503],
  },
  'GET /api/v1/privacy/guardian-consent': {
    summary: 'Public: what the guardian is asked to confirm (organisation and the minor\'s first name). Changes nothing, so mail scanners opening the link do no harm. The token comes from the e-mailed link; 400 when it is invalid, used or expired.',
    query: guardianTokenSchema,
    response: ok(z.object({ data: z.object({ organisation: z.string(), firstName: z.string(), expiresAt: z.string() }) })),
    errors: [400, 429],
  },
  'POST /api/v1/privacy/guardian-consent': {
    summary: "Public: the guardian confirms consent with the e-mailed token; it works once. Sets the minor's guardian consent and is audited with the guardian's address and browser.",
    body: guardianTokenSchema,
    response: ok(z.object({ data: z.object({ confirmedAt: z.string() }) })),
    errors: [400, 429],
  },
};
