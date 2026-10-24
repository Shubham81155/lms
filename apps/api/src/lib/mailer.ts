import nodemailer from 'nodemailer';
import { config } from '../config';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Optional HTML alternative. Callers must escape anything user-supplied. */
  html?: string;
  /** Extra headers, e.g. List-Unsubscribe. */
  headers?: Record<string, string>;
}

/**
 * What happens to a message: `smtp` is delivered through the configured server, `console` is printed
 * to the log (development), `discarded` is thrown away (production with no transport configured),
 * and `custom` is a transport plugged in with setMailer().
 */
export type MailMode = 'smtp' | 'console' | 'discarded' | 'custom';

export interface Mailer {
  send(message: MailMessage): Promise<void>;
  mode?: MailMode;
}

/**
 * Development transport: prints the message instead of sending it.
 * In production it never prints (messages contain one-time links), so until a real
 * transport is plugged in via setMailer(), reset and verification emails are not delivered.
 */
const consoleMailer: Mailer = {
  mode: config.NODE_ENV === 'production' ? 'discarded' : 'console',
  async send(message) {
    if (config.NODE_ENV === 'production') {
      console.warn('[MAILER] No mail transport configured; message to a user was dropped');
      return;
    }
    console.log(`[MAILER:dev] To: ${message.to}\nSubject: ${message.subject}\n${message.text}`);
  },
};

/** Real transport, used whenever SMTP_URL is configured. */
function smtpMailer(url: string): Mailer {
  const transport = nodemailer.createTransport(url);
  return {
    mode: 'smtp',
    async send(message) {
      await transport.sendMail({
        from: config.MAIL_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        ...(message.headers ? { headers: message.headers } : {}),
      });
    },
  };
}

let current: Mailer = config.SMTP_URL ? smtpMailer(config.SMTP_URL) : consoleMailer;

export function setMailer(mailer: Mailer): void {
  current = mailer;
}

export const mailMode = (): MailMode => current.mode ?? 'custom';

/** False when a message sent now would be thrown away, so callers can say so instead of claiming it was sent. */
export const mailDelivers = (): boolean => mailMode() !== 'discarded';

export function sendMail(message: MailMessage): Promise<void> {
  return current.send(message);
}
