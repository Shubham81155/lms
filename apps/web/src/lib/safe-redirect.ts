/**
 * The path from a `?next=` parameter if it stays on this site, else null. Browsers treat "/\evil.com" and
 * "/<TAB>/evil.com" like "//evil.com", so a leading slash is not enough: the URL is resolved against a fixed origin
 * and must come back to it.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  for (const ch of next) {
    const code = ch.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f || ch === "\\") return null; // control characters, tabs and newlines included
  }
  const base = "https://app.invalid";
  try {
    const url = new URL(next, base);
    return url.origin === base ? url.pathname + url.search + url.hash : null;
  } catch {
    return null;
  }
}
