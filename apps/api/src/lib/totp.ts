import crypto from 'crypto';

// RFC 6238 TOTP (SHA-1, 6 digits, 30 s) so it works with Google Authenticator, Authy, 1Password...

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export const generateSecret = () => base32Encode(crypto.randomBytes(20));

export function totp(secretB32: string, timeMs: number = Date.now(), stepSec = 30, digits = 6): string {
  const counter = Math.floor(timeMs / 1000 / stepSec);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secretB32)).update(msg).digest();
  const offset = h[h.length - 1] & 0xf;
  const code = (h.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return code.toString().padStart(digits, '0');
}

/** Accepts the current code and one step either side (clock drift). Constant-time compare. */
export function verifyTotp(secretB32: string, code: string, timeMs: number = Date.now(), window = 1): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  let ok = false;
  for (let w = -window; w <= window; w++) {
    const expected = Buffer.from(totp(secretB32, timeMs + w * 30_000));
    if (crypto.timingSafeEqual(expected, Buffer.from(code))) ok = true;
  }
  return ok;
}

export const otpauthUrl = (secret: string, account: string, issuer: string) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

/** Single-use recovery codes: shown once, only their SHA-256 hashes are stored. */
export function generateRecoveryCodes(n = 8): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: n }, () => crypto.randomBytes(5).toString('hex'));
  return { codes, hashes: codes.map(hashRecoveryCode) };
}
export const hashRecoveryCode = (c: string) => crypto.createHash('sha256').update(c.trim().toLowerCase()).digest('hex');
