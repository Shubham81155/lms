import type { z } from 'zod';

/** One documented answer of an endpoint. */
export interface ResponseDoc {
  status: number;
  /** JSON body (or the body of `contentType`). Omit for answers without a body, such as 204 or a redirect. */
  schema?: z.ZodTypeAny;
  description?: string;
  /** Defaults to application/json. Use e.g. text/calendar or application/samlmetadata+xml for other bodies. */
  contentType?: string;
}

export interface ResponseEntry {
  /** The main success answer. */
  response?: ResponseDoc;
  /** Other successful answers (e.g. 200 when resuming, 201 when creating). */
  otherResponses?: ResponseDoc[];
  /** Error statuses this endpoint answers with beyond 401 (session routes) and 403 (role-guarded routes). */
  errors?: number[];
}

/** Keyed `METHOD /express/style/path`, exactly as in docs.ts. */
export type ResponseTable = Record<string, ResponseEntry>;
