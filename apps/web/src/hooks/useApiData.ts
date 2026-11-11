'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { api, ApiError } from '@/lib/api';

export const errorMessage = (e: unknown, fallback = 'Something went wrong. Please try again.') => {
  if (e instanceof ApiError || e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message || fallback;
  }
  return fallback;
};

interface CacheEntry {
  data: unknown;
  storedAt: number;
}

const CACHE_FRESH_MS = 5_000;
const CACHE_TTL_MS = 30_000;
const MAX_CACHE_ENTRIES = 200;

const responseCache = new Map<string, CacheEntry>();
const inflightRequests = new Map<string, Promise<unknown>>();

function buildCacheKey(path: string, params?: Record<string, string | number | undefined>): string {
  if (!params) return path;
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return path;
  return `${path}?${entries.map(([k, v]) => `${k}=${String(v)}`).join('&')}`;
}

function setCacheEntry(key: string, data: unknown): void {
  if (responseCache.has(key)) responseCache.delete(key);
  responseCache.set(key, { data, storedAt: Date.now() });
  if (responseCache.size > MAX_CACHE_ENTRIES) {
    const oldest = responseCache.keys().next().value;
    if (oldest !== undefined) responseCache.delete(oldest);
  }
}

/**
 * Clears cached GET responses. With `prefix`, removes entries whose path matches or starts with
 * the prefix; without arguments, clears the entire response cache.
 */
export function invalidateApiCache(prefix?: string): void {
  if (!prefix) {
    responseCache.clear();
    return;
  }
  for (const key of responseCache.keys()) {
    if (key === prefix || key.startsWith(`${prefix}?`) || key.startsWith(`${prefix}/`) || key.startsWith(prefix)) {
      responseCache.delete(key);
    }
  }
}

function fetchWithDedup<T>(key: string, path: string, params: Record<string, string | number | undefined>, force: boolean): Promise<T> {
  if (!force) {
    const existing = inflightRequests.get(key);
    if (existing) return existing as Promise<T>;
  }
  const promise = api
    .get<T>(path, { params })
    .then((res) => {
      setCacheEntry(key, res);
      return res;
    })
    .finally(() => {
      if (inflightRequests.get(key) === promise) {
        inflightRequests.delete(key);
      }
    });
  inflightRequests.set(key, promise);
  return promise;
}

/**
 * Loads one GET endpoint with lightweight SWR caching and in-flight deduplication, and exposes
 * `reload`. `path = null` skips the request (for data that depends on a selection not made yet).
 */
export function useApiData<T>(path: string | null, params?: Record<string, string | number | undefined>) {
  const paramsJson = JSON.stringify(params ?? {});
  const cacheKey = path === null ? null : buildCacheKey(path, JSON.parse(paramsJson) as Record<string, string | number | undefined>);

  const [data, setData] = useState<T | null>(() => {
    if (!cacheKey) return null;
    const cached = responseCache.get(cacheKey);
    if (cached && Date.now() - cached.storedAt <= CACHE_TTL_MS) return cached.data as T;
    return null;
  });
  const [isLoading, setIsLoading] = useState<boolean>(() => {
    if (!cacheKey) return false;
    const cached = responseCache.get(cacheKey);
    return !(cached && Date.now() - cached.storedAt <= CACHE_TTL_MS);
  });
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const activeKeyRef = useRef<string | null>(cacheKey);
  activeKeyRef.current = cacheKey;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(
    async (force: boolean) => {
      if (path === null || cacheKey === null) {
        setData(null);
        setIsLoading(false);
        setError(null);
        return;
      }

      const parsedParams = JSON.parse(paramsJson) as Record<string, string | number | undefined>;
      const cached = !force ? responseCache.get(cacheKey) : undefined;
      const age = cached ? Date.now() - cached.storedAt : Infinity;

      if (cached && age <= CACHE_TTL_MS) {
        setData(cached.data as T);
        setError(null);
        setIsLoading(false);
        if (age <= CACHE_FRESH_MS) return;
      } else {
        setIsLoading(true);
      }

      try {
        if (force) {
          responseCache.delete(cacheKey);
        }
        const res = await fetchWithDedup<T>(cacheKey, path, parsedParams, force);
        if (!alive.current || activeKeyRef.current !== cacheKey) return;
        setData(res);
        setError(null);
      } catch (e) {
        if (alive.current && activeKeyRef.current === cacheKey) {
          setData(null);
          setError(errorMessage(e, 'Could not load this section.'));
        }
      } finally {
        if (alive.current && activeKeyRef.current === cacheKey) setIsLoading(false);
      }
    },
    [path, cacheKey, paramsJson]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const reload = useCallback(() => load(true), [load]);

  return { data, isLoading, error, reload };
}

/** Wraps a mutation with busy/error state so panels do not each re-implement it. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async <R>(fn: () => Promise<R>): Promise<R | undefined> => {
    setBusy(true);
    setError(null);
    try {
      const result = await fn();
      invalidateApiCache();
      return result;
    } catch (e) {
      setError(errorMessage(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { busy, error, run, clearError };
}

/** Saves a Blob from an authenticated endpoint (needs the session cookie, so not a plain link). */
export async function downloadFile(path: string, filename: string) {
  const res = await fetch(path, { credentials: 'include' });
  if (!res.ok) throw new Error('Download failed');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
