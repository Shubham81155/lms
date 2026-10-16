import { z } from 'zod';
import { Pagination } from '../docs';
import type { ResponseTable } from './types';

/**
 * Response schemas for the administrator endpoints (tenant settings, audit log, plan/features,
 * usage, export, webhooks, SCIM tokens, SSO/SAML, campuses, compliance), live classes and MFA.
 * Secrets: webhook signing secrets, SCIM bearer tokens, the MFA secret and recovery codes appear
 * once, on the response that creates them, and never again. SSO client secrets and SAML keys are
 * never returned (only `hasSecret` and a key fingerprint).
 */

const Role = z.enum(['SUPER_ADMIN', 'TENANT_ADMIN', 'INSTRUCTOR', 'TEACHING_ASSISTANT', 'STUDENT', 'PARENT_GUARDIAN', 'AUDITOR']);
const Tier = z.enum(['STARTER', 'PROFESSIONAL', 'ENTERPRISE']);

// ---- tenant settings, audit, stats

/** The tenant row as stored. `featureFlags` is the stored override JSON (null = plan defaults). */
const TenantRecord = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  customDomain: z.string().nullable(),
  tier: Tier,
  status: z.enum(['ACTIVE', 'SUSPENDED', 'TRIAL', 'ARCHIVED']),
  logoUrl: z.string().nullable(),
  primaryColor: z.string().nullable(),
  secondaryColor: z.string().nullable(),
  faviconUrl: z.string().nullable(),
  dataRegion: z.string(),
  ferpaCompliant: z.boolean(),
  coppaCompliant: z.boolean(),
  featureFlags: z.unknown(),
  seatQuota: z.number().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const TenantSettings = TenantRecord.extend({
  userCount: z.number(),
  courseCount: z.number(),
  campusCount: z.number(),
  ltiDeploymentCount: z.number(),
});

export const AuditLogItem = z.object({
  id: z.string(),
  tenantId: z.string(),
  userId: z.string().nullable(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string().nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  /** Before/after snapshot; shape depends on the action. */
  diffJson: z.unknown(),
  createdAt: z.string(),
  /** Null when the acting user was since deleted. */
  user: z.object({ id: z.string(), email: z.string(), firstName: z.string(), lastName: z.string(), role: Role }).nullable(),
});

export const AdminStats = z.object({
  totalUsers: z.number(),
  totalCourses: z.number(),
  totalEnrollments: z.number(),
  completedEnrollments: z.number(),
  activeEnrollments: z.number(),
  /** Percent with two decimals; 0 when there are no enrollments. */
  completionRate: z.number(),
  /** Users per role; roles with no users are absent. */
  roleCounts: z.record(z.string(), z.number()),
});

// ---- features, usage, export

export const FeatureFlags = z.object({
  lti13: z.boolean(),
  sso: z.boolean(),
  webhooks: z.boolean(),
  scim: z.boolean(),
  aiAssistant: z.boolean(),
});

export const UsageReport = z.object({
  /** Absent only if the tenant row vanished mid-request. */
  tier: Tier.optional(),
  seats: z.object({
    used: z.number(),
    quota: z.number().nullable(),
    remaining: z.number().nullable(),
    byRole: z.record(z.string(), z.number()),
    byStatus: z.record(z.string(), z.number()),
  }),
  last30Days: z.object({ activeUsers: z.number(), xapiStatements: z.number(), assignmentSubmissions: z.number() }),
  totals: z.object({ courses: z.number(), enrollments: z.number(), certificates: z.number() }),
});

/** The tenant export file. Credentials and secrets are never included. */
export const TenantExport = z.object({
  exportedAt: z.string(),
  tenant: z.object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    tier: Tier,
    customDomain: z.string().nullable(),
    dataRegion: z.string(),
    createdAt: z.string(),
  }),
  users: z.array(
    z.object({
      id: z.string(),
      email: z.string(),
      firstName: z.string(),
      lastName: z.string(),
      role: Role,
      status: z.enum(['ACTIVE', 'INVITED', 'LOCKED', 'SUSPENDED']),
      createdAt: z.string(),
      lastLoginAt: z.string().nullable(),
    })
  ),
  campuses: z.array(
    z.object({
      id: z.string(),
      tenantId: z.string(),
      name: z.string(),
      code: z.string(),
      createdAt: z.string(),
      updatedAt: z.string(),
      departments: z.array(z.object({ id: z.string(), campusId: z.string(), name: z.string(), code: z.string(), createdAt: z.string(), updatedAt: z.string() })),
    })
  ),
  courses: z.array(
    z.object({
      id: z.string(),
      tenantId: z.string(),
      departmentId: z.string().nullable(),
      code: z.string(),
      title: z.string(),
      description: z.string().nullable(),
      syllabus: z.string().nullable(),
      thumbnailUrl: z.string().nullable(),
      status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
      passingGradePercent: z.number(),
      allowSelfEnroll: z.boolean(),
      gradeCurveMethod: z.string(),
      gradeCurveValue: z.number(),
      createdAt: z.string(),
      updatedAt: z.string(),
      modules: z.array(
        z.object({
          id: z.string(),
          courseId: z.string(),
          title: z.string(),
          orderIndex: z.number(),
          isLocked: z.boolean(),
          createdAt: z.string(),
          updatedAt: z.string(),
          lessons: z.array(
            z.object({
              id: z.string(),
              moduleId: z.string(),
              title: z.string(),
              orderIndex: z.number(),
              contentType: z.string(),
              bodyContent: z.string().nullable(),
              mediaUrl: z.string().nullable(),
              scormPackageId: z.string().nullable(),
              ltiToolLaunchUrl: z.string().nullable(),
              estimatedMinutes: z.number(),
              createdAt: z.string(),
              updatedAt: z.string(),
            })
          ),
        })
      ),
      instructors: z.array(z.object({ userId: z.string(), isPrimary: z.boolean() })),
    })
  ),
  enrollments: z.array(
    z.object({
      id: z.string(),
      tenantId: z.string(),
      courseId: z.string(),
      userId: z.string(),
      status: z.enum(['ENROLLED', 'IN_PROGRESS', 'COMPLETED', 'DROPPED', 'FAILED']),
      finalGrade: z.number().nullable(),
      progressPercent: z.number(),
      enrolledAt: z.string(),
      completedAt: z.string().nullable(),
    })
  ),
  certificates: z.array(
    z.object({
      id: z.string(),
      enrollmentId: z.string(),
      certificateNumber: z.string(),
      issuedAt: z.string(),
      expiresAt: z.string().nullable(),
      pdfUrl: z.string().nullable(),
      verificationQr: z.string(),
    })
  ),
});

