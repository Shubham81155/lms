import { describe, it, expect } from 'vitest';
import { brandTokens, contrast, hexToRgb } from '../src/lib/branding';

describe('brand colour', () => {
  it('parses six-digit hex colours only', () => {
    expect(hexToRgb('#A51C30')).toEqual([165, 28, 48]);
    expect(hexToRgb('a51c30')).toEqual([165, 28, 48]);
    expect(hexToRgb('#fff')).toBeNull();
    expect(hexToRgb('red')).toBeNull();
    expect(hexToRgb(null)).toBeNull();
  });

  it('computes WCAG contrast', () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 0);
    expect(contrast([79, 70, 229], [255, 255, 255])).toBeGreaterThan(6);
  });

  it('uses a colour that keeps white text readable and stands out from the page', () => {
    const crimson = brandTokens('#A51C30', 'light');
    expect(crimson?.brand).toBe('165 28 48');
    expect(crimson?.hover).toBeTruthy();
    expect(brandTokens('#A51C30', 'dark')).not.toBeNull();
  });

  it('keeps the default palette for colours that would be illegible or invisible', () => {
    expect(brandTokens('#FFD700', 'light')).toBeNull(); // white on gold is unreadable
    expect(brandTokens('#0f172a', 'dark')).toBeNull(); // near-black buttons vanish on the dark canvas
    expect(brandTokens('#0f172a', 'light')).not.toBeNull();
    expect(brandTokens('nonsense', 'dark')).toBeNull();
  });
});
