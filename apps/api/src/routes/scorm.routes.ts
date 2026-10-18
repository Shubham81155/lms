import { Router } from 'express';
import { z } from 'zod';
import { createWriteStream } from 'fs';
import { rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { pipeline } from 'stream/promises';
import { prisma } from '../lib/prisma';
import { HttpError, route } from '../lib/http';
import { idSchema, parseBody } from '../lib/validate';
import { ACTIVE_ENROLLMENT, requireContentAccess, requireCourseEditor, requireCourseStaff } from '../lib/access';
import { logAuditEvent } from '../lib/audit';
import { authenticateJWT, tenantIdOf } from '../middleware/auth';
import { storage } from '../lib/storage';
import { isWithdrawn, removeStored, scormContentOrigin, signLaunch, unpackPackage, WITHDRAWN_MESSAGE, type PackageFile } from '../lib/scorm';

// Mounted at /api/v1. SCORM packages: course editors upload the zip (POST /files, purpose SCORM_PACKAGE) and
// turn it into a package here; lessons of type SCORM_PACKAGE play it. Playing happens on the content origin
// (routes/scorm-content.routes.ts) through the link GET /scorm-packages/:id/launch hands out.

const router = Router();
router.use(['/courses/:id/scorm-packages', '/scorm-packages'], authenticateJWT);

export const createPackageSchema = z.object({
  /** An uploaded zip: POST /files with purpose SCORM_PACKAGE for this course. */
  fileId: idSchema,
  title: z.string().trim().min(1).max(255).optional(),
});

const view = (p: { id: string; courseId: string; title: string; version: string; launchPath: string; fileCount: number; sizeBytes: number; createdAt: Date; sourceFile?: { scanStatus: string } | null }) => ({
  id: p.id, courseId: p.courseId, title: p.title, version: p.version, launchPath: p.launchPath, fileCount: p.fileCount, sizeBytes: p.sizeBytes, createdAt: p.createdAt,
  withdrawn: isWithdrawn(p),
});


/** Unpacking writes up to 1 GB of files: at most two at a time per server. */
let unpacking = 0;
const MAX_CONCURRENT_UNPACKS = 2;

const requireScorm = () => {
  const origin = scormContentOrigin();
  if (!origin) throw new HttpError(409, 'SCORM is not set up on this server (SCORM_CONTENT_ORIGIN)');
  return origin;
};

/** POST /api/v1/courses/:id/scorm-packages {fileId, title?}: unpack an uploaded zip (course editors). Audited. */
router.post(
  '/courses/:id/scorm-packages',
  route('Failed to add the SCORM package', async (req, res) => {
    requireScorm();
    const tenantId = tenantIdOf(req);
    const access = await requireCourseEditor(req, idSchema.parse(req.params.id));
    const { fileId, title } = parseBody(req, createPackageSchema);
    const upload = await prisma.storedFile.findFirst({ where: { id: fileId, tenantId, courseId: access.course.id, purpose: 'SCORM_PACKAGE' } });
    if (!upload) throw new HttpError(400, 'Upload the package zip for this course first');
    if (upload.scanStatus === 'INFECTED') throw new HttpError(410, 'This package was withdrawn because a virus scan found malware in it.');

    if (unpacking >= MAX_CONCURRENT_UNPACKS) throw new HttpError(429, 'Other packages are being unpacked; try again in a minute');
    unpacking++;
    const temp = path.join(os.tmpdir(), `lms-scorm-zip-${randomUUID()}`);
    try {
      await pipeline(await storage().open(upload.storageKey), createWriteStream(temp));
      const unpacked = await unpackPackage(temp, tenantId);
      let pkg;
      try {
        pkg = await prisma.scormPackage.create({
          data: {
            tenantId,
            courseId: access.course.id,
            uploadedById: req.user!.id,
            sourceFileId: upload.id,
            title: title ?? unpacked.title ?? upload.filename.replace(/\.zip$/i, ''),
            version: unpacked.version,
            launchPath: unpacked.launchPath,
            filesJson: unpacked.files as unknown as object,
            fileCount: unpacked.fileCount,
            sizeBytes: unpacked.sizeBytes,
          },
        });
      } catch (e) {
        await removeStored(Object.values(unpacked.files).map((f) => f.key));
        throw e;
      }
      await logAuditEvent({
        tenantId, userId: req.user!.id, action: 'SCORM_PACKAGE_ADDED', resourceType: 'SCORM_PACKAGE', resourceId: pkg.id,
        ipAddress: req.ip, userAgent: req.headers['user-agent'], diffJson: { courseId: access.course.id, version: pkg.version, fileCount: pkg.fileCount, sizeBytes: pkg.sizeBytes },
      });
      return res.status(201).json({ data: view(pkg) });
    } finally {
      unpacking--;
      await rm(temp, { force: true });
    }
  })
);

/** GET /api/v1/courses/:id/scorm-packages (course staff) */
router.get(
  '/courses/:id/scorm-packages',
  route('Failed to load SCORM packages', async (req, res) => {
    const access = await requireCourseStaff(req, idSchema.parse(req.params.id));
    const list = await prisma.scormPackage.findMany({
      where: { courseId: access.course.id },
      orderBy: { createdAt: 'desc' },
      include: { sourceFile: { select: { scanStatus: true } } },
    });
    return res.json({ data: list.map(view) });
  })
);

async function loadPackage(tenantId: string, id: string) {
  const pkg = await prisma.scormPackage.findFirst({ where: { id, tenantId }, include: { sourceFile: { select: { scanStatus: true } } } });
  if (!pkg) throw new HttpError(404, 'SCORM package not found');
  return pkg;
}

/**
 * GET /api/v1/scorm-packages/:id/launch
 * A link to play the package as the caller (anyone who can read the course), valid for four hours, on the
 * content origin. Embed it in an iframe; the player there talks to the package.
 */
router.get(
  '/scorm-packages/:id/launch',
  route('Failed to launch the SCORM package', async (req, res) => {
    const origin = requireScorm();
    const tenantId = tenantIdOf(req);
    const pkg = await loadPackage(tenantId, idSchema.parse(req.params.id));
    await requireContentAccess(req, pkg.courseId);
    if (isWithdrawn(pkg)) throw new HttpError(410, WITHDRAWN_MESSAGE);
    const token = signLaunch({ t: tenantId, p: pkg.id, u: req.user!.id });
    return res.json({ data: { url: `${origin}/scorm-content/${token}/__launch`, origin, version: pkg.version } });
  })
);

/**
 * GET /api/v1/scorm-packages/:id/attempts (course staff): every learner's status and score, most recent first,
 * then the enrolled learners who have not opened the package ("not attempted", updatedAt null).
 */
router.get(
  '/scorm-packages/:id/attempts',
  route('Failed to load SCORM results', async (req, res) => {
    const pkg = await loadPackage(tenantIdOf(req), idSchema.parse(req.params.id));
    await requireCourseStaff(req, pkg.courseId);
    const user = { select: { firstName: true, lastName: true, email: true } };
    const [attempts, enrolled] = await Promise.all([
      prisma.scormAttempt.findMany({
        where: { packageId: pkg.id },
        orderBy: { updatedAt: 'desc' },
        select: { userId: true, status: true, scorePercent: true, completedAt: true, updatedAt: true, user },
      }),
      prisma.enrollment.findMany({
        where: { courseId: pkg.courseId, status: { in: [...ACTIVE_ENROLLMENT] } },
        orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
        select: { userId: true, user },
      }),
    ]);
    const started = new Set(attempts.map((a) => a.userId));
    return res.json({
      data: [
        ...attempts.map((a) => ({
          userId: a.userId, name: `${a.user.firstName} ${a.user.lastName}`, email: a.user.email, status: a.status, scorePercent: a.scorePercent, completedAt: a.completedAt, updatedAt: a.updatedAt,
        })),
        ...enrolled.filter((e) => !started.has(e.userId)).map((e) => ({
          userId: e.userId, name: `${e.user.firstName} ${e.user.lastName}`, email: e.user.email, status: 'not attempted', scorePercent: null, completedAt: null, updatedAt: null,
        })),
      ],
    });
  })
);

/** The file map of a package, typed. */
export const packageFiles = (filesJson: unknown) => filesJson as Record<string, PackageFile>;

export default router;
