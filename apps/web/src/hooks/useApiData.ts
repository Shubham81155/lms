'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { api, ApiError } from '@/lib/api';

export const errorMessage = (e: unknown, fallback = 'Something went wrong. Please try again.') =>
  e instanceof ApiError ? e.message : (e as any)?.message || fallback;

/**
 * Loads one GET endpoint and exposes `reload`. `path = null` skips the request (for data that
 * depends on a selection that has not been made yet).
 */
export function useApiData<T>(path: string | null, params?: Record<string, string | number | undefined>) {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(path !== null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const key = JSON.stringify(params ?? {});

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    if (path === null) {
      setData(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const res = await api.get<T>(path, { params: JSON.parse(key) });
      if (!alive.current) return;
      setData(res);
      setError(null);
    } catch (e) {
      if (alive.current) {
        setData(null);
        setError(errorMessage(e, 'Could not load this section.'));
      }
    } finally {
      if (alive.current) setIsLoading(false);
    }
  }, [path, key]);

  useEffect(() => {
    reload();
  }, [reload]);

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
      return await fn();
    } catch (e) {
      setError(errorMessage(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, error, run, clearError: () => setError(null) };
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
