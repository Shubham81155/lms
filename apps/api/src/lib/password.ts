import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128; // bcrypt only uses the first 72 bytes; cap input to bound CPU

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, config.BCRYPT_ROUNDS);
}

// Compared against when the account does not exist so response time does not reveal it.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', config.BCRYPT_ROUNDS);

export interface PasswordCheck {
  valid: boolean;
  /** True when the stored hash uses a legacy scheme and should be replaced with bcrypt. */
  needsRehash: boolean;
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && ab.length > 0 && crypto.timingSafeEqual(ab, bb);
}

/**
 * Verifies a password against a stored hash.
 * bcrypt is the current scheme. Legacy `salt:scrypt` and unsalted SHA-256 hashes still
 * verify so existing accounts can sign in once and be upgraded; plaintext is never accepted.
 */
export async function verifyPassword(candidate: string, stored: string | null): Promise<PasswordCheck> {
  if (!stored) {
    await bcrypt.compare(candidate, DUMMY_HASH);
    return { valid: false, needsRehash: false };
  }

  if (/^\$2[aby]\$/.test(stored)) {
    const valid = await bcrypt.compare(candidate, stored);
    return { valid, needsRehash: valid && bcrypt.getRounds(stored) < config.BCRYPT_ROUNDS };
  }

  if (/^[0-9a-f]{64}$/i.test(stored)) {
    const sha = crypto.createHash('sha256').update(candidate).digest('hex');
    const valid = safeEqualHex(sha, stored);
    return { valid, needsRehash: valid };
  }

  const parts = stored.split(':');
  if (parts.length === 2) {
    try {
      const derived = crypto.scryptSync(candidate, parts[0], 64).toString('hex');
      const valid = safeEqualHex(derived, parts[1]);
      return { valid, needsRehash: valid };
    } catch {
      return { valid: false, needsRehash: false };
    }
  }

  await bcrypt.compare(candidate, DUMMY_HASH);
  return { valid: false, needsRehash: false };
}
