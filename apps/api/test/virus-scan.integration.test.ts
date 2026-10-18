import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import net from 'net';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { mkdtemp, rm } from 'fs/promises';
import { PrismaClient } from '@prisma/client';
import { startTestDatabase, TestDatabase } from '../../../packages/database/test-utils/embedded';

// Virus scanning against a stand-in for clamd that speaks its INSTREAM protocol over TCP: the framing,
// clean and infected answers, a scanner that is down, and the sweep over files stored before scanning was on.

const PASSWORD = 'CorrectHorse1!';
const EICAR = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
let db: TestDatabase;
let admin: PrismaClient;
let app: import('express').Express;
let dir: string;
let scan: typeof import('../src/lib/virus-scan');

/** A fake clamd. It answers FOUND for anything containing the EICAR string, and refuses streams over `limit`. */
function fakeClamd(limit = 10 * 1024 * 1024) {
  const received: Buffer[] = [];
  const server = net.createServer((socket) => {
    let buf = Buffer.alloc(0);
    let started = false;
    const body: Buffer[] = [];
    let size = 0;
    socket.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!started) {
        const end = buf.indexOf(0);
        if (end < 0) return;
        if (buf.subarray(0, end).toString() !== 'zINSTREAM') return socket.end('UNKNOWN COMMAND\0');
        started = true;
        buf = buf.subarray(end + 1);
      }
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (len === 0) {
          const all = Buffer.concat(body);
          received.push(all);
          return socket.end(all.includes(EICAR) ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0');
        }
        if (buf.length < 4 + len) return;
        body.push(buf.subarray(4, 4 + len));
        size += len;
        buf = buf.subarray(4 + len);
        if (size > limit) return socket.end('INSTREAM size limit exceeded. ERROR\0');
      }
    });
    socket.on('error', () => undefined);
  });
  return new Promise<{ port: number; received: Buffer[]; close: () => Promise<void> }>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ port: (server.address() as net.AddressInfo).port, received, close: () => new Promise((r) => server.close(() => r())) })
    )
  );
}

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new PrismaClient({ datasourceUrl: db.adminUrl });
  await admin.tenant.create({ data: { id: 't-h', slug: 'harvard', name: 'harvard' } });
  const user = (id: string, role: any) =>
    admin.user.create({ data: { id, tenantId: 't-h', email: `${id}@x.edu`, firstName: id, lastName: 'L', role, passwordHash: bcrypt.hashSync(PASSWORD, 4), emailVerified: true } });
  await user('teacher', 'INSTRUCTOR');
  await user('s1', 'STUDENT');
  await admin.course.create({ data: { id: 'c1', tenantId: 't-h', code: 'C1', title: 'Course', status: 'PUBLISHED' } });
  await admin.courseInstructor.create({ data: { courseId: 'c1', userId: 'teacher', isPrimary: true } });
  await admin.enrollment.create({ data: { tenantId: 't-h', courseId: 'c1', userId: 's1', status: 'IN_PROGRESS' } });

  dir = await mkdtemp(path.join(os.tmpdir(), 'lms-scan-test-'));
  process.env.DATABASE_URL = db.appUrl;
  app = (await import('../src/server.js')).app;
  scan = await import('../src/lib/virus-scan.js');
  const storage = await import('../src/lib/storage.js');
  storage.setStorageDriver(storage.localDriver(dir));
}, 240_000);

afterAll(async () => {
  scan?.setVirusScanner(undefined);
  await admin?.$disconnect();
  await db?.stop();
  if (dir) await rm(dir, { recursive: true, force: true });
}, 60_000);

afterEach(() => scan.setVirusScanner(null));

async function as(who: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').set('x-tenant-id', 'harvard').send({ email: `${who}@x.edu`, password: PASSWORD });
  expect(res.status, `login as ${who}`).toBe(200);
  return agent;
}

const upload = (agent: request.Agent, body: Buffer, filename = 'notes.txt') =>
  agent.post('/api/v1/files').query({ purpose: 'ASSIGNMENT_SUBMISSION', courseId: 'c1', filename }).set('content-type', 'text/plain').send(body);

