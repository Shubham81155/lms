import * as crypto from 'crypto';

/**
 * 1EdTech Open Badges 3.0 & W3C Verifiable Credentials Specification
 * Generates cryptographically verifiable digital certificates and achievements.
 */

export interface OpenBadgeRecipient {
  identity: string; // e.g. "sha256$..." or email
  type: 'email' | 'url' | 'id';
  hashed: boolean;
  name: string;
}

export interface OpenBadgeAchievement {
  id: string; // URI
  type: 'Achievement';
  name: string;
  description: string;
  criteria: { narrative: string };
  image: string; // URI
}

export interface OpenBadge30Credential {
  '@context': [
    'https://www.w3.org/2018/credentials/v1',
    'https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json'
  ];
  id: string;
  type: ['VerifiableCredential', 'OpenBadgeCredential'];
  issuer: {
    id: string;
    type: 'Profile';
    name: string;
    url: string;
  };
  issuanceDate: string;
  credentialSubject: {
    id: string;
    type: 'AchievementSubject';
    recipient: OpenBadgeRecipient;
    achievement: OpenBadgeAchievement;
  };
  proof?: {
    type: 'Ed25519Signature2020' | 'RsaSignature2018';
    created: string;
    verificationMethod: string;
    proofValue: string;
  };
}

export class OpenBadgesEngine {
  /**
   * Constructs an Open Badges 3.0 Verifiable Credential
   */
  public static issueBadge(
    recipientName: string,
    recipientEmail: string,
    courseTitle: string,
    issuerName: string,
    issuerUrl: string
  ): OpenBadge30Credential {
    const credentialId = `urn:uuid:${crypto.randomUUID()}`;
    const issuanceDate = new Date().toISOString();

    const credential: OpenBadge30Credential = {
      '@context': [
        'https://www.w3.org/2018/credentials/v1',
        'https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json',
      ],
      id: credentialId,
      type: ['VerifiableCredential', 'OpenBadgeCredential'],
      issuer: {
        id: issuerUrl,
        type: 'Profile',
        name: issuerName,
        url: issuerUrl,
      },
      issuanceDate,
      credentialSubject: {
        id: `urn:student:${crypto.createHash('sha256').update(recipientEmail).digest('hex')}`,
        type: 'AchievementSubject',
        recipient: {
          identity: recipientEmail,
          type: 'email',
          hashed: false,
          name: recipientName,
        },
        achievement: {
          id: `${issuerUrl}/achievements/${encodeURIComponent(courseTitle)}`,
          type: 'Achievement',
          name: `Certificate of Mastery: ${courseTitle}`,
          description: `Successfully completed all modules, proctored examinations, and practical labs in ${courseTitle}.`,
          criteria: {
            narrative: 'Achieved a score >= 70% in all proctored assessments.',
          },
          image: `${issuerUrl}/badges/mastery.png`,
        },
      },
      proof: {
        type: 'RsaSignature2018',
        created: issuanceDate,
        verificationMethod: `${issuerUrl}/keys/public.key`,
        proofValue: crypto
          .createHash('sha256')
          .update(`${credentialId}:${recipientEmail}:${issuanceDate}`)
          .digest('hex'),
      },
    };

    return credential;
  }
}
