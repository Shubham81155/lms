import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticateJWT, tenantIdOf } from '../middleware/auth';
import { HttpError, route } from '../lib/http';
import { idSchema, pageMeta, paginationShape, parseBody, parseQuery } from '../lib/validate';
import { EMAIL_CATEGORIES, hourInZone, inQuietHours } from '../lib/notify';

const router = Router();
router.use(authenticateJWT);

const listQuery = z.object({
  ...paginationShape,
  category: z.string().trim().min(1).max(40).optional(),
  unreadOnly: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

const hour = z.number().int().min(0).max(23);
const timeZone = z.string().max(64).refine((tz) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'Unknown time zone');

const prefsSchema = z
  .object({
    inAppEnabled: z.boolean(),
    emailEnabled: z.boolean(),
    smsEnabled: z.boolean(),
    pushEnabled: z.boolean(),
    mutedCategories: z.array(z.string().trim().min(1).max(40)).max(20),
    quietStartHour: hour.nullable(),
    quietEndHour: hour.nullable(),
    timezone: timeZone,
  })
  .partial()
  .refine((p) => (p.quietStartHour == null) === (p.quietEndHour == null) || p.quietStartHour === undefined || p.quietEndHour === undefined, {
    message: 'quietStartHour and quietEndHour must be set together',
  });

const prefsView = (p: any) => ({
  inAppEnabled: p?.inAppEnabled ?? true,
  emailEnabled: p?.emailEnabled ?? true,
  smsEnabled: p?.smsEnabled ?? false,
  pushEnabled: p?.pushEnabled ?? false,
  mutedCategories: p?.mutedCategories ?? [],
  quietStartHour: p?.quietStartHour ?? null,
  quietEndHour: p?.quietEndHour ?? null,
  timezone: p?.timezone ?? 'UTC',
});

/** GET /api/v1/notifications: the caller's own notifications, newest first. */
router.get(
  '/',
  route('Failed to load notifications', async (req, res) => {
    const { page, limit, category, unreadOnly } = parseQuery(req, listQuery);
    const where = {
      tenantId: tenantIdOf(req),
      userId: req.user!.id,
      ...(category ? { category } : {}),
      ...(unreadOnly ? { readAt: null } : {}),
    };
    const [rows, total, unreadCount] = await Promise.all([
      // Explicit fields: e-mail delivery bookkeeping is internal and must not reach the client.
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: { id: true, category: true, title: true, body: true, link: true, readAt: true, createdAt: true },
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { tenantId: tenantIdOf(req), userId: req.user!.id, readAt: null } }),
    ]);
    return res.json({ data: rows, unreadCount, meta: pageMeta(page, limit, total) });
  })
);

/** GET /api/v1/notifications/preferences */
router.get(
  '/preferences',
  route('Failed to load notification preferences', async (req, res) => {
    const p = await prisma.notificationPreference.findUnique({ where: { userId: req.user!.id } });
    const view = prefsView(p);
    return res.json({
      data: {
        ...view,
        // Categories that can be e-mailed (when e-mail is on); the rest stay in-app.
        emailedCategories: EMAIL_CATEGORIES,
        quietNow: inQuietHours(hourInZone(new Date(), view.timezone), view.quietStartHour, view.quietEndHour),
      },
    });
  })
);

/** PUT /api/v1/notifications/preferences: channels, muted categories, quiet hours, time zone. */
router.put(
  '/preferences',
  route('Failed to save notification preferences', async (req, res) => {
    const body = parseBody(req, prefsSchema);
    const data = {
      ...body,
      ...(body.mutedCategories ? { mutedCategories: [...new Set(body.mutedCategories)] } : {}),
    };
    const p = await prisma.notificationPreference.upsert({
      where: { userId: req.user!.id },
      create: { tenantId: tenantIdOf(req), userId: req.user!.id, ...data },
      update: data,
    });
    return res.json({ data: prefsView(p) });
  })
);

/** POST /api/v1/notifications/read-all */
router.post(
  '/read-all',
  route('Failed to mark notifications as read', async (req, res) => {
    const r = await prisma.notification.updateMany({
      where: { tenantId: tenantIdOf(req), userId: req.user!.id, readAt: null },
      data: { readAt: new Date() },
    });
    return res.json({ data: { updated: r.count } });
  })
);

/** POST /api/v1/notifications/:id/read */
router.post(
  '/:id/read',
  route('Failed to mark notification as read', async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const r = await prisma.notification.updateMany({
      where: { id, userId: req.user!.id, readAt: null },
      data: { readAt: new Date() },
    });
    if (r.count === 0) {
      const exists = await prisma.notification.findFirst({ where: { id, userId: req.user!.id }, select: { id: true } });
      if (!exists) throw new HttpError(404, 'Notification not found');
    }
    return res.json({ data: { id, read: true } });
  })
);

/** DELETE /api/v1/notifications/:id */
router.delete(
  '/:id',
  route('Failed to dismiss notification', async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const r = await prisma.notification.deleteMany({ where: { id, userId: req.user!.id } });
    if (r.count === 0) throw new HttpError(404, 'Notification not found');
    return res.status(204).end();
  })
);

export default router;
