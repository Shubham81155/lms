import { z } from 'zod';
import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { apiMounts, rawBodyMounts } from '../mounts';
import { inventory, Operation } from './inventory';
import { DOCS, ErrorResponse } from './docs';

// Adds `.openapi()` to Zod schemas (only the API description uses it).
extendZodWithOpenApi(z);

/** Operations that are not in a router: defined directly in server.ts. */
const SERVER_OPERATIONS: Operation[] = [
  { method: 'get', path: '/health', security: 'none' },
  { method: 'get', path: '/ready', security: 'none' },
  { method: 'get', path: '/api/v1/tenant/config', security: 'none' },
  { method: 'get', path: '/api/v1/openapi.json', security: 'none' },
];

const EXTRA_DOCS: Record<string, { summary: string; tag: string }> = {
  'GET /health': { summary: 'Liveness probe: the process is up. Makes no compliance claims.', tag: 'system' },
  'GET /ready': { summary: 'Readiness probe: 200 only when the database answers, otherwise 503.', tag: 'system' },
  'GET /api/v1/openapi.json': { summary: 'This description of the API.', tag: 'system' },
  'GET /api/v1/tenant/config': { summary: 'Branding and feature flags of the tenant resolved from the host or x-tenant-id (used by the login page).', tag: 'tenant' },
};

/** How callers prove who they are, per route kind. Signed provider callbacks are described in their summaries. */
const SECURITY: Record<Operation['security'], Record<string, string[]>[]> = {
  session: [{ cookieAuth: [] }, { bearerAuth: [] }],
  'optional-session': [{}, { cookieAuth: [] }, { bearerAuth: [] }],
  'scim-token': [{ scimToken: [] }],
  none: [],
};

const toOpenApiPath = (path: string) => path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
const pathParams = (path: string) => [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);

const tagOf = (path: string) => {
  const parts = path.replace(/^\/api\/v1\/?/, '').split('/').filter(Boolean);
  return parts[0] ?? 'system';
};

const camel = (s: string) => s.replace(/[^A-Za-z0-9]+(.)?/g, (_m, c) => (c ? c.toUpperCase() : ''));

const ERROR_TEXT: Record<number, string> = {
  400: 'Invalid request',
  401: 'Not signed in, or the session was revoked',
  403: 'Not allowed',
  404: 'Not found',
  409: 'Conflict with the current state',
  423: 'Account locked',
  429: 'Rate limit exceeded',
};

export function allOperations(): Operation[] {
  return [...SERVER_OPERATIONS, ...inventory([...rawBodyMounts, ...apiMounts])];
}

export function buildOpenApi() {
  const registry = new OpenAPIRegistry();
  registry.registerComponent('securitySchemes', 'cookieAuth', { type: 'apiKey', in: 'cookie', name: 'lms_token', description: 'httpOnly session cookie set by POST /api/v1/auth/login.' });
  registry.registerComponent('securitySchemes', 'bearerAuth', { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'The same session token, for API clients.' });
  registry.registerComponent('securitySchemes', 'scimToken', { type: 'http', scheme: 'bearer', description: 'SCIM bearer token created by a tenant administrator.' });
  const errorSchema = registry.register('ErrorResponse', ErrorResponse);

  const ops = allOperations();
  const unknownKeys = Object.keys(DOCS).filter((k) => !ops.some((o) => `${o.method.toUpperCase()} ${o.path}` === k));
  if (unknownKeys.length) throw new Error(`openapi/docs.ts documents routes that do not exist: ${unknownKeys.join(', ')}`);

  for (const op of ops) {
    const key = `${op.method.toUpperCase()} ${op.path}`;
    const doc = DOCS[key];
    const extra = EXTRA_DOCS[key];
    const params = pathParams(op.path);

    const responses: Record<string, any> = {};
    if (doc?.response) {
      responses[doc.response.status] = {
        description: doc.response.description ?? 'Success',
        ...(doc.response.schema ? { content: { 'application/json': { schema: doc.response.schema } } } : {}),
      };
    } else {
      responses['200'] = { description: 'Success (response body not yet described)' };
    }
    const errors = new Set<number>([...(doc?.errors ?? []), ...(op.security === 'session' ? [401] : []), ...(op.roles ? [403] : [])]);
    for (const status of [...errors].sort()) {
      responses[status] = { description: ERROR_TEXT[status] ?? 'Error', content: { 'application/json': { schema: errorSchema } } };
    }

    registry.registerPath({
      method: op.method,
      path: toOpenApiPath(op.path),
      operationId: camel(`${op.method} ${op.path.replace(/^\/api\/v1/, '')}`) || `${op.method}Root`,
      summary: doc?.summary ?? extra?.summary,
      tags: [extra?.tag ?? tagOf(op.path)],
      security: SECURITY[op.security],
      request: {
        ...(params.length ? { params: z.object(Object.fromEntries(params.map((p) => [p, z.string()]))) } : {}),
        ...(doc?.query ? { query: doc.query } : {}),
        ...(doc?.body ? { body: { required: true, content: { 'application/json': { schema: doc.body } } } } : {}),
      },
      responses,
      ...(op.roles ? { 'x-required-roles': op.roles } : {}),
    } as any);
  }

  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Enterprise LMS API',
      version: '1.0.0',
      description:
        'Generated from the routes the server actually mounts. Every route is listed with its authentication and required roles; request and response schemas are filled in for the documented endpoints and are being extended. Errors are `{ error, details?, requestId }`.',
    },
    servers: [{ url: '/' }],
  });
}
