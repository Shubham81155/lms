import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { logAuditEvent } from '../lib/audit';
import { authenticateJWT, tenantIdOf } from '../middleware/auth';
import { HttpError, route } from '../lib/http';
import { idSchema, pageMeta, paginationShape, parseBody, parseQuery } from '../lib/validate';
import { CourseAccess, requireContentAccess } from '../lib/access';
import { notify } from '../lib/notify';

// Mounted at /api/v1. Forums belong to a course; only people who can see the course content
// (enrolled learners, assigned staff, admins, auditors) can read or write. Auditors are read-only.

const router = Router();
// Mounted at the API root, so authenticate only the paths this router owns; a blanket router.use()
// would also demand a login for every public route registered after it.
router.use(['/threads', '/votes', '/flags', '/posts', '/courses/:courseId/threads', '/courses/:courseId/flags'], authenticateJWT);

const CATEGORIES = ['General', 'Assignments', 'Consensus', 'Cryptography', 'Exams', 'Logistics'] as const;

export const threadSchema = z.object({
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(1).max(10_000),
  category: z.enum(CATEGORIES).default('General'),
});
export const postSchema = z.object({
  body: z.string().trim().min(1).max(10_000),
  parentId: idSchema.optional(),
});
export const voteSchema = z.object({ targetType: z.enum(['THREAD', 'POST']), targetId: idSchema });
export const flagSchema = voteSchema.extend({ reason: z.string().trim().min(3).max(500) });
export const moderateThreadSchema = z
  .object({ pinned: z.boolean(), locked: z.boolean(), hidden: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');
export const moderatePostSchema = z.object({ hidden: z.boolean() });
export const listQuery = z.object({
  ...paginationShape,
  category: z.enum(CATEGORIES).optional(),
  includeHidden: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

const authorSelect = { select: { id: true, firstName: true, lastName: true, role: true, directoryOptOut: true } } as const;

/** Learners see "First L." so a thread does not publish a classmate's full name. */
function authorView(
  a: { id: string; firstName: string; lastName: string; role: string; directoryOptOut?: boolean },
  access: CourseAccess,
  viewerId?: string
) {
  const staffLike = ['INSTRUCTOR', 'TEACHING_ASSISTANT', 'TENANT_ADMIN', 'SUPER_ADMIN'].includes(a.role);
  return {
    id: a.id,
    name:
      a.directoryOptOut && !staffLike && !access.isStaff && a.id !== viewerId
        ? 'Anonymous learner'
        : staffLike || access.isStaff
          ? `${a.firstName} ${a.lastName}`
          : `${a.firstName} ${a.lastName.charAt(0)}.`,
    role: a.role,
  };
}

const canWrite = (req: any) => req.user!.role !== 'AUDITOR';

async function voteCounts(tenantId: string, type: 'THREAD' | 'POST', ids: string[], userId: string) {
  if (ids.length === 0) return { counts: new Map<string, number>(), mine: new Set<string>() };
  const votes = await prisma.forumVote.findMany({
    where: { tenantId, targetType: type, targetId: { in: ids } },
    select: { targetId: true, userId: true },
  });
  const counts = new Map<string, number>();
  const mine = new Set<string>();
  for (const v of votes) {
    counts.set(v.targetId, (counts.get(v.targetId) ?? 0) + 1);
    if (v.userId === userId) mine.add(v.targetId);
  }
  return { counts, mine };
}

async function loadThread(req: any, threadId: string) {
  const thread = await prisma.forumThread.findFirst({ where: { id: threadId, tenantId: tenantIdOf(req) } });
  if (!thread) throw new HttpError(404, 'Thread not found');
  const access = await requireContentAccess(req, thread.courseId);
  if (thread.hidden && !access.isStaff && req.user!.role !== 'AUDITOR') throw new HttpError(404, 'Thread not found');
  return { thread, access };
}

/** GET /api/v1/courses/:courseId/threads */
router.get(
  '/courses/:courseId/threads',
  route('Failed to load discussion threads', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const access = await requireContentAccess(req, idSchema.parse(req.params.courseId));
    const { page, limit, category, includeHidden } = parseQuery(req, listQuery);
    const seesHidden = includeHidden && (access.isStaff || req.user!.role === 'AUDITOR');

    const where = {
      tenantId,
      courseId: access.course.id,
      ...(category ? { category } : {}),
      ...(seesHidden ? {} : { hidden: false }),
    };
    const [threads, total] = await Promise.all([
      prisma.forumThread.findMany({
        where,
        orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: { author: authorSelect, _count: { select: { posts: { where: { hidden: false } } } } },
      }),
      prisma.forumThread.count({ where }),
    ]);
    const { counts, mine } = await voteCounts(
      tenantId,
      'THREAD',
      threads.map((t) => t.id),
      req.user!.id
    );

    return res.json({
      data: threads.map((t) => ({
        id: t.id,
        title: t.title,
        body: t.body,
        category: t.category,
        pinned: t.pinned,
        locked: t.locked,
        hidden: t.hidden,
        createdAt: t.createdAt,
        author: authorView(t.author, access, req.user!.id),
        replyCount: t._count.posts,
        upvotes: counts.get(t.id) ?? 0,
        votedByMe: mine.has(t.id),
      })),
      pagination: pageMeta(page, limit, total),
    });
  })
);

/** POST /api/v1/courses/:courseId/threads */
router.post(
  '/courses/:courseId/threads',
  route('Failed to create thread', async (req, res) => {
    if (!canWrite(req)) throw new HttpError(403, 'Forbidden: auditors have read-only access');
    const access = await requireContentAccess(req, idSchema.parse(req.params.courseId));
    const body = parseBody(req, threadSchema);
    const thread = await prisma.forumThread.create({
      data: { ...body, tenantId: tenantIdOf(req), courseId: access.course.id, authorId: req.user!.id },
    });
    return res.status(201).json({ data: thread });
  })
);

export const postsPageQuery = z.object({
  cursor: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

/** GET /api/v1/threads/:id: the thread with its (visible) replies, one page at a time (`nextCursor`). */
router.get(
  '/threads/:id',
  route('Failed to load thread', async (req, res) => {
    const tenantId = tenantIdOf(req);
    const { thread, access } = await loadThread(req, idSchema.parse(req.params.id));
    const seesHidden = access.isStaff || req.user!.role === 'AUDITOR';

    // Replies come in pages (oldest first); pass `cursor` = the previous page's nextCursor for the next one.
    const { cursor, limit } = parseQuery(req, postsPageQuery);
    const [author, fetched] = await Promise.all([
      prisma.user.findFirst({ where: { id: thread.authorId }, select: authorSelect.select }),
      prisma.forumPost.findMany({
        where: { threadId: thread.id, ...(seesHidden ? {} : { hidden: false }) },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: { author: authorSelect },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    ]);
    const hasMore = fetched.length > limit;
    const posts = hasMore ? fetched.slice(0, limit) : fetched;
    const postVotes = await voteCounts(
      tenantId,
      'POST',
      posts.map((p) => p.id),
      req.user!.id
    );
    const threadVotes = await voteCounts(tenantId, 'THREAD', [thread.id], req.user!.id);

    return res.json({
      data: {
        ...thread,
        author: author ? authorView(author, access, req.user!.id) : null,
        nextCursor: hasMore ? posts[posts.length - 1].id : null,
        upvotes: threadVotes.counts.get(thread.id) ?? 0,
        votedByMe: threadVotes.mine.has(thread.id),
        posts: posts.map((p) => ({
          id: p.id,
          parentId: p.parentId,
          body: p.body,
          hidden: p.hidden,
          endorsed: p.endorsed,
          createdAt: p.createdAt,
          author: authorView(p.author, access, req.user!.id),
          upvotes: postVotes.counts.get(p.id) ?? 0,
          votedByMe: postVotes.mine.has(p.id),
        })),
      },
    });
  })
);

/** POST /api/v1/threads/:id/posts */
router.post(
  '/threads/:id/posts',
  route('Failed to post reply', async (req, res) => {
    if (!canWrite(req)) throw new HttpError(403, 'Forbidden: auditors have read-only access');
    const tenantId = tenantIdOf(req);
    const { thread, access } = await loadThread(req, idSchema.parse(req.params.id));
    if (thread.locked && !access.isStaff) throw new HttpError(409, 'This thread is locked');
    const body = parseBody(req, postSchema);

    if (body.parentId) {
      const parent = await prisma.forumPost.findFirst({ where: { id: body.parentId, threadId: thread.id } });
      if (!parent) throw new HttpError(400, 'Parent reply not found in this thread');
    }
    const post = await prisma.forumPost.create({
      data: { tenantId, threadId: thread.id, authorId: req.user!.id, body: body.body, parentId: body.parentId ?? null },
    });

    if (thread.authorId !== req.user!.id) {
      await notify({
        tenantId,
        userId: thread.authorId,
        category: 'FORUM',
        title: `New reply on "${thread.title}"`,
        body: body.body.slice(0, 140),
        link: `/courses/${thread.courseId}/forum/${thread.id}`,
      });
    }
    return res.status(201).json({ data: post });
  })
);

/** POST /api/v1/votes: toggles the caller's upvote on a thread or reply. */
router.post(
  '/votes',
  route('Failed to record vote', async (req, res) => {
    if (!canWrite(req)) throw new HttpError(403, 'Forbidden: auditors have read-only access');
    const tenantId = tenantIdOf(req);
    const { targetType, targetId } = parseBody(req, voteSchema);
    const courseId =
      targetType === 'THREAD'
        ? (await prisma.forumThread.findFirst({ where: { id: targetId }, select: { courseId: true } }))?.courseId
        : (await prisma.forumPost.findFirst({ where: { id: targetId }, select: { thread: { select: { courseId: true } } } }))?.thread
            .courseId;
    if (!courseId) throw new HttpError(404, 'Target not found');
    await requireContentAccess(req, courseId);

    const existing = await prisma.forumVote.findUnique({
      where: { userId_targetType_targetId: { userId: req.user!.id, targetType, targetId } },
    });
    if (existing) {
      await prisma.forumVote.delete({ where: { id: existing.id } });
    } else {
      try {
        await prisma.forumVote.create({ data: { tenantId, userId: req.user!.id, targetType, targetId } });
      } catch (err: any) {
        if (err?.code !== 'P2002') throw err; // concurrent double-click: already voted
      }
    }
    const upvotes = await prisma.forumVote.count({ where: { tenantId, targetType, targetId } });
    return res.json({ data: { targetType, targetId, voted: !existing, upvotes } });
  })
);

/** POST /api/v1/flags: any participant reports a thread or reply to the course staff. */
router.post(
  '/flags',
  route('Failed to submit report', async (req, res) => {
    if (!canWrite(req)) throw new HttpError(403, 'Forbidden: auditors have read-only access');
    const tenantId = tenantIdOf(req);
    const { targetType, targetId, reason } = parseBody(req, flagSchema);
    const courseId =
      targetType === 'THREAD'
        ? (await prisma.forumThread.findFirst({ where: { id: targetId }, select: { courseId: true } }))?.courseId
        : (await prisma.forumPost.findFirst({ where: { id: targetId }, select: { thread: { select: { courseId: true } } } }))?.thread
            .courseId;
    if (!courseId) throw new HttpError(404, 'Target not found');
    const access = await requireContentAccess(req, courseId);

    try {
      await prisma.forumFlag.create({ data: { tenantId, reporterId: req.user!.id, targetType, targetId, reason } });
    } catch (err: any) {
      if (err?.code === 'P2002') throw new HttpError(409, 'You have already reported this');
      throw err;
    }
    await Promise.all(
      access.course.instructorIds.map((userId) =>
        notify({
          tenantId,
          userId,
          category: 'FORUM',
          title: 'A discussion post was reported',
          body: reason.slice(0, 140),
          link: `/courses/${courseId}/forum/moderation`,
        })
      )
    );
    return res.status(201).json({ data: { reported: true } });
  })
);

/** GET /api/v1/courses/:courseId/flags: moderation queue for course staff. */
router.get(
  '/courses/:courseId/flags',
  route('Failed to load moderation queue', async (req, res) => {
    const access = await requireContentAccess(req, idSchema.parse(req.params.courseId));
    if (!access.isStaff) throw new HttpError(403, 'Forbidden: moderation is limited to course staff');
    const threads = await prisma.forumThread.findMany({ where: { courseId: access.course.id }, select: { id: true } });
    const posts = await prisma.forumPost.findMany({ where: { thread: { courseId: access.course.id } }, select: { id: true } });
    const ids = [...threads.map((t) => t.id), ...posts.map((p) => p.id)];
    const flags = await prisma.forumFlag.findMany({
      where: { tenantId: tenantIdOf(req), resolved: false, targetId: { in: ids } },
      orderBy: { createdAt: 'asc' },
    });

    // Say what was reported and by whom, so moderators can act without opening each thread.
    const [flaggedThreads, flaggedPosts, reporters] = await Promise.all([
      prisma.forumThread.findMany({
        where: { id: { in: flags.filter((f) => f.targetType === 'THREAD').map((f) => f.targetId) } },
        select: { id: true, title: true, body: true, hidden: true },
      }),
      prisma.forumPost.findMany({
        where: { id: { in: flags.filter((f) => f.targetType === 'POST').map((f) => f.targetId) } },
        select: { id: true, body: true, hidden: true, threadId: true, thread: { select: { title: true } } },
      }),
      prisma.user.findMany({
        where: { id: { in: [...new Set(flags.map((f) => f.reporterId))] } },
        select: { id: true, firstName: true, lastName: true },
      }),
    ]);
    const threadById = new Map(flaggedThreads.map((t) => [t.id, t]));
    const postById = new Map(flaggedPosts.map((p) => [p.id, p]));
    const reporterName = new Map(reporters.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
    const excerpt = (s: string) => (s.length > 240 ? `${s.slice(0, 240)}…` : s);

    return res.json({
      data: flags.map((f) => {
        const t = f.targetType === 'THREAD' ? threadById.get(f.targetId) : undefined;
        const p = f.targetType === 'POST' ? postById.get(f.targetId) : undefined;
        return {
          ...f,
          reporterName: reporterName.get(f.reporterId) ?? 'Unknown',
          target: t
            ? { threadId: t.id, threadTitle: t.title, excerpt: excerpt(t.body), hidden: t.hidden }
            : p
              ? { threadId: p.threadId, threadTitle: p.thread.title, excerpt: excerpt(p.body), hidden: p.hidden }
              : null,
        };
      }),
    });
  })
);

/** POST /api/v1/flags/:id/resolve */
router.post(
  '/flags/:id/resolve',
  route('Failed to resolve report', async (req, res) => {
    const flag = await prisma.forumFlag.findFirst({ where: { id: idSchema.parse(req.params.id) } });
    if (!flag) throw new HttpError(404, 'Report not found');
    const courseId =
      flag.targetType === 'THREAD'
        ? (await prisma.forumThread.findFirst({ where: { id: flag.targetId }, select: { courseId: true } }))?.courseId
        : (await prisma.forumPost.findFirst({ where: { id: flag.targetId }, select: { thread: { select: { courseId: true } } } }))?.thread
            .courseId;
    if (!courseId) throw new HttpError(404, 'Report not found');
    const access = await requireContentAccess(req, courseId);
    if (!access.isStaff) throw new HttpError(403, 'Forbidden: moderation is limited to course staff');
    await prisma.forumFlag.update({ where: { id: flag.id }, data: { resolved: true } });
    return res.json({ data: { id: flag.id, resolved: true } });
  })
);

/** PATCH /api/v1/threads/:id/moderate: pin, lock or hide a thread (course staff). */
router.patch(
  '/threads/:id/moderate',
  route('Failed to moderate thread', async (req, res) => {
    const { thread, access } = await loadThread(req, idSchema.parse(req.params.id));
    if (!access.isStaff) throw new HttpError(403, 'Forbidden: moderation is limited to course staff');
    const patch = parseBody(req, moderateThreadSchema);
    const updated = await prisma.forumThread.update({ where: { id: thread.id }, data: patch });
    await logAuditEvent({
      tenantId: tenantIdOf(req),
      userId: req.user!.id,
      action: 'FORUM_THREAD_MODERATED',
      resourceType: 'FORUM_THREAD',
      resourceId: thread.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: patch,
    });
    return res.json({ data: updated });
  })
);

/** PATCH /api/v1/posts/:id/moderate: hide or restore a reply (course staff). */
router.patch(
  '/posts/:id/moderate',
  route('Failed to moderate reply', async (req, res) => {
    const post = await prisma.forumPost.findFirst({
      where: { id: idSchema.parse(req.params.id) },
      include: { thread: { select: { courseId: true } } },
    });
    if (!post) throw new HttpError(404, 'Reply not found');
    const access = await requireContentAccess(req, post.thread.courseId);
    if (!access.isStaff) throw new HttpError(403, 'Forbidden: moderation is limited to course staff');
    const patch = parseBody(req, moderatePostSchema);
    const updated = await prisma.forumPost.update({ where: { id: post.id }, data: patch });
    await logAuditEvent({
      tenantId: tenantIdOf(req),
      userId: req.user!.id,
      action: 'FORUM_POST_MODERATED',
      resourceType: 'FORUM_POST',
      resourceId: post.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      diffJson: patch,
    });
    return res.json({ data: updated });
  })
);

/** POST /api/v1/posts/:id/endorse: course staff mark a reply as a verified answer (toggle). */
router.post(
  '/posts/:id/endorse',
  route('Failed to endorse reply', async (req, res) => {
    const post = await prisma.forumPost.findFirst({
      where: { id: idSchema.parse(req.params.id) },
      include: { thread: { select: { courseId: true } } },
    });
    if (!post) throw new HttpError(404, 'Reply not found');
    const access = await requireContentAccess(req, post.thread.courseId);
    if (!access.isStaff) throw new HttpError(403, 'Forbidden: only course staff can endorse answers');
    const updated = await prisma.forumPost.update({ where: { id: post.id }, data: { endorsed: !post.endorsed } });
    return res.json({ data: { id: updated.id, endorsed: updated.endorsed } });
  })
);

export default router;
