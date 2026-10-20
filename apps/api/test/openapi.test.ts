import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import { execFileSync } from 'child_process';
import path from 'path';
import request from 'supertest';

vi.mock('../src/lib/prisma', async () => {
  const { createFakePrisma } = await import('./helpers.js');
  const fake = createFakePrisma();
  return {
    prisma: fake,
    default: fake,
    basePrisma: fake,
    runInTenantTransaction: async (_tenantId: string, fn: (tx: unknown) => Promise<unknown>) => fn(fake),
  };
});

import { app } from '../src/server';
import { allOperations, buildOpenApi, UNDESCRIBABLE } from '../src/openapi/spec';
import { stringifyOpenApi } from '../src/openapi/serialize';

const ops = allOperations();
const label = (o: { method: string; path: string }) => `${o.method.toUpperCase()} ${o.path}`;

describe('API description', () => {
  it('is up to date: run `npm run openapi -w @enterprise-lms/api` after changing routes or schemas', () => {
    const committed = fs.readFileSync(path.resolve(__dirname, '../openapi.json'), 'utf8').replace(/\r\n/g, '\n');
    expect(committed).toBe(stringifyOpenApi(buildOpenApi()));
  });

  it('has matching generated web types: run `npm run api:sync` after changing the API', () => {
    const root = path.resolve(__dirname, '../../..');
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lms-types-')), 'api-schema.ts');
    execFileSync(process.execPath, [path.join(root, 'node_modules/openapi-typescript/bin/cli.js'), path.join(root, 'apps/api/openapi.json'), '-o', out], { stdio: 'pipe' });
    const norm = (f: string) => fs.readFileSync(f, 'utf8').split(String.fromCharCode(13)).join('');
    expect(norm(path.join(root, 'apps/web/src/lib/api-schema.ts'))).toBe(norm(out));
  });

  it('describes every operation, with a summary and every request schema expressible', () => {
    const doc: any = buildOpenApi();
    const missing = Object.entries(doc.paths).flatMap(([p, item]: [string, any]) =>
      Object.entries(item).filter(([, op]: [string, any]) => !op.summary).map(([m]) => `${m.toUpperCase()} ${p}`)
    );
    expect(missing).toEqual([]);
    expect(UNDESCRIBABLE).toEqual([]);
  });

  it('describes a success response for every operation', () => {
    const doc: any = buildOpenApi();
    const undescribed = Object.entries(doc.paths).flatMap(([p, item]: [string, any]) =>
      Object.entries(item)
        .filter(([, op]: [string, any]) => JSON.stringify(op.responses).includes('not yet described'))
        .map(([m]) => `${m.toUpperCase()} ${p}`)
    );
    expect(undescribed).toEqual([]);
  });

  it('is served by the API', async () => {
    const res = await request(app).get('/api/v1/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toMatch(/^3\./);
    expect(Object.keys(res.body.paths).length).toBeGreaterThan(100);
  });

  it('lists every route the server mounts, exactly once', () => {
    const doc: any = buildOpenApi();
    const described = Object.entries(doc.paths).flatMap(([p, item]: [string, any]) =>
      Object.keys(item).map((m) => `${m.toUpperCase()} ${p}`)
    );
    expect(new Set(described).size).toBe(described.length);
    expect(described.length).toBe(ops.length);
  });
});

describe('authentication coverage', () => {
  // Every route that is not guarded by a session must be named here. A new route that is public by
  // accident (a missing authenticateJWT) makes this test fail until someone decides it is intended.
  const EXPECTED_NOT_SESSION_GUARDED = [
    'GET /api/v1/auth/saml/metadata/:slug',
    'GET /api/v1/auth/saml/start',
    'GET /api/v1/auth/sso/callback',
    'GET /api/v1/auth/sso/start',
    'GET /api/v1/auth/sso/status',
    'GET /api/v1/certificates/verify/:number',
    'GET /api/v1/openapi.json',
    'GET /api/v1/scim/v2/ServiceProviderConfig',
    'GET /api/v1/scim/v2/Users',
    'GET /api/v1/scim/v2/Users/:id',
    'GET /api/v1/tenant/config',
    'GET /health',
    // The reverse proxy's TLS check: guarded by TLS_ASK_SECRET, and off without it.
    'GET /internal/tls/allowed',
    'GET /ready',
    // Prometheus scrape: guarded by METRICS_TOKEN, off without it.
    'GET /metrics',
    'DELETE /api/v1/scim/v2/Users/:id',
    'PATCH /api/v1/scim/v2/Users/:id',
    'POST /api/v1/auth/forgot-password',
    'POST /api/v1/auth/login',
    'POST /api/v1/auth/logout',
    'POST /api/v1/auth/reset-password',
    'POST /api/v1/auth/saml/acs',
    'POST /api/v1/auth/verify-email',
    'POST /api/v1/billing/webhook',
    'POST /api/v1/integrations/livekit',
    'POST /api/v1/integrations/plagiarism/:tenantSlug',
    'POST /api/v1/integrations/copyleaks/:tenantSlug/:submissionId/:status',
    'GET /api/v1/organizations/availability',
    'GET /api/v1/organizations/captcha',
    'GET /api/v1/organizations/lookup',
    'POST /api/v1/organizations/find',
    'POST /api/v1/organizations/requests',
    'POST /api/v1/organizations/requests/confirm',
    // The support handoff: guarded by a one-time token the platform operator was given (routes/support.routes.ts).
    'POST /api/v1/support/enter',
    'POST /api/v1/lti/launch',
    'POST /api/v1/scim/v2/Users',
    'PUT /api/v1/scim/v2/Users/:id',
    // SCORM package pages: guarded by a signed per-learner token in the path, on their own origin.
    'GET /scorm-content/:token/__launch',
    'GET /scorm-content/:token/__state',
    'POST /scorm-content/:token/__commit',
    'GET /scorm-content/:token/*',
  ].sort();

  it('only the intended routes are reachable without a session', () => {
    const open = ops.filter((o) => o.security !== 'session').map(label).sort();
    expect(open).toEqual(EXPECTED_NOT_SESSION_GUARDED);
  });

  const guarded = ops.filter((o) => o.security === 'session');
  it.each(guarded.map((o) => [label(o), o] as const))('%s answers 401 without a token', async (_name, op) => {
    const url = op.path.replace(/:([A-Za-z0-9_]+)/g, 'x');
    const res = await (request(app) as any)[op.method](url).send({});
    expect(res.status).toBe(401);
  });

  it('describes the required roles of guarded routes', () => {
    const doc: any = buildOpenApi();
    expect(doc.paths['/api/v1/admin/export'].get['x-required-roles']).toEqual(['SUPER_ADMIN', 'TENANT_ADMIN']);
  });
});
