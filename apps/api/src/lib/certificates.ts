import crypto from 'crypto';
import { prisma } from './prisma';
import { config } from '../config';

const MAX_ATTEMPTS = 5;

export function generateCertificateNumber(now: Date = new Date()): string {
  return `CERT-${now.getUTCFullYear()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

/**
 * Issues the certificate for a completed enrollment. Idempotent: an enrollment has at most one.
 * Must run inside the tenant context of the enrollment. PDF rendering is not implemented, so
 * pdfUrl stays null; the verification URL is what a QR code should point at.
 */
export async function issueCertificate(enrollmentId: string, tenantSlug: string) {
  const existing = await prisma.certificate.findUnique({ where: { enrollmentId } });
  if (existing) return existing;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const certificateNumber = generateCertificateNumber();
    try {
      return await prisma.certificate.create({
        data: {
          enrollmentId,
          certificateNumber,
          // A page a person can read; it checks the number through the public verification API.
          verificationQr: `${config.APP_URL}/verify?number=${encodeURIComponent(certificateNumber)}&tenant=${encodeURIComponent(tenantSlug)}`,
        },
      });
    } catch (err: any) {
      if (err?.code !== 'P2002') throw err;
      // Either a concurrent request created it, or the number collided; re-check, then retry.
      const raced = await prisma.certificate.findUnique({ where: { enrollmentId } });
      if (raced) return raced;
    }
  }
  throw new Error('Could not allocate a unique certificate number');
}
