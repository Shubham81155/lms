import crypto from 'crypto';

/** Random URL-safe token to email to the user; only its hash is stored. */
export function generateOneTimeToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashOneTimeToken(token) };
}

export function hashOneTimeToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
