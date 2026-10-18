import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { AuditSanitizer } from '@enterprise-lms/security';
import { logger } from './lib/logger';
import { requestId, sendError } from './lib/http';
import { findRlsBypassReason } from '@enterprise-lms/database';
import { prisma, basePrisma } from './lib/prisma';
import { resolveTenant } from './lib/tenant';
import { tenantFeatures } from './lib/features';
import { rateLimitStore } from './lib/rate-limit-store';

import { apiMounts, rawBodyMounts } from './mounts';
import { buildOpenApi } from './openapi/spec';
import { startEmailDispatcher } from './lib/email-dispatch';
import { startWebhookRetryWorker } from './lib/webhooks';
import { startFileScanSweep, virusScanner } from './lib/virus-scan';
import { startPlagiarismSubmitWorker } from './lib/plagiarism-submit';

const app = express();
const PORT = config.PORT;

app.use(requestId);

// Needed for correct client IPs (rate limiting, audit) when behind a reverse proxy.
if (config.TRUST_PROXY > 0) app.set('trust proxy', config.TRUST_PROXY);

// =========================================================
// 1. ENTERPRISE SECURITY & COMPLIANCE MIDDLEWARE
// =========================================================

// Helmet with enterprise CSP & clickjacking protection (configurable for LTI)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        frameAncestors: ["'self'", 'https://*.canvaslms.com', 'https://*.blackboard.com'], // Whitelisted LMS tool consumers
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  })
);

// Only configured browser origins may make credentialed cross-origin calls.
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
  })
);
// Signed provider callbacks need the raw bytes, so they are mounted ahead of the JSON parser.
for (const m of rawBodyMounts) app.use(m.prefix, m.router);
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// =========================================================
// 2. TENANT HINT RESOLVER
// =========================================================
// Pre-authentication only. The x-tenant-id header and the request host are *hints* used by
// public routes (login, tenant branding) to look up a tenant in the database. Once a request is
// authenticated the tenant comes from the verified token (middleware/auth.ts), never from here.
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

const tenantResolver = (req: Request, _res: Response, next: NextFunction) => {
  const headerTenant = req.headers['x-tenant-id'];
  // Behind the Next.js proxy / a load balancer the original host arrives in X-Forwarded-Host.
  // It is only believed when a trusted proxy is configured, otherwise clients could spoof it.
  const forwarded = config.TRUST_PROXY > 0 ? req.headers['x-forwarded-host'] : undefined;
  const rawHost = String(Array.isArray(forwarded) ? forwarded[0] : forwarded || req.headers.host || '');
  const host = rawHost.split(',')[0].trim().split(':')[0].toLowerCase();
  const hasDomain = host.includes('.') && !IPV4.test(host);

  req.publicHost = rawHost.split(',')[0].trim().toLowerCase();

  req.tenantHints = [
    typeof headerTenant === 'string' ? headerTenant.trim() : '',
    hasDomain ? host : '', // custom domain, e.g. learn.university.edu
    hasDomain && host.split('.')[0] !== 'www' ? host.split('.')[0] : '', // subdomain slug
    config.DEFAULT_TENANT_SLUG,
  ].filter(Boolean);

  next();
};

app.use(tenantResolver);

// With a SCORM content origin configured, that host answers only /scorm-content (and health checks), and
// other hosts never serve /scorm-content: package scripts stay on an origin with no session and no API.
if (config.SCORM_CONTENT_ORIGIN) {
  const contentHost = new URL(config.SCORM_CONTENT_ORIGIN).host.toLowerCase();
  app.use((req: Request, res: Response, next: NextFunction) => {
    const onContentHost = (req.publicHost ?? '') === contentHost;
    const contentPath = req.path.startsWith('/scorm-content/');
    if (onContentHost !== contentPath && !['/health', '/ready'].includes(req.path)) return res.status(404).json({ error: 'Not found' });
    next();
  });
}

// Baseline abuse protection for every API call; login and token flows have stricter limits of their
// own (auth.routes.ts). Signed provider callbacks are mounted above and are not limited here.
const apiLimiterOptions = { windowMs: 60_000, standardHeaders: 'draft-7', legacyHeaders: false } as const;
app.use(
  '/api/v1',
  rateLimit({ ...apiLimiterOptions, limit: config.API_RATE_LIMIT_MAX, store: rateLimitStore('api'), passOnStoreError: true, message: { error: 'Too many requests. Slow down and try again shortly.' } })
);
app.use(
  '/api/v1',
  rateLimit({
    ...apiLimiterOptions,
    limit: config.API_WRITE_RATE_LIMIT_MAX,
    store: rateLimitStore('api-write'),
    passOnStoreError: true,
    skip: (req) => req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS',
    message: { error: 'Too many changes in a short time. Try again shortly.' },
  })
);

