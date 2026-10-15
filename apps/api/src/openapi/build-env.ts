// Imported first by build.ts: describing the API only reads route tables, so placeholder
// configuration is enough (the server's config validation runs when the routes are loaded).
import crypto from 'crypto';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= crypto.randomBytes(48).toString('base64url');
process.env.PII_ENCRYPTION_KEY ||= crypto.randomBytes(32).toString('hex');
process.env.DATABASE_URL ||= 'postgresql://unused:unused@localhost:5432/unused';
