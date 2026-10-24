'use client';

import { useEffect } from 'react';

/** Calls `onEscape` when Escape is pressed while the component is mounted (modals that are safe to dismiss). */
export function useEscapeKey(onEscape: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onEscape();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onEscape]);
}
