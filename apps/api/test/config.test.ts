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
    ['a previously committed default', { JWT_SECRET: 'super-secure-enterprise-jwt-secret-key-change-in-prod' }, /publicly known/],
    [
      'the known example encryption key',
      { PII_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' },
      /publicly known/,
    ],
    ['a non-hex encryption key', { PII_ENCRYPTION_KEY: 'z'.repeat(64) }, /64 hex/],
  ])('rejects %s', (_label, override, message) => {
    expect(() => loadConfig({ ...good(), ...override } as NodeJS.ProcessEnv)).toThrow(message);
  });

  describe('seller details on invoices', () => {
    const billing = { NODE_ENV: 'production', RAZORPAY_KEY_ID: 'rzp_live_12345678' };
    const seller = { SELLER_LEGAL_NAME: 'Acme Learning Pvt Ltd', SELLER_ADDRESS: '1 MG Road, Mumbai', SELLER_STATE_CODE: '27' };

    it('refuses production billing with the placeholder company or no address', () => {
      expect(() => loadConfig({ ...good(), ...billing } as NodeJS.ProcessEnv)).toThrow(/SELLER_LEGAL_NAME/);
      expect(() => loadConfig({ ...good(), ...billing, ...seller, SELLER_ADDRESS: '' } as NodeJS.ProcessEnv)).toThrow(/SELLER_ADDRESS/);
    });

    it('accepts production billing with the seller filled in', () => {
      expect(() => loadConfig({ ...good(), ...billing, ...seller } as NodeJS.ProcessEnv)).not.toThrow();
    });

    it('does not insist on seller details when billing is off', () => {
      expect(() => loadConfig({ ...good(), NODE_ENV: 'production' } as NodeJS.ProcessEnv)).not.toThrow();
    });

    it('checks the GSTIN format and that its state matches SELLER_STATE_CODE', () => {
      const gstin = '27AAPFU0939F1ZV';
      expect(loadConfig({ ...good(), ...seller, SELLER_GSTIN: gstin } as NodeJS.ProcessEnv).SELLER_GSTIN).toBe(gstin);
      expect(() => loadConfig({ ...good(), ...seller, SELLER_GSTIN: 'not-a-gstin' } as NodeJS.ProcessEnv)).toThrow(/15-character GSTIN/);
      expect(() => loadConfig({ ...good(), ...seller, SELLER_GSTIN: gstin, SELLER_STATE_CODE: '29' } as NodeJS.ProcessEnv)).toThrow(
        /match/
      );
    });
  });
});
