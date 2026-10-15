import { prisma } from './prisma';
import { config } from '../config';
import { generateOneTimeToken } from './one-time-token';
import { mailDelivers, sendMail } from './mailer';

export type InvitationResult = 'sent' | 'failed' | 'not_configured';

/** How long an invitation link stays valid. Longer than a password reset: people read email later. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Emails a person a link to choose their first password. The link is a password-reset token for an
 * INVITED account; using it activates the account. Earlier unused links are cancelled.
 *  - 'sent': the mail transport accepted the message
 *  - 'failed': the transport refused it; the account exists and the invitation can be resent
 *  - 'not_configured': the server has no way to deliver mail, so nothing was created or sent
 */
export async function sendInvitation(user: { id: string; tenantId: string; email: string; firstName: string }): Promise<InvitationResult> {
  if (!mailDelivers()) return 'not_configured';
  const { token, tokenHash } = generateOneTimeToken();
  await prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
  await prisma.passwordResetToken.create({
    data: { tenantId: user.tenantId, userId: user.id, tokenHash, expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
  });
  try {
    await sendMail({
      to: user.email,
      subject: 'You have been invited to the learning platform',
      text: `Hello ${user.firstName},\n\nYou have been invited to join the learning platform. Use this link to choose a password and activate your account (valid for 7 days):\n${config.APP_URL}/reset-password?token=${token}&invite=1\n\nIf you were not expecting this, you can ignore this email.`,
    });
    return 'sent';
  } catch {
    return 'failed';
  }
}
