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

type Method = 'post' | 'put' | 'patch';
type WritePaths<M extends Method> = { [P in keyof paths]: paths[P] extends { [K in M]: any } ? P : never }[keyof paths];
type BodyOf<P extends keyof paths, M extends Method> = paths[P] extends { [K in M]: { requestBody: { content: { 'application/json': infer B } } } } ? B : never;
type ResponseOf<P extends keyof paths, M extends Method> = paths[P] extends { [K in M]: { responses: infer R } }
  ? R extends { 200: infer OK } ? JsonBody<OK> : R extends { 201: infer Created } ? JsonBody<Created> : unknown
  : never;

export type PostBody<P extends WritePaths<'post'>> = BodyOf<P, 'post'>;
export type PutBody<P extends WritePaths<'put'>> = BodyOf<P, 'put'>;

/** Writes whose request body is described by the API: a misspelt or mistyped field fails to compile. */
export const typedPost = <P extends WritePaths<'post'>>(path: P, body: BodyOf<P, 'post'>) => api.post<ResponseOf<P, 'post'>>(path, body);
export const typedPut = <P extends WritePaths<'put'>>(path: P, body: BodyOf<P, 'put'>) => api.put<ResponseOf<P, 'put'>>(path, body);
export const typedPatch = <P extends WritePaths<'patch'>>(path: P, body: BodyOf<P, 'patch'>) => api.patch<ResponseOf<P, 'patch'>>(path, body);
