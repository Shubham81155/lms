import { createHash, randomUUID } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { mkdir, rename, rm, stat, copyFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { Transform, type Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { Request } from 'express';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config';
import { HttpError } from './http';

// Uploaded files. The bytes go to a driver (a local folder, or any S3-compatible bucket); StoredFile rows
// (routes/files.routes.ts) record who uploaded what and decide who may read it.

/** What may be uploaded, and whether a browser may show it inline. SVG and HTML are refused: they can run script. */
export const ALLOWED_TYPES: Record<string, { inline: boolean }> = {
  'application/pdf': { inline: true },
  'image/png': { inline: true },
  'image/jpeg': { inline: true },
  'image/gif': { inline: true },
  'image/webp': { inline: true },
  'video/mp4': { inline: true },
  'video/webm': { inline: true },
  'audio/mpeg': { inline: true },
  'audio/mp4': { inline: true },
  'audio/wav': { inline: true },
  'audio/ogg': { inline: true },
  'text/plain': { inline: false },
  'text/csv': { inline: false },
  'application/zip': { inline: false },
  'application/x-zip-compressed': { inline: false }, // what Windows browsers call a .zip
  'application/msword': { inline: false },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { inline: false },
  'application/vnd.ms-excel': { inline: false },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { inline: false },
  'application/vnd.ms-powerpoint': { inline: false },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { inline: false },
  'application/vnd.oasis.opendocument.text': { inline: false },
  'application/vnd.oasis.opendocument.spreadsheet': { inline: false },
  'application/vnd.oasis.opendocument.presentation': { inline: false },
};

export interface StorageDriver {
  readonly name: 'local' | 's3';
  /** Stores a finished file from disk under `key`. */
  putFile(key: string, filePath: string, contentType: string): Promise<void>;
  /** The stored bytes. */
  open(key: string): Promise<Readable>;
  /** A short-lived direct download link, or null when downloads must stream through the API (local). */
  signedDownloadUrl(key: string, opts: { filename: string; contentType: string; inline: boolean }): Promise<string | null>;
  delete(key: string): Promise<void>;
}

/** Keys are generated here (tenant/uuid); anything else is refused so a key can never escape the folder. */
const KEY = /^[A-Za-z0-9_-]+\/[0-9a-f-]{36}$/;
export const newStorageKey = (tenantId: string) => `${tenantId.replace(/[^A-Za-z0-9_-]/g, '_')}/${randomUUID()}`;
/** Organisation exports (lib/offboarding.ts): exports/<tenant>/<export id>.zip. */
const EXPORT_KEY = /^exports\/[A-Za-z0-9_-]+\/[0-9a-f-]{36}\.zip$/;
export const exportStorageKey = (tenantId: string, exportId: string) => `exports/${tenantId.replace(/[^A-Za-z0-9_-]/g, '_')}/${exportId}.zip`;
const checkKey = (key: string) => {
  if (!KEY.test(key) && !EXPORT_KEY.test(key)) throw new Error(`Invalid storage key: ${key}`);
  return key;
};

class LocalDriver implements StorageDriver {
  readonly name = 'local' as const;
  constructor(private readonly root: string) {}
  private file(key: string) {
    return path.join(this.root, ...checkKey(key).split('/'));
  }
  async putFile(key: string, filePath: string) {
    const target = this.file(key);
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await rename(filePath, target);
    } catch {
      // A temp folder on another disk cannot be renamed across; copy instead.
      await copyFile(filePath, target);
      await rm(filePath, { force: true });
    }
  }
  async open(key: string) {
    const file = this.file(key);
    await stat(file); // throws ENOENT before streaming starts
    return createReadStream(file);
  }
  async signedDownloadUrl() {
    return null;
  }
  async delete(key: string) {
    await rm(this.file(key), { force: true });
  }
}

class S3Driver implements StorageDriver {
  readonly name = 's3' as const;
  private readonly client: S3Client;
  constructor(private readonly bucket: string) {
    this.client = new S3Client({
      region: config.S3_REGION,
      ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      ...(config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
        ? { credentials: { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY } }
        : {}),
    });
  }
  async putFile(key: string, filePath: string, contentType: string) {
    const { size } = await stat(filePath);
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: checkKey(key), Body: createReadStream(filePath), ContentLength: size, ContentType: contentType })
    );
    await rm(filePath, { force: true });
  }
  async open(key: string) {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: checkKey(key) }));
    return r.Body as Readable;
  }
  async signedDownloadUrl(key: string, opts: { filename: string; contentType: string; inline: boolean }) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: checkKey(key),
        ResponseContentType: opts.contentType,
        ResponseContentDisposition: contentDisposition(opts.filename, opts.inline),
      }),
      { expiresIn: 300 }
    );
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: checkKey(key) }));
  }
}