describe('the clamd client', () => {
  it('sends the whole file in length-prefixed chunks and reads the answer', async () => {
    const clamd = await fakeClamd();
    const scanner = scan.clamdScanner('127.0.0.1', clamd.port, 5000);
    const big = Buffer.alloc(300 * 1024, 7); // several 64 KB chunks
    expect(await scanner.scan(Readable.from([big.subarray(0, 1000), big.subarray(1000)]))).toEqual({ infected: false });
    expect(Buffer.compare(clamd.received[0], big)).toBe(0);
    expect(await scanner.scan(Readable.from([Buffer.from('hello '), EICAR]))).toEqual({ infected: true, signature: 'Eicar-Test-Signature' });
    await clamd.close();
  });

  it('reports a scanner that is over its limit or down as unavailable, never as clean', async () => {
    const clamd = await fakeClamd(1024);
    await expect(scan.clamdScanner('127.0.0.1', clamd.port, 5000).scan(Readable.from([Buffer.alloc(200 * 1024)]))).rejects.toBeInstanceOf(scan.ScanUnavailableError);
    await clamd.close();
    await expect(scan.clamdScanner('127.0.0.1', clamd.port, 5000).scan(Readable.from([Buffer.from('x')]))).rejects.toBeInstanceOf(scan.ScanUnavailableError);
  });
});

describe('uploads with a scanner set', () => {
  it('stores clean files as CLEAN', async () => {
    const clamd = await fakeClamd();
    scan.setVirusScanner(scan.clamdScanner('127.0.0.1', clamd.port, 5000));
    const res = await upload(await as('s1'), Buffer.from('my notes'));
    expect(res.status).toBe(201);
    expect(res.body.data.scanStatus).toBe('CLEAN');
    const row = await admin.storedFile.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.scanStatus).toBe('CLEAN');
    expect(row.scannedAt).not.toBeNull();
    await clamd.close();
  });

  it('refuses infected files, stores nothing, and audits the attempt', async () => {
    const clamd = await fakeClamd();
    scan.setVirusScanner(scan.clamdScanner('127.0.0.1', clamd.port, 5000));
    const before = await admin.storedFile.count();
    const res = await upload(await as('s1'), EICAR, 'eicar.txt');
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/malware/);
    expect(await admin.storedFile.count()).toBe(before);
    const audit = await admin.auditLog.findFirstOrThrow({ where: { action: 'FILE_MALWARE_BLOCKED' } });
    expect(audit).toMatchObject({ userId: 's1', resourceType: 'FILE' });
    expect(JSON.stringify(audit.diffJson)).toContain('Eicar-Test-Signature');
    await clamd.close();
  });

  it('refuses uploads while the scanner cannot answer', async () => {
    const clamd = await fakeClamd();
    await clamd.close();
    scan.setVirusScanner(scan.clamdScanner('127.0.0.1', clamd.port, 5000));
    const before = await admin.storedFile.count();
    const res = await upload(await as('s1'), Buffer.from('my notes'));
    expect(res.status).toBe(503);
    expect(await admin.storedFile.count()).toBe(before);
  });
});

describe('files stored before scanning was set up', () => {
  it('are NOT_SCANNED, then the sweep checks them and withdraws infected ones', async () => {
    const s1 = await as('s1');
    const plain = (await upload(s1, Buffer.from('old notes'))).body.data;
    const bad = (await upload(s1, EICAR, 'old.txt')).body.data;
    expect(plain.scanStatus).toBe('NOT_SCANNED');
    expect(bad.scanStatus).toBe('NOT_SCANNED');
    expect((await s1.get(bad.url)).status).toBe(200);

    const clamd = await fakeClamd();
    scan.setVirusScanner(scan.clamdScanner('127.0.0.1', clamd.port, 5000));
    expect(await scan.scanPendingFiles()).toEqual({ clean: 1, infected: 1, stopped: false });
    expect((await admin.storedFile.findUniqueOrThrow({ where: { id: plain.id } })).scanStatus).toBe('CLEAN');
    expect((await admin.storedFile.findUniqueOrThrow({ where: { id: bad.id } })).scanStatus).toBe('INFECTED');
    expect(await admin.auditLog.count({ where: { action: 'FILE_MALWARE_FOUND', resourceId: bad.id } })).toBe(1);

    const withdrawn = await s1.get(bad.url);
    expect(withdrawn.status).toBe(410);
    expect((await (await as('teacher')).get(bad.url)).status).toBe(410);
    expect((await s1.get(plain.url)).status).toBe(200);
    // Nothing is left to scan.
    expect(await scan.scanPendingFiles()).toEqual({ clean: 0, infected: 0, stopped: false });
    await clamd.close();
  });

  it('pauses when the scanner is down and leaves the files for the next sweep', async () => {
    const left = (await upload(await as('s1'), Buffer.from('later'))).body.data;
    const clamd = await fakeClamd();
    await clamd.close();
    scan.setVirusScanner(scan.clamdScanner('127.0.0.1', clamd.port, 5000));
    expect(await scan.scanPendingFiles()).toEqual({ clean: 0, infected: 0, stopped: true });
    expect((await admin.storedFile.findUniqueOrThrow({ where: { id: left.id } })).scanStatus).toBe('NOT_SCANNED');
  });
});
