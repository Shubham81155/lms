/**
 * IP address display formatting for the UI.
 * Normalizes loopback (IPv6 ::1, IPv4 127.0.0.1, IPv4-mapped ::ffff:127.0.0.1) and strips IPv4-mapped prefixes.
 */

export interface FormattedIp {
  display: string;
  isLocal: boolean;
  raw: string | null;
}

export function formatIpAddress(ip: string | null | undefined): FormattedIp {
  if (!ip) return { display: '—', isLocal: false, raw: null };
  const clean = ip.trim();
  if (!clean) return { display: '—', isLocal: false, raw: null };

  // IPv6 loopback or IPv4 loopback
  if (
    clean === '::1' ||
    clean === '0:0:0:0:0:0:0:1' ||
    clean === '127.0.0.1' ||
    clean === '::ffff:127.0.0.1' ||
    clean.toLowerCase() === 'localhost'
  ) {
    return { display: '127.0.0.1', isLocal: true, raw: clean };
  }

  // IPv4-mapped IPv6 address (e.g. ::ffff:192.168.1.1 -> 192.168.1.1)
  if (clean.startsWith('::ffff:')) {
    const ipv4 = clean.slice(7);
    if (ipv4 === '127.0.0.1') return { display: '127.0.0.1', isLocal: true, raw: clean };
    return { display: ipv4, isLocal: false, raw: clean };
  }

  return { display: clean, isLocal: false, raw: clean };
}
