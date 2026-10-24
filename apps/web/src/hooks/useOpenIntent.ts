'use client';

import { useEffect, useRef } from 'react';
import { isOpenIntent, type OpenIntent } from '@/lib/deeplink';

/**
 * Opens the panel named by `?open=` once the page is ready (see lib/deeplink), then removes the query
 * so a refresh does not reopen it. `handlers` receives the optional `course` id from the link.
 */
export function useOpenIntent(ready: boolean, handlers: Partial<Record<OpenIntent, (courseId: string | null) => void>>) {
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    const params = new URLSearchParams(window.location.search);
    const open = params.get('open');
    if (!isOpenIntent(open)) return;
    handlers[open]?.(params.get('course'));
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
  });
}
