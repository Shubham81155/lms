import { Request } from 'express';
import { z } from 'zod';
import { HttpError } from './http';

/** Ids are opaque strings (seeded data uses readable ids), so only bound their shape. */
export const idSchema = z.string().min(1).max(64);

export const paginationShape = {
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
};

/** Query-string parameters arrive as strings or arrays; reject anything malformed with a 400. */
export function parseQuery<S extends z.ZodTypeAny>(req: Request, schema: S): z.infer<S> {
  const result = schema.safeParse(req.query);
  if (!result.success) throw new HttpError(400, 'Invalid query parameters', result.error.format());
  return result.data;
}

export function parseBody<S extends z.ZodTypeAny>(req: Request, schema: S): z.infer<S> {
  const result = schema.safeParse(req.body);
  if (!result.success) throw new HttpError(400, 'Validation failed', result.error.format());
  return result.data;
}

export function pageMeta(page: number, limit: number, total: number) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

/** http(s) only: blocks javascript:, data: and similar schemes in stored links. */
export const httpUrl = z
  .string()
  .url()
  .max(2048)
  .refine((u) => /^https?:\/\//i.test(u), 'Only http(s) URLs are allowed');
