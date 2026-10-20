import { createWriteStream } from 'fs';
import { rm, stat } from 'fs/promises';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import yazl from 'yazl';
import { Prisma, runWithTenant } from '@enterprise-lms/database';
import { basePrisma, prisma } from './prisma';
import { exportStorageKey, storage } from './storage';
import { logger } from './logger';

// A full export of one organisation: a ZIP with one JSON-lines file per table (every table holding the organisation's
// rows, found from the Prisma schema, so a new table is exported without anyone remembering to add it) and the
// stored files (uploads and unpacked SCORM packages). Secrets never leave: see DENIED_FIELDS and SECRET_LIKE.
// The ZIP is streamed to a temporary file a page of rows at a time, then handed to the storage driver under
// exports/<tenant>/<export id>.zip.

/** Days an ordinary export can be downloaded before it is removed. */
export const EXPORT_LINK_DAYS = 7;
/** Days the final export taken before a deletion is kept for the platform operator. */
export const FINAL_EXPORT_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE = 500;

/**
 * Tables never exported: one-time secrets (only their hashes are stored, and they are useless outside this
 * platform) and the platform's own offboarding records.
 */
const EXCLUDED_MODELS = new Set(['PasswordResetToken', 'EmailVerificationToken', 'TenantExport', 'TenantDeletion', 'OrganizationRequest', 'RetentionPolicy']);

/** Secret fields, named explicitly. Anything else that looks like a secret (SECRET_LIKE) is dropped too. */
export const DENIED_FIELDS: Record<string, readonly string[]> = {
  Tenant: ['customDomainToken', 'customDomainLiveToken'],
  User: ['passwordHash', 'mfaSecret', 'mfaRecoveryHashes', 'tokenVersion'],
  WebhookEndpoint: ['secret'],
  ScimToken: ['tokenHash'],
  SsoConnection: ['clientSecretEnc'],
  TenantAiConfig: ['apiKeyEnc'],
  /** Internal storage location; the file itself is in the ZIP under files/. */
  StoredFile: ['storageKey'],
  SupportHandoff: ['tokenHash'],
};

/** Fail safe: a field whose name looks like a credential is never exported, even if nobody listed it. */
export const SECRET_LIKE = /pass(word|phrase)|secret|token|hash|api_?key|private_?key|credential|otp|recovery|signature|Enc$/i;
/** Names SECRET_LIKE matches that are not secrets. */
const NOT_SECRET = new Set(['LtiDeployment.authTokensUrl']);

export interface TablePlan {
  model: string;
  /** Prisma delegate (camelCase model name). */
  delegate: string;
  /** Scalar fields that are exported. */
  fields: string[];
  /** Restricts the rows to the organisation's: { tenantId } or through the parent that has it. */
  where: (tenantId: string) => Record<string, unknown>;
}

const models = () => Prisma.dmmf.datamodel.models;
const hasTenantId = (m: { fields: readonly { name: string }[] }) => m.fields.some((f) => f.name === 'tenantId');

export function exportedFields(model: string): string[] {
  const m = models().find((x) => x.name === model);
  if (!m) return [];
  const denied = DENIED_FIELDS[model] ?? [];
  return m.fields
    .filter((f) => f.kind === 'scalar' || f.kind === 'enum')
    .filter((f) => !denied.includes(f.name) && (NOT_SECRET.has(`${model}.${f.name}`) || !SECRET_LIKE.test(f.name)))
    .map((f) => f.name);
}

/** How a table without tenantId reaches one that has it (Department -> campus.tenantId), via its own foreign keys. */
function pathToTenant(model: string, depth = 0): ((tenantId: string) => Record<string, unknown>) | null {
  const m = models().find((x) => x.name === model);
  if (!m || depth > 4) return null;
  if (hasTenantId(m)) return (tenantId) => ({ tenantId });
  for (const f of m.fields) {
    if (f.kind !== 'object' || !f.relationFromFields?.length || f.type === 'Tenant') continue;
    const parent = pathToTenant(f.type, depth + 1);
    if (parent) return (tenantId) => ({ [f.name]: parent(tenantId) });
  }
  return null;
}

