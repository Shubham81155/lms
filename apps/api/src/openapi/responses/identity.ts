import { z } from 'zod';
import type { ResponseTable } from './types';

/**
 * Responses of the identity and integration endpoints: health, tenant branding, e-mail
 * verification, OIDC/SAML single sign-on, LTI launch, SCIM provisioning and signed provider
 * callbacks. Many of these answer with redirects, XML or SCIM bodies rather than the usual JSON.
 * Checked against the real API by test/contract-identity.test.ts.
 */

// ---- server.ts
const Health = z.object({ status: z.literal('healthy'), timestamp: z.string(), service: z.string() });
const Ready = z.object({ status: z.literal('ready'), timestamp: z.string() });
const Unavailable = z.object({ status: z.literal('unavailable') });

const FeatureFlags = z.object({
  scorm: z.boolean(),
  xapi: z.boolean(),
  lti13: z.boolean(),
  aiProctoring: z.boolean(),
  sso: z.boolean(),
  webhooks: z.boolean(),
  scim: z.boolean(),
});

const TenantConfig = z.object({
  tenantId: z.string(),
  slug: z.string(),
  name: z.string(),
  theme: z.object({
    primaryColor: z.string().nullable(),
    secondaryColor: z.string().nullable(),
    logoUrl: z.string().nullable(),
    faviconUrl: z.string().nullable(),
  }),
  /** Plan defaults with the tenant's own overrides applied. */
  features: FeatureFlags,
});

// ---- auth
const Message = z.object({ message: z.string() });

const SsoStatus = z.union([
  z.object({ enabled: z.literal(false) }),
  z.object({ enabled: z.boolean(), oidc: z.boolean(), saml: z.boolean() }),
]);

// ---- privacy
const DirectorySetting = z.object({ data: z.object({ optOut: z.boolean() }) });
const Erased = z.object({ status: z.literal('erased'), userId: z.string() });
const PersonalDataExport = z.object({
  exportMetadata: z.object({ format: z.literal('LMS_PERSONAL_DATA_EXPORT_V1'), generatedAt: z.string(), subjectId: z.string(), regulation: z.string() }),
  profile: z.object({ id: z.string(), email: z.string(), firstName: z.string(), lastName: z.string(), role: z.string(), status: z.string(), directoryOptOut: z.boolean(), createdAt: z.string() }).passthrough(),
  enrollments: z.array(z.unknown()),
  quizAttempts: z.array(z.unknown()),
  assignmentSubmissions: z.array(z.unknown()),
  courseGrades: z.array(z.unknown()),
  notifications: z.array(z.unknown()),
  notificationPreferences: z.unknown(),
  forum: z.object({ threads: z.array(z.unknown()), posts: z.array(z.unknown()) }),
  gamification: z.object({ summary: z.unknown(), xpEvents: z.array(z.unknown()) }),
  liveAttendance: z.array(z.unknown()),
  learningActivity: z.array(z.unknown()),
  guardianLinks: z.array(z.unknown()),
  accountActivity: z.array(z.unknown()),
});

// ---- LTI
const LtiLaunchResult = z.object({
  status: z.literal('authenticated'),
  ltiVersion: z.literal('1.3.0'),
  /** The platform's target_link_uri claim, when it sent one. */
  targetLinkUri: z.string().nullable(),
  user: z.object({ id: z.string(), role: z.string() }),
});

// ---- SCIM (RFC 7643 / 7644)
export const ScimUser = z.object({
  schemas: z.array(z.string()),
  id: z.string(),
  /** The IdP's own id for the user, when one was stored. */
  externalId: z.string().optional(),
  userName: z.string(),
  name: z.object({ givenName: z.string(), familyName: z.string(), formatted: z.string() }),
  emails: z.array(z.object({ value: z.string(), primary: z.boolean() })),
  active: z.boolean(),
  meta: z.object({ resourceType: z.literal('User'), created: z.string(), lastModified: z.string(), location: z.string() }),
});

export const ScimListResponse = z.object({
  schemas: z.array(z.string()),
  totalResults: z.number(),
  startIndex: z.number(),
  itemsPerPage: z.number(),
  Resources: z.array(ScimUser),
});

