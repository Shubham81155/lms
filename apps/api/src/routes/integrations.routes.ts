import crypto from 'crypto';
import express, { Router, Request, Response } from 'express';
import { runWithTenant } from '@enterprise-lms/database';
import { z } from 'zod';
import { config } from '../config';
import { basePrisma, prisma } from '../lib/prisma';
import { logAuditEvent } from '../lib/audit';
import { notify } from '../lib/notify';
import { httpUrl } from '../lib/validate';
import { liveConfigured, parseRoomName, secondsBetween, verifyWebhook } from '../lib/livekit';

// Inbound callbacks from third-party services. These must be mounted BEFORE the global JSON
// parser: the HMAC covers the exact bytes received, so each route reads the raw body itself.

const router = Router();

/** Similarity at or above this percentage alerts the course staff. */
export const PLAGIARISM_ALERT_PERCENT = 30;
/** Callbacks older than this are rejected, which bounds replay of a captured request. */
const MAX_SKEW_SECONDS = 300;

export function signCallback(secret: string, timestamp: string, rawBody: string): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

function validSignature(secret: string, timestamp: string, rawBody: string, header: string): boolean {
  const expected = Buffer.from(signCallback(secret, timestamp, rawBody), 'hex');
  const given = Buffer.from(header.replace(/^sha256=/, ''), 'hex');
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

const bodySchema = z.object({
  submissionId: z.string().min(1).max(64),
  /** Similarity percentage reported by the provider (Turnitin, Copyleaks, an internal scorer). */
  score: z.number().min(0).max(100),
  reportUrl: httpUrl.refine((u) => u.startsWith('https://'), 'reportUrl must be https').optional(),
});

/**
 * POST /api/v1/integrations/plagiarism/:tenantSlug
 * Headers: x-lms-timestamp (unix seconds), x-lms-signature: sha256=HMAC_SHA256(secret, ts + "." + body).
 * Records the score and report link on the assignment submission and alerts the course staff when
 * the similarity is high. Answers 404 for anything it cannot match, so it reveals nothing.
 */
router.post(
  '/plagiarism/:tenantSlug',
  express.raw({ type: '*/*', limit: '256kb' }),
  async (req: Request, res: Response) => {
    const fail = (status: number, error: string) => res.status(status).json({ error, requestId: req.id });
    try {
      const secret = config.PLAGIARISM_WEBHOOK_SECRET;
      if (!secret) return fail(503, 'Plagiarism callbacks are not configured');

      const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
      const ts = String(req.headers['x-lms-timestamp'] ?? '');
      const sig = String(req.headers['x-lms-signature'] ?? '');
      const age = Math.abs(Date.now() / 1000 - Number(ts));
      if (!/^\d{9,12}$/.test(ts) || age > MAX_SKEW_SECONDS || !sig || !validSignature(secret, ts, raw, sig)) {
        return fail(401, 'Invalid signature');
      }

      let parsed: z.infer<typeof bodySchema>;
      try {
        parsed = bodySchema.parse(JSON.parse(raw));
      } catch {
        return fail(400, 'Invalid callback payload');
      }

      const tenant = await basePrisma.tenant.findUnique({ where: { slug: String(req.params.tenantSlug) }, select: { id: true } });
      if (!tenant) return fail(404, 'Not found');

      return await runWithTenant(tenant.id, async () => {
        const submission = await prisma.assignmentSubmission.findFirst({
          where: { id: parsed.submissionId, assignment: { tenantId: tenant.id } },
          select: { id: true, assignment: { select: { id: true, title: true, courseId: true } } },
        });
        if (!submission) return fail(404, 'Not found');

        await prisma.assignmentSubmission.update({
          where: { id: submission.id },
          data: { plagiarismScore: parsed.score, plagiarismReportUrl: parsed.reportUrl ?? null, plagiarismStatus: 'COMPLETE', plagiarismNextAttemptAt: null },
        });

        let alerted = 0;
        if (parsed.score >= PLAGIARISM_ALERT_PERCENT) {
          const staff = await prisma.courseInstructor.findMany({ where: { courseId: submission.assignment.courseId }, select: { userId: true } });
          await Promise.all(
            staff.map((s) =>
              notify({
                tenantId: tenant.id,
                userId: s.userId,
                category: 'GRADE',
                title: `High similarity on "${submission.assignment.title}"`,
                body: `A submission scored ${Math.round(parsed.score)}% similarity.`,
                link: `/assignments/${submission.assignment.id}/submissions/${submission.id}`,
              })
            )
          );
          alerted = staff.length;
        }
        await logAuditEvent({
          tenantId: tenant.id, action: 'PLAGIARISM_RESULT_RECORDED', resourceType: 'ASSIGNMENT_SUBMISSION', resourceId: submission.id,
          diffJson: { score: parsed.score },
        });
        return res.json({ status: 'recorded', alerted });
      });
    } catch (err) {
      return fail(500, 'Failed to process callback');
    }
  }
);

/**
 * POST /api/v1/integrations/livekit
 * Webhooks from the LiveKit media server. The Authorization header is a JWT signed with our API
 * secret that commits to the exact body (see verifyWebhook), so only the media server can call this.
 * Participant identities are our user ids (set when the join token was issued), and room names carry
 * the tenant, which is how an otherwise tenant-less call is routed.
 */
router.post('/livekit', express.raw({ type: '*/*', limit: '256kb' }), async (req: Request, res: Response) => {
  const fail = (status: number, error: string) => res.status(status).json({ error, requestId: req.id });
  try {
    if (!liveConfigured()) return fail(503, 'Live classes are not configured');
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    if (!verifyWebhook(req.headers.authorization, raw)) return fail(401, 'Invalid signature');

    let event: { event?: string; createdAt?: number | string; room?: { name?: string }; participant?: { identity?: string } };
    try {
      event = JSON.parse(raw);
    } catch {
      return fail(400, 'Invalid payload');
    }
    const room = parseRoomName(event.room?.name ?? '');
    if (!room) return res.json({ ok: true, ignored: 'unknown room' }); // not one of ours
    const at = event.createdAt ? new Date(Number(event.createdAt) * 1000) : new Date();
    const when = Number.isNaN(at.getTime()) ? new Date() : at;

    return await runWithTenant(room.tenantId, async () => {
      const session = await prisma.liveSession.findFirst({ where: { id: room.sessionId, tenantId: room.tenantId, roomName: event.room!.name! } });
      if (!session) return res.json({ ok: true, ignored: 'unknown session' });
      const userId = event.participant?.identity;

      if (event.event === 'participant_joined' && userId) {
        const known = await prisma.user.findFirst({ where: { id: userId, tenantId: room.tenantId }, select: { id: true } });
        if (known) {
          // Active from now; the join count was recorded when the token was issued.
          const a = await prisma.liveAttendance.findUnique({ where: { sessionId_userId: { sessionId: session.id, userId } } });
          if (!a) await prisma.liveAttendance.create({ data: { tenantId: room.tenantId, sessionId: session.id, userId, firstJoinedAt: when, activeSince: when } });
          else if (!a.activeSince) await prisma.liveAttendance.update({ where: { id: a.id }, data: { activeSince: when } });
        }
      } else if (event.event === 'participant_left' && userId) {
        const a = await prisma.liveAttendance.findUnique({ where: { sessionId_userId: { sessionId: session.id, userId } } });
        if (a?.activeSince) {
          // Conditional on still being active, so a duplicated event cannot count the time twice.
          await prisma.liveAttendance.updateMany({
            where: { id: a.id, activeSince: a.activeSince },
            data: { totalSeconds: a.totalSeconds + secondsBetween(a.activeSince, when), activeSince: null },
          });
        }
      } else if (event.event === 'room_finished') {
        const ended = await prisma.liveSession.updateMany({ where: { id: session.id, status: 'LIVE' }, data: { status: 'ENDED', endedAt: when } });
        const open = await prisma.liveAttendance.findMany({ where: { sessionId: session.id, activeSince: { not: null } } });
        for (const a of open) {
          await prisma.liveAttendance.updateMany({
            where: { id: a.id, activeSince: a.activeSince },
            data: { totalSeconds: a.totalSeconds + secondsBetween(a.activeSince!, when), activeSince: null },
          });
        }
        if (ended.count === 1) await logAuditEvent({ tenantId: room.tenantId, action: 'LIVE_SESSION_ENDED', resourceType: 'LIVE_SESSION', resourceId: session.id, diffJson: { by: 'media server' } });
      }
      return res.json({ ok: true });
    });
  } catch {
    return fail(500, 'Failed to process webhook');
  }
});

export default router;
