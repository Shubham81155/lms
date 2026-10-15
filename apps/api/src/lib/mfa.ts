import { FieldEncryption } from '@enterprise-lms/security';
import { prisma } from './prisma';
import { hashRecoveryCode, verifyTotp } from './totp';

let enc: FieldEncryption | null = null;
const crypt = () => (enc ??= new FieldEncryption());

export const encryptSecret = (secret: string) => crypt().encrypt(secret);
export const decryptSecret = (stored: string) => crypt().decrypt(stored);

/**
 * Checks a second factor: the current TOTP code, or an unused recovery code (which is consumed).
 * Recovery codes are removed with a conditional update so two concurrent requests cannot both use one.
 */
export async function verifySecondFactor(
  user: { id: string; mfaSecret: string | null; mfaRecoveryHashes: string[] },
  code: string
): Promise<boolean> {
  if (!user.mfaSecret) return false;
  const trimmed = code.trim();
  if (/^\d{6}$/.test(trimmed)) return verifyTotp(decryptSecret(user.mfaSecret), trimmed);

  const hash = hashRecoveryCode(trimmed);
  if (!user.mfaRecoveryHashes.includes(hash)) return false;
  const fresh = await prisma.user.findUnique({ where: { id: user.id }, select: { mfaRecoveryHashes: true } });
  if (!fresh?.mfaRecoveryHashes.includes(hash)) return false;
  const res = await prisma.user.updateMany({
    where: { id: user.id, mfaRecoveryHashes: { has: hash } },
    data: { mfaRecoveryHashes: fresh.mfaRecoveryHashes.filter((h) => h !== hash) },
  });
  return res.count === 1;
}