// ---- webhooks

/** What the API shows of an endpoint. The signing secret is not part of it. */
export const WebhookEndpointView = z.object({
  id: z.string(),
  url: z.string(),
  events: z.array(z.string()),
  isActive: z.boolean(),
  createdAt: z.string(),
});

/** Returned once, on creation. `secret` (whsec_...) cannot be read again. */
export const WebhookEndpointCreated = WebhookEndpointView.extend({ secret: z.string() });

export const WebhookDeliveryItem = z.object({
  id: z.string(),
  tenantId: z.string(),
  endpointId: z.string(),
  event: z.string(),
  /** Null when the receiver could not be reached. */
  statusCode: z.number().nullable(),
  success: z.boolean(),
  error: z.string().nullable(),
  createdAt: z.string(),
  attempt: z.number(),
  nextAttemptAt: z.string().nullable(),
});

// ---- SCIM tokens, SSO, SAML

export const ScimTokenItem = z.object({ id: z.string(), label: z.string(), createdAt: z.string(), revokedAt: z.string().nullable() });
/** Returned once, on creation. `token` is the bearer token and cannot be read again. */
export const ScimTokenCreated = z.object({ id: z.string(), label: z.string(), token: z.string() });

export const SsoConnectionView = z.object({
  issuer: z.string(),
  clientId: z.string(),
  enabled: z.boolean(),
  allowedDomains: z.array(z.string()),
  /** Always true: the client secret is stored encrypted and never returned. */
  hasSecret: z.literal(true),
  redirectUris: z.array(z.string()),
});

export const SamlConnectionView = z.object({
  entryPoint: z.string(),
  idpIssuer: z.string(),
  emailAttribute: z.string(),
  enabled: z.boolean(),
  allowedDomains: z.array(z.string()),
  /** What kind of key is pinned; null if it can no longer be read (for example an expired certificate). */
  keyKind: z.enum(['CERTIFICATE', 'PUBLIC KEY']).nullable(),
  keyFingerprint: z.string().nullable(),
  keyExpires: z.string().nullable(),
});

// ---- campuses, compliance

const Department = z.object({ id: z.string(), campusId: z.string(), name: z.string(), code: z.string(), createdAt: z.string(), updatedAt: z.string() });
const CampusRecord = z.object({ id: z.string(), tenantId: z.string(), name: z.string(), code: z.string(), createdAt: z.string(), updatedAt: z.string() });

export const CampusTreeItem = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  departments: z.array(z.object({ id: z.string(), name: z.string(), code: z.string(), courseCount: z.number() })),
  courseCount: z.number(),
});