/** SCIM errors do not use the LMS `{ error }` envelope. */
export const ScimError = z.object({
  schemas: z.array(z.string()),
  /** The HTTP status as a string, per RFC 7644. */
  status: z.string(),
  detail: z.string(),
  scimType: z.string().optional(),
});

const ScimServiceProviderConfig = z.object({
  schemas: z.array(z.string()),
  patch: z.object({ supported: z.boolean() }),
  bulk: z.object({ supported: z.boolean() }),
  filter: z.object({ supported: z.boolean(), maxResults: z.number() }),
  changePassword: z.object({ supported: z.boolean() }),
  sort: z.object({ supported: z.boolean() }),
  etag: z.object({ supported: z.boolean() }),
  authenticationSchemes: z.array(z.object({ type: z.string(), name: z.string(), description: z.string() })),
});

const SCIM = 'application/scim+json';
const scimNote = 'Authenticated with a per-tenant SCIM bearer token, not a session. Errors (401 bad or missing token, 403 SCIM not enabled or an administrator account, 404, 409, 400) use the SCIM error body (status, detail, scimType) with content type application/scim+json, not the LMS { error } envelope.';

const redirectNote = 'Browser redirect with a Location header. Failures never show a reason to the browser: they redirect to the login page with ?error=sso_failed (or sso_unavailable when single sign-on is not set up).';

