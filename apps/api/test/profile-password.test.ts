import { describe, expect, it } from 'vitest';
import { changePasswordSchema } from '../src/routes/auth.routes';
import { updateUserSchema } from '../src/routes/users.routes';
import { FILE_PURPOSES } from '../src/lib/stored-files';
import { hashPassword, verifyPassword } from '../src/lib/password';
import { normalizeIp } from '../src/lib/audit';

describe('FILE_PURPOSES', () => {
  it('includes AVATAR for user profile pictures', () => {
    expect(FILE_PURPOSES).toContain('AVATAR');
  });
});

describe('changePasswordSchema', () => {
  it('validates minimum length and allows valid passwords', () => {
    const valid = changePasswordSchema.safeParse({
      currentPassword: 'OldPassword123!',
      newPassword: 'NewSecurePassword2026!',
    });
    expect(valid.success).toBe(true);
  });

  it('rejects passwords shorter than 10 characters', () => {
    const invalid = changePasswordSchema.safeParse({
      currentPassword: 'OldPassword123!',
      newPassword: 'short',
    });
    expect(invalid.success).toBe(false);
  });

  it('allows optional currentPassword (for accounts without password set yet)', () => {
    const valid = changePasswordSchema.safeParse({
      newPassword: 'NewSecurePassword2026!',
    });
    expect(valid.success).toBe(true);
  });
});

describe('updateUserSchema avatarUrl', () => {
  it('accepts internal /api/v1/files/:id avatar link', () => {
    const res = updateUserSchema.safeParse({
      avatarUrl: '/api/v1/files/11111111-2222-3333-4444-555555555555',
    });
    expect(res.success).toBe(true);
  });

  it('accepts external https url', () => {
    const res = updateUserSchema.safeParse({
      avatarUrl: 'https://images.example.com/avatar.jpg',
    });
    expect(res.success).toBe(true);
  });

  it('accepts empty string and null to clear avatar', () => {
    expect(updateUserSchema.safeParse({ avatarUrl: '' }).success).toBe(true);
    expect(updateUserSchema.safeParse({ avatarUrl: null }).success).toBe(true);
  });
});

describe('password hashing and verification', () => {
  it('hashes new password and verifies candidate against stored hash', async () => {
    const plain = 'MySecretPassword123!';
    const hashed = await hashPassword(plain);
    expect(hashed).not.toBe(plain);

    const checkCorrect = await verifyPassword(plain, hashed);
    expect(checkCorrect.valid).toBe(true);

    const checkWrong = await verifyPassword('WrongPassword!', hashed);
    expect(checkWrong.valid).toBe(false);
  });
});

describe('normalizeIp', () => {
  it('normalizes IPv6 loopback to 127.0.0.1', () => {
    expect(normalizeIp('::1')).toBe('127.0.0.1');
    expect(normalizeIp('0:0:0:0:0:0:0:1')).toBe('127.0.0.1');
    expect(normalizeIp('localhost')).toBe('127.0.0.1');
  });

  it('normalizes IPv4-mapped loopback to 127.0.0.1', () => {
    expect(normalizeIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(normalizeIp('127.0.0.1')).toBe('127.0.0.1');
  });

  it('strips IPv4-mapped prefixes', () => {
    expect(normalizeIp('::ffff:192.168.1.10')).toBe('192.168.1.10');
    expect(normalizeIp('::ffff:10.0.0.5')).toBe('10.0.0.5');
  });

  it('preserves clean public/private IP addresses', () => {
    expect(normalizeIp('192.168.1.50')).toBe('192.168.1.50');
    expect(normalizeIp('203.0.113.195')).toBe('203.0.113.195');
    expect(normalizeIp('2001:db8::1')).toBe('2001:db8::1');
  });

  it('handles null, undefined, empty string, and whitespace', () => {
    expect(normalizeIp(null)).toBeNull();
    expect(normalizeIp(undefined)).toBeNull();
    expect(normalizeIp('')).toBeNull();
    expect(normalizeIp('   ')).toBeNull();
  });
});
