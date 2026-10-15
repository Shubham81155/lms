/**
 * Lists the operations whose success response is not described yet, grouped by route file.
 *   npx ts-node src/openapi/missing.ts            (all)
 *   npx ts-node src/openapi/missing.ts forum      (only route files whose name contains "forum")
 */
import './build-env';
import fs from 'fs';
import path from 'path';
import { apiMounts, rawBodyMounts } from '../mounts';
import { inventory } from './inventory';
import { DOCS } from './docs';
import { RESPONSE_DOCS } from './responses';

const filter = process.argv[2] ?? '';
const routesDir = path.resolve(__dirname, '../routes');
const byRouter = new Map<unknown, string>();
for (const f of fs.readdirSync(routesDir).filter((n) => n.endsWith('.routes.ts'))) {
  byRouter.set(require(path.join(routesDir, f)).default, f);
}

let total = 0;
for (const mount of [...rawBodyMounts, ...apiMounts]) {
  const file = byRouter.get(mount.router) ?? '?';
  if (filter && !file.includes(filter)) continue;
  for (const op of inventory([mount])) {
    const key = `${op.method.toUpperCase()} ${op.path}`;
    if (DOCS[key]?.response || RESPONSE_DOCS[key]?.response) continue;
    total++;
    console.log(`${file.padEnd(26)} ${key}`);
  }
}
console.log(`-- ${total} operation(s) without a described response`);
process.exit(0);
