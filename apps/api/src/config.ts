import path from 'path';
import dotenv from 'dotenv';
import { z } from 'zod';

// The monorepo keeps a single .env at the repository root.
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// Values that ship in .env.example or older revisions of this repo; never acceptable.
const KNOWN_WEAK_SECRETS = [
  'super-secure-enterprise-jwt-secret-key-change-in-prod',
  'enterprise-lms-jwt-secret-key-2026',
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
];

const secret = (name: string, min: number, format?: { pattern: RegExp; message: string }) => {
  let base = z
    .string({ required_error: `${name} is required` })
    .min(min, `${name} must be at least ${min} characters`);
  if (format) base = base.regex(format.pattern, format.message);
  return base
    .refine((v) => !v.startsWith('CHANGE_ME'), `${name} is still the CHANGE_ME placeholder`)
    .refine((v) => !KNOWN_WEAK_SECRETS.includes(v), `${name} is a publicly known default value`);
};

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  JWT_SECRET: secret('JWT_SECRET', 32),
  JWT_EXPIRES_IN: z.string().default('8h'),
  PII_ENCRYPTION_KEY: secret('PII_ENCRYPTION_KEY', 64, {
    pattern: /^[0-9a-fA-F]{64}$/,
    message: 'PII_ENCRYPTION_KEY must be 32 bytes encoded as 64 hex characters',
  }),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  DEFAULT_TENANT_SLUG: z.string().min(1).default('default-tenant'),
  /** Slug of the organisation whose super administrators manage every organisation's plan. Unset: nobody can, through the API. */
  PLATFORM_OPERATOR_TENANT: z.string().min(1).optional(),
  APP_URL: z.string().url().default('http://localhost:3000'),
  /**
   * Parent domain under which every organisation gets its own address, `<slug>.<TENANT_BASE_DOMAIN>`, as host[:port]
   * (e.g. lms.example.com; in development localhost:3000, since browsers resolve *.localhost locally). Unset: a
   * single address (APP_URL) serves the default organisation and organisations with a custom domain.
   */
  TENANT_BASE_DOMAIN: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/, 'TENANT_BASE_DOMAIN must be a host name, optionally with a port')
    .optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_REQUEST_BODIES: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  /** Whether institutions may ask to register an organisation from the public site (the operator approves each). */
  ORG_REGISTRATION_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Organisation registration requests per IP per hour. */
  ORG_REQUEST_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  TOKEN_FLOW_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  /** Optional. When set, rate-limit counters are shared by every API instance; otherwise they are per process. */
  REDIS_URL: z.string().url().optional(),
  /** Per-IP requests per minute across /api/v1 (reads), and for state-changing methods. In-memory per instance. */
  API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),
  API_WRITE_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  MAX_FAILED_LOGINS: z.coerce.number().int().positive().default(5),
  LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
  /** smtp:// or smtps:// URL of the mail server. Without it, mail is printed in development and dropped in production. */
  SMTP_URL: z.string().url().optional(),
  MAIL_FROM: z.string().min(3).default('Enterprise LMS <no-reply@localhost>'),
  /** Seconds between webhook retry sweeps; 0 turns the background worker off. */
  WEBHOOK_RETRY_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(30),
  /** How often queued notification e-mails are sent, in seconds. 0 turns the background sender off. */
  EMAIL_DISPATCH_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(60),
  /** LiveKit media server for live classes. All three are needed; without them live classes are off. */
  LIVEKIT_URL: z.string().url().optional(),
  LIVEKIT_API_KEY: z.string().min(3).optional(),
  LIVEKIT_API_SECRET: z.string().min(32, 'LIVEKIT_API_SECRET must be at least 32 characters').optional(),
  /** Shared secret for inbound plagiarism-provider callbacks; the endpoint is off when unset. */
  PLAGIARISM_WEBHOOK_SECRET: z.string().min(32, 'PLAGIARISM_WEBHOOK_SECRET must be at least 32 characters').optional(),
  /** Outbound similarity checks: where text submissions are sent. Needs PLAGIARISM_WEBHOOK_SECRET (signs the request) and API_PUBLIC_URL (callback address). */
  PLAGIARISM_SUBMIT_URL: z.string().url().optional(),
  /** Public base URL of this API as the provider sees it, e.g. https://api.example.com */
  API_PUBLIC_URL: z.string().url().optional(),
  /**
   * Copyleaks (https://copyleaks.com) as the similarity provider, instead of PLAGIARISM_SUBMIT_URL: the account
   * e-mail and API key from its API dashboard. Also needs PLAGIARISM_WEBHOOK_SECRET and API_PUBLIC_URL.
   */
  COPYLEAKS_EMAIL: z.string().email().optional(),
  COPYLEAKS_API_KEY: z.string().min(10, 'COPYLEAKS_API_KEY looks too short').optional(),
  /** Sandbox scans return made-up results and use no credits; for trying the integration. */
  COPYLEAKS_SANDBOX: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Overridable for tests only. */
  COPYLEAKS_ID_URL: z.string().url().default('https://id.copyleaks.com'),
  COPYLEAKS_API_URL: z.string().url().default('https://api.copyleaks.com'),
  /** Seconds between outbound plagiarism submission sweeps; 0 turns the background worker off. */
  PLAGIARISM_SUBMIT_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(30),
  /**
   * Platform-wide AI provider for the study tutor and course-outline drafts. Organisations can enter their own
   * provider and key in the admin screen instead; without either, the AI features are off.
   */
  AI_PROVIDER: z.enum(['ANTHROPIC', 'GEMINI', 'XAI']).optional(),
  AI_API_KEY: z.string().min(20, 'AI_API_KEY looks too short').optional(),
  /** Defaults to the provider's recommended model (lib/ai.ts). */
  AI_MODEL: z.string().min(3).optional(),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300_000).default(60_000),
  /** AI requests each person may make per hour (they cost money). */
  AI_REQUESTS_PER_HOUR: z.coerce.number().int().positive().default(60),
  /** Provider endpoints; override only for a proxy or a test stand-in. */
  ANTHROPIC_API_URL: z.string().url().default('https://api.anthropic.com'),
  GEMINI_API_URL: z.string().url().default('https://generativelanguage.googleapis.com/v1beta'),
  XAI_API_URL: z.string().url().default('https://api.x.ai/v1'),
  /**
   * Where uploaded files are kept: "local" (a folder on this server; fine for development and single-server
   * installs) or "s3" (any S3-compatible service: AWS S3, Cloudflare R2, MinIO, Backblaze B2).
   */
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  /** Folder for the local driver; relative paths are resolved from the repository root. */
  STORAGE_LOCAL_DIR: z.string().min(1).default('storage'),
  S3_BUCKET: z.string().min(3).optional(),
  S3_REGION: z.string().min(1).default('us-east-1'),
  /** For services other than AWS, e.g. https://<account>.r2.cloudflarestorage.com or http://localhost:9000 (MinIO). */
  S3_ENDPOINT: z.string().url().optional(),
  /** Without these the AWS default credential chain is used (instance role, AWS_* variables). */
  S3_ACCESS_KEY_ID: z.string().min(3).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(8).optional(),
  /** MinIO and some others need path-style URLs (endpoint/bucket/key). */
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /**
   * Where SCORM packages are served from: an origin of its own (e.g. https://content.example.org) pointing
   * at this API, never the web app's origin, so a package's scripts cannot act as the signed-in learner. It
   * must not share a cookie domain with the web app. Unset: SCORM is off in production; in development
   * http://127.0.0.1:<PORT> is used (a different origin from localhost).
   */
  SCORM_CONTENT_ORIGIN: z.string().url().optional(),
  /** Largest upload accepted, in megabytes. The web app's proxy limit (next.config.ts) must be at least this. */
  UPLOAD_MAX_MB: z.coerce.number().int().min(1).max(5120).default(100),
  /**
   * ClamAV daemon (clamd) that every upload is scanned with before it is stored, e.g. tcp://clamav:3310. Its
   * StreamMaxLength must be at least UPLOAD_MAX_MB. Set: uploads are refused while it cannot be reached.
   * Unset: uploads are stored unscanned (a warning is logged in production).
   */
  CLAMAV_URL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().regex(/^tcp:\/\/[^\s:/]+:\d{1,5}$/, 'CLAMAV_URL must look like tcp://host:3310').optional()
  ),
  CLAMAV_TIMEOUT_MS: z.coerce.number().int().min(1000).default(120_000),
  /** How often files stored before scanning was set up are scanned, in seconds (0 turns the sweep off). */
  FILE_SCAN_SWEEP_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(300),
}).refine((c) => c.STORAGE_DRIVER !== 's3' || !!c.S3_BUCKET, { message: 'STORAGE_DRIVER=s3 needs S3_BUCKET' })
  .refine((c) => !c.S3_ACCESS_KEY_ID === !c.S3_SECRET_ACCESS_KEY, { message: 'Set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither' })
  .refine((c) => !c.COPYLEAKS_EMAIL === !c.COPYLEAKS_API_KEY, { message: 'Set both COPYLEAKS_EMAIL and COPYLEAKS_API_KEY, or neither' })
  .refine((c) => !(c.COPYLEAKS_API_KEY && c.PLAGIARISM_SUBMIT_URL), { message: 'Use either Copyleaks or PLAGIARISM_SUBMIT_URL, not both' });

export type AppConfig = z.infer<typeof envSchema> & { corsOrigins: string[] };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return {
    ...parsed.data,
    corsOrigins: parsed.data.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  };
}

export const config = loadConfig();