export const ComplianceReport = z.object({
  checks: z.array(z.object({ id: z.string(), name: z.string(), status: z.enum(['PASS', 'WARN', 'FAIL', 'INFO']), detail: z.string() })),
  declarations: z.object({ ferpa: z.boolean(), coppa: z.boolean(), dataRegion: z.string().nullable() }),
  note: z.string(),
});

// ---- live classes

export const LiveSessionView = z.object({
  id: z.string(),
  courseId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  scheduledAt: z.string(),
  durationMins: z.number(),
  status: z.enum(['SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED']),
  allowStudentVideo: z.boolean(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
});

/** One session in a course's list: staff get `attendeeCount`, learners get `attended`. */
export const LiveSessionListItem = LiveSessionView.extend({
  attendeeCount: z.number().optional(),
  attended: z.boolean().optional(),
});

export const LiveSessionMineItem = LiveSessionView.extend({ course: z.object({ id: z.string(), code: z.string(), title: z.string() }) });

export const LiveJoin = z.object({
  /** The media server (LiveKit) URL; always set, since joining is refused (503) when live classes are not configured. */
  url: z.string(),
  /** Signed access token for this person and room. */
  token: z.string(),
  roomName: z.string(),
  role: z.enum(['HOST', 'ASSISTANT', 'LEARNER']),
  canPublish: z.boolean(),
});

export const LiveAttendanceRow = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  joinCount: z.number(),
  firstJoinedAt: z.string().nullable(),
  minutes: z.number(),
  present: z.boolean(),
  inRoomNow: z.boolean(),
});

const ok = (schema: z.ZodTypeAny, status = 200) => ({ status, schema });
const noBody = (description: string) => ({ status: 204, description });

