/**
 * Writes apps/api/openapi.json. Run with `npm run openapi -w @enterprise-lms/api`.
 */
import './build-env';
import fs from 'fs';
import path from 'path';
import { buildOpenApi } from './spec';
import { stringifyOpenApi } from './serialize';

const out = path.resolve(__dirname, '../../openapi.json');
fs.writeFileSync(out, stringifyOpenApi(buildOpenApi()));
console.log(`wrote ${out}`);
process.exit(0);
