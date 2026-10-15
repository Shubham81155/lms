import { api } from './api';
import type { paths } from './api-schema';

/**
 * Typed GET calls checked against the API description (`api-schema.ts`, generated from
 * apps/api/openapi.json by `npm run api:sync`). A response shape or query parameter that changes on
 * the server becomes a compile error here instead of a runtime surprise.
 */
type JsonBody<R> = R extends { content: { 'application/json': infer B } } ? B : never;

type GetPaths = { [P in keyof paths]: paths[P] extends { get: any } ? P : never }[keyof paths];

export type GetResponse<P extends GetPaths> = paths[P] extends { get: { responses: { 200: infer OK } } } ? JsonBody<OK> : never;
export type GetQuery<P extends GetPaths> = paths[P] extends { get: { parameters: { query?: infer Q } } } ? NonNullable<Q> : never;

export const typedGet = <P extends GetPaths>(path: P, query?: GetQuery<P>) =>
  api.get<GetResponse<P>>(path, { params: query as Record<string, string | number | boolean | undefined | null> | undefined });
