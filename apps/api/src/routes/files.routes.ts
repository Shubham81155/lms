import { Router, type Request, type Response } from 'express';
import { once } from 'events';
import { z } from 'zod';
import { createReadStream } from 'fs';
import { rm } from 'fs/promises';
import { assertStorageAllowed, withStorage } from '../lib/billing';
import { prisma } from '../lib/prisma';
import { HttpError, route } from '../lib/http';
import { idSchema, parseQuery } from '../lib/validate';
import { canSeeAllCourses, requireContentAccess, requireCourseEditor } from '../lib/access';
import { logAuditEvent } from '../lib/audit';
import { authenticateJWT, tenantIdOf } from '../middleware/auth';
import { ALLOWED_TYPES, contentDisposition, newStorageKey, receiveUpload, storage } from '../lib/storage';
import { FILE_PURPOSES, fileLink } from '../lib/stored-files';
import { ScanUnavailableError, virusScanner } from '../lib/virus-scan';

// Mounted at /api/v1/files. Uploads stream straight into storage (lib/storage); the result is linked from
// a submission's fileUrl or a lesson's mediaUrl as /api/v1/files/<id>. Who may read a file follows from
// its purpose: a submission file is for the learner who uploaded it and the course's staff; lesson media
// is for anyone who can read the course; an avatar is visible to anyone in the tenant.
// With a virus scanner set (CLAMAV_URL) every upload is scanned before it is stored.

const router = Router();
router.use(authenticateJWT);

export const uploadQuery = z.object({
  purpose: z.enum(FILE_PURPOSES),
  courseId: idSchema.optional(),
  /** The original file name, shown on download. Path parts and control characters are dropped. */
  filename: z.string().trim().min(1).max(200),
});

const cleanName = (name: string) =>
  name
    .split(/[\\/]/)
    .pop()!
    .split('')
    .filter((ch) => ch.charCodeAt(0) > 0x1f && ch.charCodeAt(0) !== 0x7f)
    .join('')
    .trim()
    .slice(0, 200) || 'file';

/**
 * POST /api/v1/files?purpose&courseId&filename
 * The request body is the file itself (not multipart), with its own Content-Type.
 */
router.post(
  '/',
  route('Failed to upload the file', async (req, res) => {
    try {
      await handleUpload(req, res);
    } catch (e) {
      if (!req.readableEnded) {
        req.resume();
        await once(req, 'end').catch(() => undefined);
      }
      throw e;
    }
  })
);

async function handleUpload(req: Request, res: Response) {
  const { purpose, courseId, filename } = parseQuery(req, uploadQuery);
  const contentType = String(req.headers['content-type'] ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (!ALLOWED_TYPES[contentType]) throw new HttpError(415, 'This kind of file cannot be uploaded');

  if (purpose === 'SCORM_PACKAGE' && contentType !== 'application/zip' && contentType !== 'application/x-zip-compressed') {
    throw new HttpError(415, 'A SCORM package must be a .zip file');
  }
  if (purpose === 'AVATAR') {
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(contentType)) {
      throw new HttpError(415, 'A profile picture must be an image (PNG, JPEG, WebP, or GIF)');
    }
  } else if (purpose === 'LESSON_MEDIA' || purpose === 'SCORM_PACKAGE') {
    if (!courseId) throw new HttpError(400, 'courseId is required for this file upload');
    await requireCourseEditor(req, courseId);
  } else {
    if (!courseId) throw new HttpError(400, 'courseId is required for assignment submissions');
    if (!(await requireContentAccess(req, courseId)).isEnrolled) {
      throw new HttpError(403, 'Forbidden: only enrolled learners can upload work for this course');
    }
  }

  const tenantId = tenantIdOf(req);
  const { tempPath, sizeBytes, sha256 } = await receiveUpload(req);
  const storageKey = newStorageKey(tenantId);
  let scannedAt: Date | null = null;
  try {
    await assertStorageAllowed(tenantId, sizeBytes);
    const scanner = virusScanner();
    if (scanner) {
      let result;
      try {
        result = await scanner.scan(createReadStream(tempPath));
      } catch (e) {
        if (e instanceof ScanUnavailableError)
          throw new HttpError(503, 'Files cannot be checked for viruses right now. Try again in a few minutes.');
        throw e;
      }
      if (result.infected) {
        await logAuditEvent({
          tenantId,
          userId: req.user!.id,
          action: 'FILE_MALWARE_BLOCKED',
          resourceType: 'FILE',
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          diffJson: { purpose, courseId, contentType, sizeBytes, sha256, signature: result.signature },
        });
        throw new HttpError(422, 'This file contains a virus or other malware and was not uploaded.');
      }
      scannedAt = new Date();
    }
    await storage().putFile(storageKey, tempPath, contentType);
  } finally {
    await rm(tempPath, { force: true });
  }
  let file;
  try {
    file = await withStorage(tenantId, sizeBytes, (tx) =>
      tx.storedFile.create({
        data: {
          tenantId,
          ownerId: req.user!.id,
          courseId: courseId || null,
          purpose,
          storageKey,
          filename: cleanName(filename),
          contentType,
          sizeBytes,
          sha256,
          scanStatus: scannedAt ? 'CLEAN' : 'NOT_SCANNED',
          scannedAt,
        },
      })
    );
  } catch (e) {
    await storage()
      .delete(storageKey)
      .catch(() => undefined);
    throw e;
  }
  await logAuditEvent({
    tenantId,
    userId: req.user!.id,
    action: 'FILE_UPLOADED',
    resourceType: 'FILE',
    resourceId: file.id,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    diffJson: { purpose, courseId, contentType, sizeBytes },
  });
  return res.status(201).json({
    data: {
      id: file.id,
      url: fileLink(file.id),
      filename: file.filename,
      contentType,
      sizeBytes,
      sha256,
      scanStatus: file.scanStatus,
      createdAt: file.createdAt,
    },
  });
}

/**
 * GET /api/v1/files/:id
 * Streams the file (local storage) or redirects to a link that works for five minutes (S3).
 */
router.get(
  '/:id',
  route('Failed to download the file', async (req, res) => {
    const file = await prisma.storedFile.findFirst({ where: { id: idSchema.parse(req.params.id), tenantId: tenantIdOf(req) } });
    if (!file) throw new HttpError(404, 'File not found');
    if (file.scanStatus === 'INFECTED') throw new HttpError(410, 'This file was withdrawn because a virus scan found malware in it.');

    if (file.purpose !== 'AVATAR') {
      if (!file.courseId) throw new HttpError(404, 'File not found');
      const access = await requireContentAccess(req, file.courseId);
      const user = req.user!;
      const staffOnly = file.purpose === 'SCORM_PACKAGE' || (file.purpose === 'ASSIGNMENT_SUBMISSION' && file.ownerId !== user.id);
      if (staffOnly && !access.isStaff && !canSeeAllCourses(user.role)) {
        throw new HttpError(404, 'File not found');
      }
    }

    const inline = ALLOWED_TYPES[file.contentType]?.inline ?? false;
    const signed = await storage().signedDownloadUrl(file.storageKey, { filename: file.filename, contentType: file.contentType, inline });
    res.setHeader('cache-control', 'private, no-store');
    if (signed) return res.redirect(302, signed);

    res.setHeader('content-type', file.contentType);
    res.setHeader('content-length', String(file.sizeBytes));
    res.setHeader('content-disposition', contentDisposition(file.filename, inline));
    res.setHeader('x-content-type-options', 'nosniff');
    if (file.contentType !== 'application/pdf')
      res.setHeader('content-security-policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
    const stream = await storage().open(file.storageKey);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  })
);

export default router;
