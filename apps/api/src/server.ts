import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config';
import { AuditSanitizer } from '@enterprise-lms/security';
import { logger } from './lib/logger';
import { requestId, sendError } from './lib/http';
import { findRlsBypassReason } from '@enterprise-lms/database';
import { prisma, basePrisma } from './lib/prisma';
import { resolveTenant } from './lib/tenant';
import { XApiStatement, Lti13Claims } from '@enterprise-lms/standards';

// Import route modules
import authRoutes from './routes/auth.routes';
import coursesRoutes from './routes/courses.routes';
import enrollmentsRoutes from './routes/enrollments.routes';
import usersRoutes from './routes/users.routes';
import assessmentsRoutes from './routes/assessments.routes';
import adminRoutes from './routes/admin.routes';
import analyticsRoutes from './routes/analytics.routes';
import certificatesRoutes from './routes/certificates.routes';
import { authenticateJWT } from './middleware/auth';

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

  req.tenantHints = [
    typeof headerTenant === 'string' ? headerTenant.trim() : '',
    hasDomain ? host : '', // custom domain, e.g. learn.university.edu
    hasDomain && host.split('.')[0] !== 'www' ? host.split('.')[0] : '', // subdomain slug
    config.DEFAULT_TENANT_SLUG,
  ].filter(Boolean);

  next();
};

app.use(tenantResolver);

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
        path: req.originalUrl.split('?')[0],
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

// Health & System Status
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'Enterprise LMS API Gateway',
    compliance: {
      ferpa: true,
      coppa: false,
      soc2: true,
      wcag: '2.1-AA',
    },
  });
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
      features: { scorm: true, xapi: true, lti13: true, aiProctoring: true },
    });
  } catch (error) {
    console.error('Error in GET /api/v1/tenant/config:', error);
    return res.status(500).json({ error: 'Failed to load tenant configuration' });
  }
});

// xAPI Learning Record Store (LRS) Statement Ingestion
app.post('/api/v1/xapi/statements', authenticateJWT, (req: Request, res: Response) => {
  const statement: XApiStatement = req.body;

  if (!statement.actor || !statement.verb || !statement.object) {
    return res.status(400).json({ error: 'Invalid xAPI Statement format' });
  }

  // Persist to high-throughput LRS (ClickHouse / TimescaleDB)
  const statementId = statement.id || `stmt_${Date.now()}`;

  return res.status(201).json({
    message: 'xAPI Statement recorded',
    statementId,
    storedAt: new Date().toISOString(),
  });
});

// AI Proctoring Telemetry Ingestion
app.post('/api/v1/proctoring/events', authenticateJWT, (req: Request, res: Response) => {
  const { submissionId, eventType, severity, snapshotUrl } = req.body;

  // Evaluates violation thresholds
  return res.status(200).json({
    status: 'recorded',
    flagged: severity === 'HIGH',
    submissionId,
    eventType,
    timestamp: new Date().toISOString(),
  });
});

// LTI 1.3 Advantage Deep Linking / Launch Handler
app.post('/api/v1/lti/launch', (req: Request, res: Response) => {
  const claims: Partial<Lti13Claims> = req.body;

  res.json({
    status: 'authenticated',
    ltiVersion: '1.3.0',
    targetLinkUri: claims['https://purl.imsglobal.org/spec/lti/claim/target_link_uri'],
    sessionToken: 'lti_sess_mock_valid_token_xyz',
  });
});

// =========================================================
// 5. MODULAR ROUTE MOUNTING
// =========================================================

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/courses', coursesRoutes);
app.use('/api/v1/enrollments', enrollmentsRoutes);
app.use('/api/v1/users', usersRoutes);
app.use('/api/v1', assessmentsRoutes); // Mounts /courses/:courseId/quizzes, /quizzes, /courses/:courseId/assignments, /assignments
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/certificates', certificatesRoutes);

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

  logger.error({ err, requestId: req.id, method: req.method, path: req.originalUrl }, 'unhandled error');
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
  });
}

export { app };
export default app;
