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
  APP_URL: z.string().url().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_REQUEST_BODIES: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  TOKEN_FLOW_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  MAX_FAILED_LOGINS: z.coerce.number().int().positive().default(5),
  LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
});

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
