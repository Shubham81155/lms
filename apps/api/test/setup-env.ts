import crypto from 'crypto';

// Explicit test values. dotenv never overrides variables that are already set,
// so the developer's real .env cannot leak into (or break) the test run.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('base64url');
process.env.PII_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
process.env.BCRYPT_ROUNDS = '4';
process.env.LOGIN_RATE_LIMIT_MAX = '1000';
process.env.TOKEN_FLOW_RATE_LIMIT_MAX = '1000';
process.env.MAX_FAILED_LOGINS = '3';
process.env.LOCKOUT_MINUTES = '15';
process.env.DEFAULT_TENANT_SLUG = 'harvard';
process.env.CORS_ORIGINS = 'http://localhost:3000';
process.env.APP_URL = 'http://localhost:3000';