export const RESPONSES: ResponseTable = {
  // ---- server.ts
  'GET /health': { response: { status: 200, schema: Health, description: 'The process is up.' } },
  'GET /ready': {
    response: { status: 200, schema: Ready, description: 'The database answers; the instance can take traffic.' },
    otherResponses: [{ status: 503, schema: Unavailable, description: 'The database does not answer. Load balancers should stop routing here.' }],
  },
  'GET /api/v1/tenant/config': {
    response: { status: 200, schema: TenantConfig, description: 'Branding and feature flags of the tenant found from the host or x-tenant-id header.' },
    errors: [404, 500],
  },
  'GET /api/v1/openapi.json': { response: { status: 200, schema: z.record(z.unknown()), description: 'This OpenAPI 3 document.' } },

  // ---- auth
  'POST /api/v1/auth/resend-verification': {
    response: { status: 200, schema: Message, description: '"Verification email sent", or "Email is already verified" when there is nothing to send.' },
    errors: [404, 429, 500],
  },

  // ---- OIDC single sign-on
  'GET /api/v1/auth/sso/status': {
    response: { status: 200, schema: SsoStatus, description: 'Whether to show the single sign-on button. Only { enabled: false } when the tenant cannot be resolved.' },
  },
  'GET /api/v1/auth/sso/start': {
    response: { status: 302, description: `Redirects to the identity provider's authorization endpoint (PKCE, state and nonce; sets the signed lms_sso flow cookie). ${redirectNote}` },
  },
  'GET /api/v1/auth/sso/callback': {
    response: { status: 302, description: `Where the identity provider sends the browser back. On success sets the session cookie and redirects to the app root (/); otherwise to /login?error=sso_failed. ${redirectNote}` },
  },

  // ---- SAML single sign-on
  'GET /api/v1/auth/saml/start': {
    response: { status: 302, description: `Redirects to the identity provider with an AuthnRequest (sets the signed lms_saml flow cookie). ${redirectNote}` },
  },
  'POST /api/v1/auth/saml/acs': {
    response: {
      status: 303,
      description: `Assertion consumer service: the identity provider posts a form-encoded SAMLResponse here. On success sets the session cookie and redirects (303) to the app root (/); otherwise to /login?error=sso_failed. ${redirectNote}`,
    },
  },
  'GET /api/v1/auth/saml/metadata/:slug': {
    response: { status: 200, schema: z.string(), contentType: 'application/samlmetadata+xml', description: 'SAML 2.0 service provider metadata (entity id, assertion consumer URL) to give the identity provider. Public.' },
    errors: [404],
  },

  // ---- LTI 1.3
  'POST /api/v1/lti/launch': {
    response: { status: 200, schema: LtiLaunchResult, description: 'The platform id_token was verified against its key set and the matching user signed in (session cookie set). Does not redirect.' },
    errors: [400, 401, 403, 404, 502, 500],
  },

  // ---- SCIM 2.0
  'GET /api/v1/scim/v2/ServiceProviderConfig': {
    response: { status: 200, schema: ScimServiceProviderConfig, contentType: SCIM, description: `Capabilities of this SCIM service. ${scimNote}` },
    errors: [401, 403],
  },
  'GET /api/v1/scim/v2/Users': {
    response: { status: 200, schema: ScimListResponse, contentType: SCIM, description: `SCIM ListResponse. Supports startIndex, count (max 100) and the filters userName eq "x" and externalId eq "x". ${scimNote}` },
    errors: [400, 401, 403],
  },
  'POST /api/v1/scim/v2/Users': {
    response: { status: 201, schema: ScimUser, contentType: SCIM, description: `The provisioned user (learner role). ${scimNote}` },
    errors: [400, 401, 403, 409],
  },
  'GET /api/v1/scim/v2/Users/:id': {
    response: { status: 200, schema: ScimUser, contentType: SCIM, description: `A user of the token's tenant. ${scimNote}` },
    errors: [401, 403, 404],
  },
  'PUT /api/v1/scim/v2/Users/:id': {
    response: { status: 200, schema: ScimUser, contentType: SCIM, description: `The updated user. ${scimNote}` },
    errors: [400, 401, 403, 404],
  },
  'PATCH /api/v1/scim/v2/Users/:id': {
    response: { status: 200, schema: ScimUser, contentType: SCIM, description: `The updated user. ${scimNote}` },
    errors: [400, 401, 403, 404],
  },
  'DELETE /api/v1/scim/v2/Users/:id': {
    response: { status: 204, description: `Deprovisioned: the account is suspended and keeps its history; no body. ${scimNote}` },
    errors: [401, 403, 404],
  },

  // ---- privacy (GDPR / FERPA)
  'GET /api/v1/privacy/me/export': {
    response: { status: 200, schema: PersonalDataExport, description: 'Attachment (personal-data-<id>.json) with the profile, learning records, submissions, grades, forum posts, notifications, xAPI activity and account activity of the caller.' },
  },
  'GET /api/v1/privacy/users/:id/export': {
    response: { status: 200, schema: PersonalDataExport, description: 'The same export for any person in the tenant. Administrators only; the export is audited.' },
    errors: [404],
  },
  'GET /api/v1/privacy/me/directory': { response: { status: 200, schema: DirectorySetting } },
  'PUT /api/v1/privacy/me/directory': {
    response: { status: 200, schema: DirectorySetting, description: 'When true, classmates see "Anonymous learner" on leaderboards and forums. Staff still see the name.' },
    errors: [400],
  },
  'POST /api/v1/privacy/me/erase': {
    response: { status: 200, schema: Erased, description: 'The account is anonymised and every session revoked. Grades are kept without identity; submission text, forum text, notifications and xAPI actor details are removed. Refused for the only active administrator.' },
    errors: [400, 403, 404, 409],
  },
  'POST /api/v1/privacy/users/:id/erase': {
    response: { status: 200, schema: Erased, description: 'Same as self-erasure, performed by an administrator. A super administrator can only be erased by another.' },
    errors: [400, 404, 409],
  },

  // ---- provider callbacks
  'POST /api/v1/integrations/plagiarism/:tenantSlug': {
    response: {
      status: 200,
      schema: z.object({ status: z.literal('recorded'), alerted: z.number() }),
      description: 'Signed provider callback (headers x-lms-timestamp and x-lms-signature: sha256=HMAC). `alerted` is how many course staff were notified of high similarity (30% or more).',
    },
    errors: [400, 401, 404, 500, 503],
  },
  'POST /api/v1/integrations/livekit': {
    response: {
      status: 200,
      schema: z.object({ ok: z.literal(true), ignored: z.string().optional() }),
      description: 'Signed LiveKit webhook (Authorization is a JWT committing to the body). `ignored` explains an event for a room or session that is not ours; it is still acknowledged.',
    },
    errors: [400, 401, 500, 503],
  },
};
