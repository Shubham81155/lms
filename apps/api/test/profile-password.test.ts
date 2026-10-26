import { describe, expect, it } from 'vitest';
import { changePasswordSchema } from '../src/routes/auth.routes';
import { updateUserSchema } from '../src/routes/users.routes';
import { FILE_PURPOSES } from '../src/lib/stored-files';
import { hashPassword, verifyPassword } from '../src/lib/password';

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