let plans: TablePlan[] | null = null;
/** Every table holding an organisation's rows (the Tenant row itself is exported separately). */
export function tablePlans(): TablePlan[] {
  if (plans) return plans;
  plans = models()
    .filter((m) => m.name !== 'Tenant' && !EXCLUDED_MODELS.has(m.name))
    .flatMap((m) => {
      const where = pathToTenant(m.name);
      if (!where) return [];
      return [{ model: m.name, delegate: m.name[0].toLowerCase() + m.name.slice(1), fields: exportedFields(m.name), where }];
    })
    .sort((a, b) => a.model.localeCompare(b.model));
  return plans;
}

/**
 * Delegates of the tables that carry tenantId without a foreign key to Tenant (support passes and hand-offs, token
 * tables): deleting the Tenant row does not cascade to them, so the deletion removes their rows by tenantId.
 */
export function unlinkedTenantDelegates(): string[] {
  return models()
    .filter((m) => hasTenantId(m) && !['TenantExport', 'TenantDeletion'].includes(m.name) && !m.fields.some((f) => f.kind === 'object' && f.type === 'Tenant'))
    .map((m) => m.name[0].toLowerCase() + m.name.slice(1));
}

const select = (fields: string[]) => Object.fromEntries(fields.map((f) => [f, true]));
const replacer = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);
const delegateOf = (plan: TablePlan) => (prisma as any)[plan.delegate];

/** Counts each table's rows of the organisation (the deletion summary). */
export async function countRows(tenantId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const plan of tablePlans()) {
    out[plan.model] = await runWithTenant(tenantId, () => delegateOf(plan).count({ where: plan.where(tenantId) }));
  }
  return out;
}

/** The storage keys of everything the organisation has stored: uploads and unpacked SCORM package files. */
export async function storedFilesOf(tenantId: string): Promise<{ key: string; path: string }[]> {
  const out: { key: string; path: string }[] = [];
  let cursor: string | undefined;
  for (;;) {
    const files = await runWithTenant(tenantId, () =>
      prisma.storedFile.findMany({
        where: { tenantId }, select: { id: true, storageKey: true, filename: true }, orderBy: { id: 'asc' }, take: PAGE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })
    );
    for (const f of files) out.push({ key: f.storageKey, path: `files/${f.id}/${safeName(f.filename)}` });
    if (files.length < PAGE) break;
    cursor = files[files.length - 1].id;
  }
  const packages = await runWithTenant(tenantId, () => prisma.scormPackage.findMany({ where: { tenantId }, select: { id: true, filesJson: true } }));
  for (const p of packages) {
    for (const [file, meta] of Object.entries((p.filesJson ?? {}) as Record<string, { key?: string }>)) {
      if (meta?.key) out.push({ key: meta.key, path: `scorm/${p.id}/${file.split('/').map(safeName).join('/')}` });
    }
  }
  return out;
}

/** A path segment safe inside a ZIP (no separators, no "..", nothing empty). */
function safeName(name: string): string {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is being removed
  const clean = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+$/, '_').slice(0, 200);
  return clean || '_';
}

/** One table as JSON lines, a page at a time, each page read in the organisation's context. */
function tableStream(tenantId: string, plan: TablePlan, counts: Record<string, number>): Readable {
  async function* lines() {
    let cursor: string | undefined;
    counts[plan.model] = 0;
    for (;;) {
      const rows: { id: string }[] = await runWithTenant(tenantId, () =>
        delegateOf(plan).findMany({ where: plan.where(tenantId), select: select(plan.fields), orderBy: { id: 'asc' }, take: PAGE, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) })
      );
      counts[plan.model] += rows.length;
      if (rows.length) yield rows.map((r) => JSON.stringify(r, replacer)).join('\n') + '\n';
      if (rows.length < PAGE) break;
      cursor = rows[rows.length - 1].id;
    }
  }
  return Readable.from(lines());
}

const README = `This archive holds all the data of one organisation, exported from the learning platform.

data/Tenant.json      the organisation itself
data/<Table>.jsonl    one JSON object per line for each table (ids link the tables together)
files/<id>/<name>     uploaded files (StoredFile rows in data/StoredFile.jsonl)
scorm/<id>/...        unpacked SCORM packages (ScormPackage rows)
manifest.json         when it was made, row counts, and any file that could not be read

Passwords, sign-in tokens, MFA secrets, API keys and other credentials are never included.
`;