export const RESPONSES: ResponseTable = {
  // ---- tenant settings, audit log, stats
  'GET /api/v1/admin/tenant': { response: ok(z.object({ data: TenantSettings })), errors: [404] },
  'PATCH /api/v1/admin/tenant': { response: ok(z.object({ data: TenantRecord })), errors: [400, 404] },
  'GET /api/v1/admin/audit-logs': { response: ok(z.object({ data: z.array(AuditLogItem), pagination: Pagination })), errors: [400] },
  'GET /api/v1/admin/stats': { response: ok(z.object({ data: AdminStats })) },

  // ---- plan, usage, export
  'GET /api/v1/admin/features': { response: ok(z.object({ data: FeatureFlags })) },
  'PUT /api/v1/admin/features': { response: ok(z.object({ data: FeatureFlags })), errors: [400, 404] },
  'GET /api/v1/admin/usage': { response: ok(z.object({ data: UsageReport })) },
  'PUT /api/v1/admin/usage/quota': { response: ok(z.object({ data: z.object({ seatQuota: z.number().nullable() }) })), errors: [400, 409] },
  'GET /api/v1/admin/export': {
    response: { status: 200, schema: TenantExport, description: 'Tenant data as a JSON download (Content-Disposition: attachment). No credentials or secrets. Streamed; if it fails midway the connection is cut and the file is truncated.' },
  },

  // ---- webhooks
  'GET /api/v1/admin/webhooks': { response: ok(z.object({ data: z.array(WebhookEndpointView) })) },
  'POST /api/v1/admin/webhooks': {
    response: { status: 201, schema: z.object({ data: WebhookEndpointCreated }), description: 'The signing secret is returned here once and never again.' },
    errors: [400],
  },
  'PATCH /api/v1/admin/webhooks/:id': { response: ok(z.object({ data: WebhookEndpointView })), errors: [400, 404] },
  'DELETE /api/v1/admin/webhooks/:id': { response: noBody('Deleted'), errors: [404] },
  'GET /api/v1/admin/webhooks/:id/deliveries': { response: { status: 200, schema: z.object({ data: z.array(WebhookDeliveryItem) }), description: 'The 50 most recent delivery attempts, newest first.' }, errors: [404] },
  'POST /api/v1/admin/webhooks/:id/test': {
    response: {
      status: 200,
      schema: z.object({ data: z.object({ success: z.boolean(), statusCode: z.number().nullable(), error: z.string().nullable() }) }),
      description: 'Result of sending a signed webhook.test event. A failing receiver is reported here, not as an HTTP error.',
    },
    errors: [400, 404],
  },

  // ---- SCIM tokens
  'GET /api/v1/admin/scim-tokens': { response: ok(z.object({ data: z.array(ScimTokenItem) })) },
  'POST /api/v1/admin/scim-tokens': {
    response: { status: 201, schema: z.object({ data: ScimTokenCreated }), description: 'The bearer token is returned here once; only its hash is stored.' },
    errors: [400],
  },
  'DELETE /api/v1/admin/scim-tokens/:id': { response: noBody('Revoked'), errors: [404] },

  // ---- OIDC single sign-on
  'GET /api/v1/admin/sso': {
    response: ok(z.object({ data: SsoConnectionView.nullable(), redirectUris: z.array(z.string()) })),
  },
  'PUT /api/v1/admin/sso': { response: ok(z.object({ data: SsoConnectionView })), errors: [400] },
  'DELETE /api/v1/admin/sso': { response: noBody('Removed'), errors: [404] },

  // ---- SAML single sign-on
  'GET /api/v1/admin/saml': {
    response: ok(
      z.object({
        data: SamlConnectionView.nullable(),
        sp: z.object({ entityIds: z.array(z.string()), acsUrls: z.array(z.string()), metadataUrls: z.array(z.string()) }),
      })
    ),
  },
  'PUT /api/v1/admin/saml': { response: ok(z.object({ data: SamlConnectionView })), errors: [400] },
  'DELETE /api/v1/admin/saml': { response: noBody('Removed'), errors: [404] },

  // ---- campuses and departments
  'GET /api/v1/admin/campuses': { response: ok(z.object({ data: z.array(CampusTreeItem) })) },
  'POST /api/v1/admin/campuses': { response: ok(z.object({ data: CampusRecord }), 201), errors: [400, 409] },
  'PATCH /api/v1/admin/campuses/:id': { response: ok(z.object({ data: CampusRecord })), errors: [400, 404, 409] },
  'DELETE /api/v1/admin/campuses/:id': { response: noBody('Deleted'), errors: [404, 409] },
  'POST /api/v1/admin/campuses/:id/departments': { response: ok(z.object({ data: Department }), 201), errors: [400, 404, 409] },
  'PATCH /api/v1/admin/departments/:id': { response: ok(z.object({ data: Department })), errors: [400, 404, 409] },
  'DELETE /api/v1/admin/departments/:id': { response: noBody('Deleted'), errors: [404, 409] },
  'GET /api/v1/admin/compliance': { response: ok(z.object({ data: ComplianceReport })) },

  // ---- live classes
  'GET /api/v1/courses/:courseId/live-sessions': {
    response: ok(z.object({ configured: z.boolean(), data: z.array(LiveSessionListItem) })),
    errors: [403, 404],
  },
  'POST /api/v1/courses/:courseId/live-sessions': { response: ok(z.object({ data: LiveSessionView }), 201), errors: [400, 403, 404] },
  'GET /api/v1/live-sessions/mine': { response: ok(z.object({ configured: z.boolean(), data: z.array(LiveSessionMineItem) })) },
  'PATCH /api/v1/live-sessions/:id': { response: ok(z.object({ data: LiveSessionView })), errors: [400, 403, 404, 409] },
  'POST /api/v1/live-sessions/:id/cancel': { response: ok(z.object({ data: z.object({ id: z.string(), status: z.literal('CANCELLED') }) })), errors: [403, 404, 409] },
  'POST /api/v1/live-sessions/:id/start': {
    response: { status: 200, schema: z.object({ data: LiveSessionView }), description: 'The session is live. Also the answer when it already was (idempotent).' },
    errors: [403, 404, 409, 503],
  },
  'POST /api/v1/live-sessions/:id/end': { response: ok(z.object({ data: LiveSessionView })), errors: [403, 404, 409] },
  'POST /api/v1/live-sessions/:id/join': {
    response: { status: 200, schema: z.object({ data: LiveJoin }), description: 'A signed token for the media server. Only while the class is live.' },
    errors: [403, 404, 409, 503],
  },
  'GET /api/v1/live-sessions/:id/attendance': {
    response: ok(z.object({ data: z.array(LiveAttendanceRow), summary: z.object({ enrolled: z.number(), present: z.number() }) })),
    errors: [403, 404],
  },

  // ---- two-factor authentication
  'GET /api/v1/auth/mfa/status': { response: ok(z.object({ data: z.object({ enabled: z.boolean(), recoveryCodesRemaining: z.number() }) })) },
  'POST /api/v1/auth/mfa/setup': {
    response: {
      status: 200,
      schema: z.object({ data: z.object({ secret: z.string(), otpauthUrl: z.string() }) }),
      description: 'Begins enrolment. The authenticator secret is returned here and nowhere else; calling again replaces it.',
    },
    errors: [404, 409],
  },
  'POST /api/v1/auth/mfa/enable': {
    response: {
      status: 200,
      schema: z.object({ data: z.object({ enabled: z.literal(true), recoveryCodes: z.array(z.string()) }) }),
      description: 'Two-factor authentication is on. The single-use recovery codes are returned here once.',
    },
    errors: [400, 404, 409],
  },
  'POST /api/v1/auth/mfa/disable': { response: ok(z.object({ data: z.object({ enabled: z.literal(false) }) })), errors: [400, 404, 409] },
};
