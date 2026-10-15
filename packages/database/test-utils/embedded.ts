import net from 'net';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { Client } from 'pg';
import EmbeddedPostgres from 'embedded-postgres';

export interface TestDatabase {
  /** Superuser connection (bypasses RLS) for arranging data. */
  adminUrl: string;
  /** Unprivileged lms_app connection, what the API uses in production. */
  appUrl: string;
  stop: () => Promise<void>;
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });

/**
 * Starts a throwaway PostgreSQL (own data dir, random port), creates the unprivileged lms_app
 * role and applies the real migrations. It never touches any database you have configured.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lms-pg-'));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'pw',
    port,
    persistent: false,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('lms_test');

  const adminUrl = `postgresql://postgres:pw@localhost:${port}/lms_test`;
  const appUrl = `postgresql://lms_app:app_pw@localhost:${port}/lms_test`;

  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  await client.query(
    `CREATE ROLE lms_app LOGIN PASSWORD 'app_pw' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`
  );
  await client.end();

  const migrate = spawnSync('node', ['scripts/prisma.js', 'migrate', 'deploy'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: adminUrl, DIRECT_URL: adminUrl },
    encoding: 'utf8',
  });
  if (migrate.status !== 0) {
    await pg.stop();
    throw new Error(`prisma migrate deploy failed:\n${migrate.stdout}\n${migrate.stderr}`);
  }

  return {
    adminUrl,
    appUrl,
    stop: async () => {
      // Windows can hold the data files for a moment after postgres exits (embedded-postgres
      // also removes its own data dir here); a leftover temp dir must not fail the run.
      try {
        await pg.stop();
      } catch {
        /* postgres has exited; only the cleanup raced */
      }
      try {
        fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
      } catch {
        /* best effort */
      }
    },
  };
}
