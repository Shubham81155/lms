// Runs the Prisma CLI with the monorepo's root .env loaded.
// DIRECT_URL (privileged role for migrations/seed) falls back to DATABASE_URL for local dev.
const path = require('path');
const { spawnSync } = require('child_process');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

process.env.DIRECT_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;

const result = spawnSync('npx', ['prisma', ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: path.resolve(__dirname, '..'),
  env: process.env,
  shell: process.platform === 'win32',
});
process.exit(result.status === null ? 1 : result.status);
