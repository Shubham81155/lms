import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { loadConfig } from '../src/config';

const good = () => ({
  JWT_SECRET: crypto.randomBytes(48).toString('base64url'),
  PII_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
});

describe('loadConfig', () => {
  it('accepts strong secrets and applies defaults', () => {
    const c = loadConfig(good() as NodeJS.ProcessEnv);
    expect(c.PORT).toBe(4000);
    expect(c.corsOrigins).toEqual(['http://localhost:3000']);
  });

  it('fails fast when secrets are missing', () => {
    expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow(/JWT_SECRET is required/);
  });

  it.each([
    ['too short', { JWT_SECRET: 'short' }, /at least 32/],
    ['the CHANGE_ME placeholder', { JWT_SECRET: 'CHANGE_ME'.padEnd(40, 'x') }, /placeholder/],
    [
      'a previously committed default',
      { JWT_SECRET: 'super-secure-enterprise-jwt-secret-key-change-in-prod' },
      /publicly known/,
    ],
    [
      'the known example encryption key',
      { PII_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' },
      /publicly known/,
    ],
    ['a non-hex encryption key', { PII_ENCRYPTION_KEY: 'z'.repeat(64) }, /64 hex/],
  ])('rejects %s', (_label, override, message) => {
    expect(() => loadConfig({ ...good(), ...override } as NodeJS.ProcessEnv)).toThrow(message);
  });
});
