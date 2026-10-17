import { z } from 'zod';
import { prisma } from './prisma';
import { HttpError } from './http';
import { httpUrl } from './validate';
import { storage } from './storage';
import { logger } from './logger';

export const FILE_PURPOSES = ['ASSIGNMENT_SUBMISSION', 'LESSON_MEDIA'] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const INTERNAL = new RegExp(`^/api/v1/files/(${UUID})$`, 'i');

/** The link stored in fileUrl / mediaUrl for an uploaded file. */
export const fileLink = (id: string) => `/api/v1/files/${id}`;

/** An http(s) URL, or a link to a file uploaded here (/api/v1/files/<id>). */
export const linkOrUpload = z.string().max(2048).refine((v) => INTERNAL.test(v) || httpUrl.safeParse(v).success, 'Must be an http(s) URL or an uploaded file');

/**
 * When `url` points at an uploaded file, checks it may be attached here: same organisation, same course,
 * the right purpose, and (for submissions) uploaded by the person submitting. External URLs pass through.
 */
export async function assertAttachable(url: string | null | undefined, opts: { tenantId: string; courseId: string; purpose: FilePurpose; ownerId?: string }) {
  const id = url ? INTERNAL.exec(url)?.[1] : undefined;
  if (!id) return;
  const file = await prisma.storedFile.findFirst({ where: { id, tenantId: opts.tenantId }, select: { courseId: true, purpose: true, ownerId: true } });
  if (!file || file.courseId !== opts.courseId || file.purpose !== opts.purpose || (opts.ownerId && file.ownerId !== opts.ownerId)) {
    throw new HttpError(400, 'That uploaded file cannot be used here');
  }
}

/** Removes a learner's uploaded submission files (bytes and records), as part of erasing their personal data. */
export async function eraseUploadsOf(userId: string, tenantId: string) {
  const files = await prisma.storedFile.findMany({ where: { tenantId, ownerId: userId, purpose: 'ASSIGNMENT_SUBMISSION' }, select: { id: true, storageKey: true } });
  for (const f of files) {
    try {
      await storage().delete(f.storageKey);
    } catch (err) {
      logger.warn({ err, fileId: f.id }, 'Could not delete an erased learner’s file from storage');
    }
  }
  await prisma.storedFile.deleteMany({ where: { id: { in: files.map((f) => f.id) } } });
  return files.length;
}
