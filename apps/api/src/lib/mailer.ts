import { config } from '../config';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/**
 * Development transport: prints the message instead of sending it.
 * In production it never prints (messages contain one-time links), so until a real
 * transport is plugged in via setMailer(), reset and verification emails are not delivered.
 */
const consoleMailer: Mailer = {
  async send(message) {
    if (config.NODE_ENV === 'production') {
      console.warn('[MAILER] No mail transport configured; message to a user was dropped');
      return;
    }
    console.log(`[MAILER:dev] To: ${message.to}\nSubject: ${message.subject}\n${message.text}`);
  },
};

let current: Mailer = consoleMailer;

export function setMailer(mailer: Mailer): void {
  current = mailer;
}

export function sendMail(message: MailMessage): Promise<void> {
  return current.send(message);
}
