import * as crypto from 'crypto';

/**
 * Enterprise LMS Security & Cryptography Utilities
 * Provides AES-256-GCM encryption for FERPA PII, ABAC/RBAC validation, and audit sanitization.
 */

// =========================================================
// 1. AES-256-GCM FIELD LEVEL ENCRYPTION (FERPA / PII)
// =========================================================

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

export class FieldEncryption {
  private key: Buffer;

  constructor(secretHexKey?: string) {
    // 32-byte secret key from the caller, the environment, or a master KMS. No fallback key.
    const keyString = secretHexKey || process.env.PII_ENCRYPTION_KEY;
    if (!keyString) {
      throw new Error('FieldEncryption requires PII_ENCRYPTION_KEY (64 hex characters)');
    }
    if (!/^[0-9a-fA-F]{64}$/.test(keyString)) {
      throw new Error('FieldEncryption key must be 32 bytes encoded as 64 hex characters');
    }
    this.key = Buffer.from(keyString, 'hex');
  }

  /**
   * Encrypts plaintext string into formatted base64: iv:authTag:ciphertext
   */
  public encrypt(plaintext: string): string {
    if (!plaintext) return plaintext;
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
    
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypts formatted string iv:authTag:ciphertext back to plaintext
   */
  public decrypt(cipherPayload: string): string {
    if (!cipherPayload || !cipherPayload.includes(':')) return cipherPayload;
    
    const parts = cipherPayload.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted payload format');
    }

    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}

// =========================================================
// 2. FINE-GRAINED ROLE-BASED & ATTRIBUTE-BASED ACCESS CONTROL
// =========================================================

export type UserRole =
  | 'SUPER_ADMIN'
  | 'TENANT_ADMIN'
  | 'INSTRUCTOR'
  | 'TEACHING_ASSISTANT'
  | 'STUDENT'
  | 'PARENT_GUARDIAN'
  | 'AUDITOR';

export type PermissionAction =
  | 'course:create'
  | 'course:update'
  | 'course:delete'
  | 'course:view'
  | 'grade:view_own'
  | 'grade:view_all'
  | 'grade:modify'
  | 'quiz:proctor'
  | 'tenant:manage_branding'
  | 'tenant:manage_sso'
  | 'audit:export';

const ROLE_PERMISSIONS: Record<UserRole, PermissionAction[]> = {
  SUPER_ADMIN: [
    'course:create', 'course:update', 'course:delete', 'course:view',
    'grade:view_own', 'grade:view_all', 'grade:modify', 'quiz:proctor',
    'tenant:manage_branding', 'tenant:manage_sso', 'audit:export'
  ],
  TENANT_ADMIN: [
    'course:create', 'course:update', 'course:delete', 'course:view',
    'grade:view_all', 'grade:modify', 'quiz:proctor',
    'tenant:manage_branding', 'tenant:manage_sso', 'audit:export'
  ],
  INSTRUCTOR: [
    'course:create', 'course:update', 'course:view',
    'grade:view_all', 'grade:modify', 'quiz:proctor'
  ],
  TEACHING_ASSISTANT: [
    'course:view', 'grade:view_all', 'grade:modify', 'quiz:proctor'
  ],
  STUDENT: [
    'course:view', 'grade:view_own'
  ],
  PARENT_GUARDIAN: [
    'grade:view_own' // Evaluated in ABAC context for ward
  ],
  AUDITOR: [
    'course:view', 'grade:view_all', 'audit:export'
  ]
};

export class AccessControlEngine {
  /**
   * Evaluates if user has permission under tenant context
   */
  public static can(role: UserRole, action: PermissionAction): boolean {
    const permissions = ROLE_PERMISSIONS[role] || [];
    return permissions.includes(action);
  }

  /**
   * ABAC (Attribute-Based Access Control) check:
   * e.g. An instructor can only edit a course if they are assigned as its instructor.
   */
  public static canEditCourse(
    role: UserRole,
    userId: string,
    courseInstructorIds: string[]
  ): boolean {
    if (role === 'SUPER_ADMIN' || role === 'TENANT_ADMIN') return true;
    if (role === 'INSTRUCTOR' && courseInstructorIds.includes(userId)) return true;
    return false;
  }
}

// =========================================================
// 3. AUDIT LOG MASKING & SANITIZATION
// =========================================================

export class AuditSanitizer {
  private static SENSITIVE_KEYS = ['password', 'secret', 'ssn', 'token', 'authorization', 'creditcard'];

  /**
   * Strips or masks passwords/secrets before writing to immutable audit log
   */
  public static sanitize(data: Record<string, any>): Record<string, any> {
    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();
      if (this.SENSITIVE_KEYS.some((s) => lowerKey.includes(s))) {
        sanitized[key] = '[REDACTED_FOR_SECURITY]';
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        sanitized[key] = this.sanitize(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }
}

// Submodule exports
export * from './ai-generator';
export * from './gdpr-ferpa-scrubber';
