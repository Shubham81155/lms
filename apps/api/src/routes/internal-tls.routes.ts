import crypto from 'crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config';
import { route } from '../lib/http';
import { rateLimitStore } from '../lib/rate-limit-store';
import { tlsAllowed } from '../lib/custom-domain';

// Mounted at /internal/tls (server.ts), outside /api/v1. The reverse proxy's on-demand TLS "ask" check: before
// it gets a certificate for a host it has not seen, Caddy asks here whether the host is one of ours. Only the
// proxy calls it: it is off (404) without TLS_ASK_SECRET, and the proxy must not route /internal/* from the
// internet (see docs/custom-domains.md).

const router = Router();

const askLimiter = rateLimit({
  windowMs: 60_000,
  // Caddy asks once per new host and keeps the certificate, so this is far above normal use.
  limit: 300,
  store: rateLimitStore('tls-ask'),
  passOnStoreError: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

export const tlsAskQuery = z.object({
  domain: z.string().trim().min(1).max(253),
  /** TLS_ASK_SECRET, when the proxy cannot send the X-TLS-Ask-Secret header. */
  secret: z.string().max(500).optional(),
});

const digest = (s: string) => crypto.createHash('sha256').update(s).digest();
const secretMatches = (given: unknown) =>
  typeof given === 'string' && !!config.TLS_ASK_SECRET && crypto.timingSafeEqual(digest(given), digest(config.TLS_ASK_SECRET));

/** GET /internal/tls/allowed?domain=: 200 when the proxy may get a certificate for the host, otherwise 404. */
router.get(
  '/allowed',
  askLimiter,
  route('Failed to answer the TLS check', async (req, res) => {
    if (!config.TLS_ASK_SECRET) return res.status(404).json({ error: 'Not found' });
    const parsed = tlsAskQuery.safeParse(req.query);
    const given = req.headers['x-tls-ask-secret'] ?? (parsed.success ? parsed.data.secret : undefined);
    if (!secretMatches(given)) return res.status(403).json({ error: 'Forbidden' });
    if (!parsed.success) return res.status(400).json({ error: 'domain is required' });
    if (!(await tlsAllowed(parsed.data.domain))) return res.status(404).json({ allowed: false });
    return res.json({ allowed: true });
  })
);

export default router;
