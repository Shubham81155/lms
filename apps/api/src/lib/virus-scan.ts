import net from 'net';
import { once } from 'events';
import type { Readable } from 'stream';
import { runWithTenant } from '@enterprise-lms/database';
import { config } from '../config';
import { basePrisma, prisma } from './prisma';
import { logger } from './logger';
import { logAuditEvent } from './audit';
import { storage } from './storage';
import { startPeriodicJob } from './job-lock';

// Virus scanning of uploads with a ClamAV daemon (clamd), spoken to over TCP with its INSTREAM command, so no
// client library or shared disk is needed. Uploads are scanned before they are stored (routes/files.routes.ts);
// files stored while no scanner was set are scanned by a background sweep, and any found infected are no
// longer served.

export type ScanResult = { infected: false } | { infected: true; signature: string };

export interface VirusScanner {
  readonly name: string;
  scan(input: Readable): Promise<ScanResult>;
}

/** The scanner could not give an answer (unreachable, timed out, refused the stream). The file is not trusted. */
export class ScanUnavailableError extends Error {}

/**
 * clamd refused the stream because it is over its StreamMaxLength ("INSTREAM size limit exceeded"). The file was
 * not scanned and is never treated as clean; raise StreamMaxLength (deploy/clamd.conf) to at least UPLOAD_MAX_MB.
 */
export class ScanLimitExceededError extends ScanUnavailableError {
  constructor() {
    super('the file is larger than the virus scanner accepts (clamd StreamMaxLength is below UPLOAD_MAX_MB)');
  }
}

/** clamd takes the stream in chunks, each prefixed with its length; a zero length ends it. */
const CHUNK = 64 * 1024;

export function clamdScanner(host: string, port: number, timeoutMs: number): VirusScanner {
  return {
    name: 'clamav',
    scan: (input) =>
      new Promise<ScanResult>((resolve, reject) => {
        const socket = net.connect({ host, port });
        let reply = '';
        let settled = false;
        const finish = (err: Error | null, result?: ScanResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          socket.destroy();
          input.destroy();
          if (err) reject(err);
          else resolve(result!);
        };
        const timer = setTimeout(() => finish(new ScanUnavailableError('the virus scanner timed out')), timeoutMs);
        const answer = () => {
          const line = reply.split('\0')[0].trim();
          if (line === 'stream: OK') return finish(null, { infected: false });
          const found = /^stream: (.+) FOUND$/.exec(line);
          if (found) return finish(null, { infected: true, signature: found[1] });
          if (/size limit exceeded/i.test(line)) return finish(new ScanLimitExceededError());
          finish(new ScanUnavailableError(line ?`the virus scanner replied: ${line}` : 'the virus scanner closed the connection'));
        };

        socket.on('error', (e) => {
          // clamd answers and closes when it refuses a stream, and the rest of our writes then reset the connection.
          if (reply) return answer();
          finish(new ScanUnavailableError(`the virus scanner cannot be reached (${e.message})`));
        });
        socket.on('data', (d: Buffer) => {
          reply += d.toString('utf8');
          if (reply.includes('\0')) answer();
        });
        socket.on('end', answer);
        socket.on('connect', async () => {
          try {
            socket.write('zINSTREAM\0');
            for await (const data of input) {
              const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
              for (let at = 0; at < buf.length; at += CHUNK) {
                if (settled) return;
                const part = buf.subarray(at, at + CHUNK);
                const head = Buffer.alloc(4);
                head.writeUInt32BE(part.length);
                // clamd may answer (and close) early, e.g. when the stream is over its size limit.
                if (!socket.write(Buffer.concat([head, part]))) await Promise.race([once(socket, 'drain'), once(socket, 'close')]);
              }
            }
            if (!settled) socket.write(Buffer.alloc(4));
          } catch (e) {
            finish(new ScanUnavailableError(`the file could not be sent to the virus scanner (${(e as Error).message})`));
          }
        });
      }),
  };
}

let override: VirusScanner | null | undefined;
let configured: VirusScanner | null | undefined;

/** The configured scanner, or null when CLAMAV_URL is not set (uploads are then stored unscanned). */
export function virusScanner(): VirusScanner | null {
  if (override !== undefined) return override;
  if (configured === undefined) {
    const m = config.CLAMAV_URL ? /^tcp:\/\/([^:/]+):(\d+)$/.exec(config.CLAMAV_URL) : null;
    configured = m ? clamdScanner(m[1], Number(m[2]), config.CLAMAV_TIMEOUT_MS) : null;
  }
  return configured;
}

/** For tests: use this scanner (null: none); undefined goes back to the configured one. */
export function setVirusScanner(s: VirusScanner | null | undefined): void {
  override = s;
}

export interface SweepResult {
  clean: number;
  infected: number;
  /** True when the scanner could not answer, so the rest was left for the next sweep. */
  stopped: boolean;
}

/**
 * Scans up to `batch` NOT_SCANNED files per tenant. A file found infected is marked INFECTED (and so never
 * served again) and audited; its bytes are kept so an administrator can review a false positive. Never throws.
 */
export async function scanPendingFiles(opts: { batch?: number } = {}): Promise<SweepResult> {
  const totals: SweepResult = { clean: 0, infected: 0, stopped: false };
  const scanner = virusScanner();
  if (!scanner) return totals;
  const tenants = await basePrisma.tenant.findMany({ select: { id: true } });
  for (const tenant of tenants) {
    if (totals.stopped) break;
    try {
      await runWithTenant(tenant.id, async () => {
        const files = await prisma.storedFile.findMany({
          where: { scanStatus: 'NOT_SCANNED' },
          orderBy: { createdAt: 'asc' },
          take: opts.batch ?? 50,
          select: { id: true, storageKey: true, purpose: true, courseId: true, sha256: true },
        });
        for (const file of files) {
          let result: ScanResult;
          try {
            result = await scanner.scan(await storage().open(file.storageKey));
          } catch (err) {
            if (err instanceof ScanUnavailableError) {
              totals.stopped = true;
              logger.warn({ err: err.message }, 'file scan sweep paused: the virus scanner is unavailable');
              return;
            }
            logger.error({ err, fileId: file.id }, 'could not scan a stored file');
            continue;
          }
          const scanStatus = result.infected ? 'INFECTED' : 'CLEAN';
          await prisma.storedFile.update({ where: { id: file.id }, data: { scanStatus, scannedAt: new Date() } });
          if (result.infected) {
            totals.infected++;
            logger.warn({ fileId: file.id, tenantId: tenant.id, signature: result.signature }, 'malware found in a stored file; it is no longer served');
            await logAuditEvent({
              tenantId: tenant.id, action: 'FILE_MALWARE_FOUND', resourceType: 'FILE', resourceId: file.id,
              diffJson: { signature: result.signature, purpose: file.purpose, courseId: file.courseId, sha256: file.sha256 },
            });
          } else totals.clean++;
        }
      });
    } catch (err) {
      logger.error({ err, tenantId: tenant.id }, 'file scan sweep failed for tenant');
    }
  }
  return totals;
}

/** Starts the background sweep when a scanner is set; one instance at a time (advisory lock), none overlapping. */
export function startFileScanSweep(): void {
  const seconds = config.FILE_SCAN_SWEEP_INTERVAL_SECONDS;
  if (seconds <= 0 || !virusScanner()) return;
  startPeriodicJob('file-scan-sweep', seconds, async () => {
    const r = await scanPendingFiles();
    if (r.clean || r.infected) logger.info(r, 'stored files scanned');
  });
}
