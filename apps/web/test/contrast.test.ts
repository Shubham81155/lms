import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

// WCAG 2.2 AA colour contrast of the design tokens, read from globals.css itself, so a token change that breaks
// legibility fails here instead of in a review. Text needs 4.5:1 (SC 1.4.3); borders of controls and focus rings 3:1 (SC 1.4.11).

const css = readFileSync(path.resolve(import.meta.dirname, '../src/app/globals.css'), 'utf8');

type Rgb = [number, number, number];
const tokens = (block: string): Record<string, Rgb> => {
  const out: Record<string, Rgb> = {};
  for (const m of block.matchAll(/--([a-z-]+):\s*(\d+) (\d+) (\d+);/g)) out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  return out;
};
/** The declarations of the first rule whose selector is exactly `selector`. */
const rule = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no rule ${selector}`);
  return css.slice(start, css.indexOf('}', start));
};

const dark = tokens(rule(':root'));
const light = { ...dark, ...tokens(rule('html:not(.dark)')) };

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const luminance = ([r, g, b]: Rgb) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
export const ratio = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const TEXT = ['ink', 'ink-muted', 'ink-subtle', 'brand-fg', 'accent', 'success', 'danger', 'orchid'];
const SURFACES = ['canvas', 'surface', 'raised'];

describe.each([
  ['dark', dark],
  ['light', light],
])('%s theme', (_name, t) => {
  for (const fg of TEXT)
    for (const bg of SURFACES)
      it(`${fg} text on ${bg} is at least 4.5:1`, () => {
        expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
      });

  it('white text on a filled brand button is at least 4.5:1', () => {
    expect(ratio(t['on-brand'], t['brand'])).toBeGreaterThanOrEqual(4.5);
    expect(ratio(t['on-brand'], t['brand-hover'])).toBeGreaterThanOrEqual(4.5);
  });

  it('the focus ring (brand-fg, see :focus-visible in globals.css) stands out from the surfaces at 3:1', () => {
    for (const bg of SURFACES) expect(ratio(t['brand-fg'], t[bg])).toBeGreaterThanOrEqual(3);
  });
});
