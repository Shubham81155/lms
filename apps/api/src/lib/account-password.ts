import { prisma } from './prisma';
import { hashPassword } from './password';
import { invalidateSessionCache } from './session';

export const PASSWORDLESS_MESSAGE =
  'This account has no password yet. Use "Forgot password" on the sign-in page to set one from an e-mailed link.';

/** A tenant admin may reset anyone but the administrators; only a super admin may reset an administrator. */
export function mayResetPasswordOf(actorRole: string, targetRole: string): boolean {
  if (actorRole === 'SUPER_ADMIN') return true;
  return actorRole === 'TENANT_ADMIN' && targetRole !== 'SUPER_ADMIN' && targetRole !== 'TENANT_ADMIN';
}

/**
 * Stores a new password and signs the account out everywhere: the token-version bump kills every issued
 * token, so a stolen session does not outlive the change. Callers re-issue a session for the person who made it.
 */
export async function setPasswordAndRevokeSessions(userId: string, newPassword: string): Promise<void> {
  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, failedLoginCount: 0, lockedUntil: null, tokenVersion: { increment: 1 } },
  });
  invalidateSessionCache(userId);
}
