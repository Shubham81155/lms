import { z } from 'zod';
import type { OperationDoc } from '../docs';
import type { ResponseEntry, ResponseTable } from './types';
import { enterSchema, grantSchema } from '../../routes/support.routes';

/**
 * Consented support access (routes/support.routes.ts): the organisation's administrators grant and revoke
 * support passes; the platform operator enters through a one-time link. Summaries and request bodies live here
 * too, so the feature is described in one place.
 */

const ok = (schema: z.ZodTypeAny, status = 200) => ({ status, schema });

const Scope = z.enum(['READ_ONLY', 'FULL']);

const SupportPass = z.object({
  id: z.string(),
  scope: Scope,
  reason: z.string(),
  grantedByEmail: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  revokedByEmail: z.string().nullable(),
  lastEnteredAt: z.string().nullable(),
  lastEnteredByEmail: z.string().nullable(),
  /** ACTIVE while it can be used. */
  status: z.enum(['ACTIVE', 'REVOKED', 'EXPIRED']),
});

const SupportSession = z.object({ passId: z.string(), scope: Scope, expiresAt: z.string(), operatorEmail: z.string() });

const OperatorSupportPass = z.object({
  id: z.string(),
  organization: z.object({ id: z.string(), slug: z.string(), name: z.string(), status: z.string() }),
  scope: Scope,
  reason: z.string(),
  grantedByEmail: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  lastEnteredAt: z.string().nullable(),
  lastEnteredByEmail: z.string().nullable(),
});

type Entry = ResponseEntry & Pick<OperationDoc, 'summary' | 'body'>;

const TABLE = {
  'GET /api/v1/support/passes': {
    summary: "Administrators: this organisation's support passes for the platform operator, newest first (the last 50).",
    response: ok(z.object({ data: z.array(SupportPass) })),
  },
  'POST /api/v1/support/passes': {
    summary:
      'Administrators: grant the platform operator a support pass for 1, 4, 24 or 72 hours, READ_ONLY (default) or FULL (changes allowed, each one audited). One pass is in force at a time (409); the platform operator organisation cannot grant one (409); not from a support session (403). Audited.',
    body: grantSchema,
    response: ok(z.object({ data: SupportPass }), 201),
    errors: [400, 409],
  },
  'POST /api/v1/support/passes/:id/revoke': {
    summary: 'Administrators: withdraw a support pass. A support session under it ends at once. Not from a support session (403). Audited.',
    response: ok(z.object({ data: SupportPass })),
    errors: [400, 404, 409],
  },
  'POST /api/v1/support/enter': {
    summary:
      'Public: exchange the one-time handoff token of /support/enter?token= (valid once, for two minutes) for a support session in the pass\'s organisation, as its "Platform support" account. Sets the session cookie. 410 when the link was used, expired or its pass is no longer in force; 403 when the organisation is suspended. Audited.',
    body: enterSchema,
    response: ok(z.object({ data: SupportSession })),
    errors: [400, 403, 410, 429],
  },
  'GET /api/v1/support/session': {
    summary:
      'The current support session (scope, operator e-mail, when it ends), or null for an ordinary session. A READ_ONLY support session gets 403 with code SUPPORT_READ_ONLY for any change.',
    response: ok(z.object({ data: SupportSession.nullable() })),
  },
  'POST /api/v1/support/exit': {
    summary:
      'End the support session (the pass stays in force until it expires or is revoked). Answers where to go next: the platform console. 409 for an ordinary session. Audited.',
    response: ok(z.object({ data: z.object({ redirect: z.string() }) })),
    errors: [409],
  },
  'GET /api/v1/operator/support-passes': {
    summary: 'Platform operator: support passes in force across organisations, soonest to expire first.',
    response: ok(z.object({ data: z.array(OperatorSupportPass) })),
  },
  'POST /api/v1/operator/support-passes/:id/enter': {
    summary:
      "Platform operator: a one-time link (valid two minutes) to /support/enter at the organisation's own address, which opens a support session there. 404 when the pass is not in force; 409 for a suspended organisation or the operator's own.",
    response: ok(z.object({ data: z.object({ url: z.string(), expiresAt: z.string() }) })),
    errors: [400, 404, 409],
  },
} satisfies Record<string, Entry>;

export const RESPONSES: ResponseTable = TABLE;
