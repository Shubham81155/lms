import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

// Adds `.openapi()` to Zod schemas (only the API description uses it). Zod 4 gives each schema its methods when it is
// created, so this must run before any schema is defined: import this module first, ahead of the modules that build them.
extendZodWithOpenApi(z);