// =========================================================
// 3. STRUCTURED REQUEST LOGGING
// =========================================================
// One JSON line per request. Bodies are never logged unless LOG_REQUEST_BODIES=true, and then
// only after masking. The durable audit trail is the AuditLog table, written by the routes.
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info(
      {
        requestId: req.id,
        tenantId: req.tenantId,
        userId: req.user?.id,
        method: req.method,
        // SCORM content URLs carry a learner's token; it is not logged.
        path: req.originalUrl.split('?')[0].replace(/^\/scorm-content\/[^/]+/, '/scorm-content/<token>'),
        statusCode: res.statusCode,
        durationMs: Date.now() - start,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        ...(config.LOG_REQUEST_BODIES ? { payload: AuditSanitizer.sanitize(req.body || {}) } : {}),
      },
      'request'
    );
  });
  next();
});

// =========================================================
// 4. CORE API ROUTES
// =========================================================

// Liveness: the process is up. Says nothing about compliance; the measured posture is the
// authenticated GET /api/v1/admin/compliance report.
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString(), service: 'enterprise-lms-api' });
});

// Readiness: only report ready when the database answers, so load balancers stop routing to an
// instance that has lost it.
app.get('/ready', async (_req: Request, res: Response) => {
  try {
    await basePrisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready', timestamp: new Date().toISOString() });
  } catch (error) {
    logger.error({ err: error }, 'readiness check failed');
    res.status(503).json({ status: 'unavailable' });
  }
});

// Machine-readable description of this API (OpenAPI 3), generated from the mounted routes.
let openApiDocument: ReturnType<typeof buildOpenApi> | undefined;
app.get('/api/v1/openapi.json', (_req: Request, res: Response) => {
  openApiDocument ??= buildOpenApi();
  res.json(openApiDocument);
});

// Tenant Metadata & Branding Endpoint (public; used to brand the login page)
app.get('/api/v1/tenant/config', async (req: Request, res: Response) => {
  try {
    const resolved = await resolveTenant(req.tenantHints);
    if (!resolved) return res.status(404).json({ error: 'Tenant not found' });

    const tenant = await prisma.tenant.findUnique({
      where: { id: resolved.id },
      select: {
        id: true,
        slug: true,
        name: true,
        logoUrl: true,
        faviconUrl: true,
        primaryColor: true,
        secondaryColor: true,
      },
    });
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    return res.json({
      tenantId: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      theme: {
        primaryColor: tenant.primaryColor,
        secondaryColor: tenant.secondaryColor,
        logoUrl: tenant.logoUrl,
        faviconUrl: tenant.faviconUrl,
      },
      features: await tenantFeatures(tenant.id),
    });
  } catch (error) {
    logger.error({ err: error }, 'Error in GET /api/v1/tenant/config');
    return res.status(500).json({ error: 'Failed to load tenant configuration' });
  }
});

// =========================================================
// 5. MODULAR ROUTE MOUNTING
// =========================================================

for (const m of apiMounts) app.use(m.prefix, m.router); // order, and the root-mounted routers that come last, are defined in mounts.ts

// =========================================================
// 6. 404 & GLOBAL ERROR HANDLING
// =========================================================

// Catch-all 404 Handler
app.use((req: Request, res: Response) => {
  sendError(req, res, 404, 'Endpoint not found');
});

// Global Centralized Error Handler. Route handlers handle their own errors (lib/http.ts); this
// catches what escapes middleware, such as malformed JSON bodies. Internals are never returned.
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  if (err?.type === 'entity.parse.failed') return sendError(req, res, 400, 'Request body is not valid JSON');
  if (err?.type === 'entity.too.large') return sendError(req, res, 413, 'Request body is too large');

  logger.error({ err, requestId: req.id, method: req.method, path: req.originalUrl.replace(/^\/scorm-content\/[^/?]+/, '/scorm-content/<token>') }, 'unhandled error');
  const body: Record<string, unknown> = { error: 'Internal Server Error', requestId: req.id };
  if (config.NODE_ENV === 'development') body.detail = err?.message;
  res.status(500).json(body);
});

// =========================================================
// 7. SERVER START
// =========================================================
async function verifyTenantIsolation(): Promise<void> {
  try {
    const reason = await findRlsBypassReason(basePrisma);
    if (!reason) return;
    const message = `Row-level security is NOT enforced: ${reason}. Connect the API (DATABASE_URL) as the non-privileged lms_app role.`;
    if (config.NODE_ENV === 'production') {
      logger.fatal(message);
      process.exit(1);
    }
    logger.warn(`${message} Tenant isolation currently relies on application queries only.`);
  } catch (error) {
    logger.warn({ err: error }, 'Could not verify row-level security (is the database reachable?)');
    if (config.NODE_ENV === 'production') process.exit(1);
  }
}

if (config.NODE_ENV !== 'test') {
  verifyTenantIsolation().then(() => {
    app.listen(PORT, () => {
      logger.info({ port: PORT }, 'Enterprise LMS API listening');
    });
    startEmailDispatcher();
    startWebhookRetryWorker();
    startPlagiarismSubmitWorker();
    startFileScanSweep();
    if (!virusScanner() && config.NODE_ENV === 'production') {
      logger.warn('Uploads are not scanned for viruses: set CLAMAV_URL (e.g. tcp://clamav:3310) to a ClamAV daemon.');
    }
  });
}

export { app };
export default app;