/** Writes the organisation's ZIP to a temporary file; returns its path. The caller removes it. */
async function writeZip(tenantId: string, exportId: string): Promise<string> {
  const tempPath = path.join(os.tmpdir(), `lms-export-${exportId}.zip`);
  const tenantFields = exportedFields('Tenant');
  const tenant = await basePrisma.tenant.findUnique({ where: { id: tenantId }, select: select(tenantFields) as any });
  if (!tenant) throw new Error('The organisation no longer exists');
  const files = await storedFilesOf(tenantId);
  const counts: Record<string, number> = {};
  const missingFiles: string[] = [];
  const mtime = new Date();

  const zip = new yazl.ZipFile();
  const out = createWriteStream(tempPath);
  await new Promise<void>((resolve, reject) => {
    const fail = (err: unknown) => {
      zip.outputStream.unpipe(out);
      out.destroy();
      reject(err);
    };
    zip.on('error', fail);
    out.on('error', fail);
    out.on('finish', () => resolve());
    zip.outputStream.pipe(out);

    zip.addBuffer(Buffer.from(README), 'README.txt', { mtime });
    zip.addBuffer(Buffer.from(JSON.stringify(tenant, replacer, 2)), 'data/Tenant.json', { mtime });
    for (const plan of tablePlans()) {
      zip.addReadStreamLazy(`data/${plan.model}.jsonl`, { mtime }, (cb) => {
        const s = tableStream(tenantId, plan, counts);
        s.on('error', fail);
        cb(null, s);
      });
    }
    for (const f of files) {
      // Media is mostly compressed already; storing it saves the time.
      zip.addReadStreamLazy(f.path, { mtime, compress: false }, (cb) => {
        storage()
          .open(f.key)
          .then((s) => {
            s.on('error', fail);
            cb(null, s);
          })
          .catch((err) => {
            // A file missing from storage is noted in the manifest rather than failing the whole export.
            logger.warn({ err, tenantId, path: f.path }, 'export: a stored file could not be read');
            missingFiles.push(f.path);
            cb(null, Readable.from([]));
          });
      });
    }
    // Lazy, so it is written last, when the counts are known.
    zip.addReadStreamLazy('manifest.json', { mtime }, (cb) =>
      cb(null, Readable.from([JSON.stringify({ exportId, tenantId, exportedAt: new Date().toISOString(), rowCounts: counts, files: files.length, missingFiles }, null, 2)]))
    );
    zip.end();
  }).catch(async (err) => {
    await rm(tempPath, { force: true });
    throw err;
  });
  return tempPath;
}

/**
 * Builds a QUEUED export: QUEUED -> RUNNING -> READY (or FAILED). Returns the final status, or null when
 * the export was not waiting (someone else took it).
 */
export async function buildExport(exportId: string): Promise<'READY' | 'FAILED' | null> {
  const claimed = await basePrisma.tenantExport.updateMany({ where: { id: exportId, status: 'QUEUED' }, data: { status: 'RUNNING', startedAt: new Date(), error: null } });
  if (!claimed.count) return null;
  const exp = await basePrisma.tenantExport.findUniqueOrThrow({ where: { id: exportId } });
  let tempPath: string | null = null;
  try {
    tempPath = await writeZip(exp.tenantId, exp.id);
    const { size } = await stat(tempPath);
    const key = exportStorageKey(exp.tenantId, exp.id);
    await storage().putFile(key, tempPath, 'application/zip');
    const now = new Date();
    await basePrisma.tenantExport.update({
      where: { id: exp.id },
      data: {
        status: 'READY', storageKey: key, sizeBytes: BigInt(size), completedAt: now,
        expiresAt: new Date(now.getTime() + (exp.isFinal ? FINAL_EXPORT_RETENTION_DAYS : EXPORT_LINK_DAYS) * DAY_MS),
      },
    });
    return 'READY';
  } catch (err) {
    logger.error({ err, exportId, tenantId: exp.tenantId }, 'organisation export failed');
    await basePrisma.tenantExport.update({ where: { id: exp.id }, data: { status: 'FAILED', completedAt: new Date(), error: err instanceof Error ? err.message.slice(0, 500) : 'Export failed' } });
    return 'FAILED';
  } finally {
    if (tempPath) await rm(tempPath, { force: true });
  }
}
