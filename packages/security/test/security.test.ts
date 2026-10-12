import { describe, it, expect } from 'vitest';
import { randomBytes } from 'crypto';
import { FieldEncryption, AccessControlEngine, AuditSanitizer } from '../src/index';

const TEST_KEY = randomBytes(32).toString('hex');

describe('FieldEncryption (AES-256-GCM)', () => {
  it('round-trips PII', () => {
    const fle = new FieldEncryption(TEST_KEY);
    const pii = '123-45-6789 (Confidential SSN)';
    const encrypted = fle.encrypt(pii);
    expect(encrypted).not.toContain('123-45-6789');
    expect(fle.decrypt(encrypted)).toBe(pii);
  });

  it('uses a fresh IV for every encryption', () => {
    const fle = new FieldEncryption(TEST_KEY);
    expect(fle.encrypt('same')).not.toBe(fle.encrypt('same'));
  });

  it('rejects tampered ciphertext', () => {
    const fle = new FieldEncryption(TEST_KEY);
    const [iv, tag, data] = fle.encrypt('secret').split(':');
    const flipped = (data[0] === '0' ? '1' : '0') + data.slice(1);
    expect(() => fle.decrypt(`${iv}:${tag}:${flipped}`)).toThrow();
  });

  it('refuses to run without a valid key', () => {
    const saved = process.env.PII_ENCRYPTION_KEY;
    delete process.env.PII_ENCRYPTION_KEY;
    try {
      expect(() => new FieldEncryption()).toThrow(/PII_ENCRYPTION_KEY/);
      expect(() => new FieldEncryption('abcd')).toThrow(/64 hex/);
    } finally {
      if (saved !== undefined) process.env.PII_ENCRYPTION_KEY = saved;
    }
  });
});

describe('AccessControlEngine', () => {
  it('applies RBAC', () => {
    expect(AccessControlEngine.can('INSTRUCTOR', 'course:create')).toBe(true);
    expect(AccessControlEngine.can('STUDENT', 'course:create')).toBe(false);
  });

  it('applies ABAC for course edits', () => {
    expect(AccessControlEngine.canEditCourse('INSTRUCTOR', 'u1', ['u1'])).toBe(true);
    expect(AccessControlEngine.canEditCourse('INSTRUCTOR', 'u2', ['u1'])).toBe(false);
    expect(AccessControlEngine.canEditCourse('TENANT_ADMIN', 'u2', ['u1'])).toBe(true);
    expect(AccessControlEngine.canEditCourse('STUDENT', 'u1', ['u1'])).toBe(false);
  });
});

describe('AuditSanitizer', () => {
  it('masks sensitive keys and keeps the rest', () => {
    const out = AuditSanitizer.sanitize({
      userId: 'usr_100',
      username: 'alex.chen',
      password: 'SuperSecretPassword123!',
      token: 'jwt.bearer.secret.token',
      nested: { apiSecret: 'x', ok: 1 },
    });
    expect(out.password).toBe('[REDACTED_FOR_SECURITY]');
    expect(out.token).toBe('[REDACTED_FOR_SECURITY]');
    expect(out.username).toBe('alex.chen');
    expect(out.nested.apiSecret).toBe('[REDACTED_FOR_SECURITY]');
    expect(out.nested.ok).toBe(1);
  });
});
