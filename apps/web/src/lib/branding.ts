/**
 * An organisation's brand colour is used for filled buttons only when it stays usable: white text on it
 * must reach WCAG AA (4.5:1), and the button must stand out from the page (2:1 against the canvas).
 * Otherwise the built-in palette is kept, so a poorly chosen colour can never make the app illegible.
 */

export type Rgb = [number, number, number];

export function hexToRgb(hex: string | null | undefined): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
export const luminance = ([r, g, b]: Rgb) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Moves a colour toward white (amount > 0) or black (amount < 0). */
export function shade([r, g, b]: Rgb, amount: number): Rgb {
  const t = amount > 0 ? 255 : 0;
  const p = Math.abs(amount);
  return [r, g, b].map((c) => Math.round(c + (t - c) * p)) as Rgb;
}

const WHITE: Rgb = [255, 255, 255];
export const CANVAS: Record<"dark" | "light", Rgb> = { dark: [8, 11, 24], light: [236, 238, 252] };

/** The brand and hover colours as "r g b" token values, or null to keep the default palette. */
export function brandTokens(hex: string | null | undefined, theme: "dark" | "light"): { brand: string; hover: string } | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  if (contrast(rgb, WHITE) < 4.5 || contrast(rgb, CANVAS[theme]) < 2) return null;
  const hover = theme === "dark" ? shade(rgb, 0.12) : shade(rgb, -0.12);
  const hoverOk = contrast(hover, WHITE) >= 4.5 ? hover : shade(rgb, -0.12);
  return { brand: rgb.join(" "), hover: hoverOk.join(" ") };
}
