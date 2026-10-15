import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config';

// The application side of live classes. Audio and video run on a LiveKit server; this issues the
// signed join tokens that decide who may enter which room and what they may do there, and verifies
// the signed webhooks LiveKit sends so attendance reflects who was actually in the room.
// LiveKit access tokens and webhook tokens are plain HS256 JWTs signed with the API secret.

export const liveConfigured = () => !!(config.LIVEKIT_URL && config.LIVEKIT_API_KEY && config.LIVEKIT_API_SECRET);

/** Minutes in the room before someone counts as having attended. */
export const PRESENT_AFTER_SECONDS = 300;

/** Room names carry the tenant so the media server's webhook (which has no tenant context) can be routed. */
export const roomNameFor = (tenantId: string, sessionId: string) => `lms_${tenantId}_${sessionId}`;

export function parseRoomName(name: string): { tenantId: string; sessionId: string } | null {
  const m = /^lms_([A-Za-z0-9-]{1,64})_([A-Za-z0-9-]{1,64})$/.exec(name);
  return m ? { tenantId: m[1], sessionId: m[2] } : null;
}

export interface JoinGrant {
  identity: string;
  name: string;
  room: string;
  /** Can send audio and video. Everyone can send chat messages. */
  canPublish: boolean;
  /** Can remove people and mute them (instructors and administrators). */
  roomAdmin: boolean;
  role: 'HOST' | 'ASSISTANT' | 'LEARNER';
  ttlSeconds: number;
}

/** A LiveKit access token for one person and one room. It expires with the session. */
export function issueJoinToken(g: JoinGrant, now: number = Date.now()): string {
  const iat = Math.floor(now / 1000);
  return jwt.sign(
    {
      iss: config.LIVEKIT_API_KEY,
      sub: g.identity,
      name: g.name,
      nbf: iat - 5,
      iat,
      exp: iat + g.ttlSeconds,
      metadata: JSON.stringify({ role: g.role }),
      video: {
        room: g.room,
        roomJoin: true,
        canSubscribe: true,
        canPublish: g.canPublish,
        canPublishData: true,
        ...(g.roomAdmin ? { roomAdmin: true } : {}),
      },
    },
    config.LIVEKIT_API_SECRET as string,
    { algorithm: 'HS256' }
  );
}

/**
 * Verifies a LiveKit webhook: the Authorization header is a JWT signed with our API secret whose
 * `sha256` claim is the base64 SHA-256 of the exact request body. Both must hold, so a captured
 * header cannot be reused with a different body.
 */
export function verifyWebhook(authorization: string | undefined, rawBody: string): boolean {
  if (!authorization || !config.LIVEKIT_API_KEY || !config.LIVEKIT_API_SECRET) return false;
  try {
    const claims = jwt.verify(authorization.replace(/^Bearer\s+/i, '').trim(), config.LIVEKIT_API_SECRET, {
      algorithms: ['HS256'],
      issuer: config.LIVEKIT_API_KEY,
    }) as { sha256?: string };
    const expected = crypto.createHash('sha256').update(rawBody).digest('base64');
    if (typeof claims.sha256 !== 'string') return false;
    const a = Buffer.from(claims.sha256);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Seconds to add to a person's total when they leave (or the room closes). Never negative. */
export const secondsBetween = (from: Date, to: Date) => Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));

export const isPresent = (totalSeconds: number) => totalSeconds >= PRESENT_AFTER_SECONDS;
