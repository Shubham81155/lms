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
  private static SENSITIVE_KEYS = [
    'password', 'passwordhash', 'secret', 'ssn', 'token', 'authorization', 'cookie',
    'creditcard', 'apikey', 'mfa', 'dateofbirth',
  ];
  private static MAX_DEPTH = 8;
  private static REDACTED = '[REDACTED_FOR_SECURITY]';

  /**
   * Masks passwords/secrets before writing to the audit log. Walks nested objects and arrays,
   * keeps Dates as ISO strings, and stops at a depth limit so cyclic data cannot recurse forever.
   */
  public static sanitize(data: Record<string, any>): Record<string, any> {
    return this.walk(data, 0) as Record<string, any>;
  }

  private static walk(value: unknown, depth: number): unknown {
    if (value === null || value === undefined) return value;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'bigint') return value.toString();
    if (typeof value !== 'object') return value;
    if (depth >= this.MAX_DEPTH) return '[TRUNCATED]';
    if (Array.isArray(value)) return value.map((v) => this.walk(v, depth + 1));

    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();
      out[key] = this.SENSITIVE_KEYS.some((s) => lowerKey.includes(s))
        ? this.REDACTED
        : this.walk(v, depth + 1);
    }
    return out;
  }
}

// Submodule exports
export * from './ai-generator';
export * from './gdpr-ferpa-scrubber';
