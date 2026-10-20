import type { ResponseTable } from './types';
import { RESPONSES as learning } from './learning';
import { RESPONSES as assessment } from './assessment';
import { RESPONSES as admin } from './admin';
import { RESPONSES as identity } from './identity';
import { RESPONSES as ai } from './ai';
import { RESPONSES as support } from './support';

/** Response descriptions, one file per area. Hand-written entries in ../docs.ts take precedence. */
export const RESPONSE_DOCS: ResponseTable = { ...learning, ...assessment, ...admin, ...identity, ...ai, ...support };
