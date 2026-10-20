// An organisation is identified by its web address: its own subdomain (<slug>.localhost:3000 in development,
// <slug>.<base domain> in production) or its custom domain. These helpers cover the slug part and the links.

/** An organisation's web address: 3 to 40 lowercase letters, digits and hyphens, starting and ending with a letter or digit, and not "--" as the third and fourth characters. */
export const ORG_SLUG = /^(?![a-z0-9]{2}--)[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;

export const isOrgSlug = (value: string | null | undefined): value is string => !!value && ORG_SLUG.test(value);

/** Lowercase, hyphenated and trimmed to a valid length: "St. Mary's College" -> "st-marys-college". */
export function suggestSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/**
 * The address an organisation will have, when the API has not said: its slug in front of the current host, the
 * way the platform hands out subdomains ("st-marys" on http://localhost:3000 -> http://st-marys.localhost:3000).
 */
export function guessOrgUrl(slug: string, origin: string): string | null {
  if (!isOrgSlug(slug)) return null;
  try {
    const u = new URL(origin);
    return `${u.protocol}//${slug}.${u.host}`;
  } catch {
    return null;
  }
}

/** The sign-in page of an organisation's address; only http(s) addresses are followed, anything else stays here. */
export function orgLoginUrl(url: string | null | undefined): string {
  if (!url) return "/login";
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "/login";
    return `${u.origin}/login`;
  } catch {
    return "/login";
  }
}

/** "https://st-marys.example.com" -> "st-marys.example.com", for showing an address to people. */
export function displayAddress(url: string): string {
  try {
    const u = new URL(url);
    return u.host;
  } catch {
    return url;
  }
}