let driver: StorageDriver | null = null;
/** The configured driver (tests may swap it with setStorageDriver). */
export function storage(): StorageDriver {
  if (!driver) {
    driver =
      config.STORAGE_DRIVER === 's3'
        ? new S3Driver(config.S3_BUCKET!)
        : new LocalDriver(path.resolve(__dirname, '../../../..', config.STORAGE_LOCAL_DIR));
  }
  return driver;
}
export const setStorageDriver = (d: StorageDriver | null) => {
  driver = d;
};
export const localDriver = (root: string): StorageDriver => new LocalDriver(root);

/** Duplicates stored bytes under a new key (via a temporary file, so it works for every driver). */
export async function copyStored(fromKey: string, toKey: string, contentType: string): Promise<void> {
  const tempPath = path.join(os.tmpdir(), `lms-copy-${randomUUID()}`);
  try {
    await pipeline(await storage().open(fromKey), createWriteStream(tempPath));
    await storage().putFile(toKey, tempPath, contentType);
  } finally {
    await rm(tempPath, { force: true });
  }
}

export const maxUploadBytes = () => config.UPLOAD_MAX_MB * 1024 * 1024;

/**
 * Streams the request body to a temporary file, refusing it (413) as soon as it passes the size limit, and
 * returns the file with its size and SHA-256. The caller hands the file to the driver.
 */
export async function receiveUpload(req: Request, maxBytes = maxUploadBytes()): Promise<{ tempPath: string; sizeBytes: number; sha256: string }> {
  // The rest of the body is read and discarded (req.resume) so the client, still sending, gets the 413
  // rather than a reset connection. The web proxy's body limit bounds how much that can be.
  const tooLarge = () => new HttpError(413, `Files can be at most ${Math.floor(maxBytes / 1048576)} MB`);
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) {
    req.resume();
    throw tooLarge();
  }

  const tempPath = path.join(os.tmpdir(), `lms-upload-${randomUUID()}`);
  const hash = createHash('sha256');
  let sizeBytes = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _enc, done) {
      sizeBytes += chunk.length;
      if (sizeBytes > maxBytes) return done(tooLarge());
      hash.update(chunk);
      done(null, chunk);
    },
  });
  // pipe(), not pipeline(): a failure must not destroy the request, or the 413 could never be sent.
  req.on('aborted', () => meter.destroy(new HttpError(400, 'The upload was interrupted')));
  req.pipe(meter);
  try {
    await pipeline(meter, createWriteStream(tempPath));
  } catch (e) {
    req.unpipe(meter);
    req.resume();
    await rm(tempPath, { force: true });
    throw e instanceof HttpError ? e : new HttpError(400, 'The upload was interrupted');
  }
  if (sizeBytes === 0) {
    await rm(tempPath, { force: true });
    throw new HttpError(400, 'The file is empty');
  }
  return { tempPath, sizeBytes, sha256: hash.digest('hex') };
}

/** RFC 6266 Content-Disposition with an ASCII fallback and the UTF-8 name. */
export function contentDisposition(filename: string, inline: boolean): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
