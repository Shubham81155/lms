'use client';

import React from 'react';
import clsx from 'clsx';

export interface BannerProps {
  kind: 'error' | 'ok';
  children: React.ReactNode;
}

/** Inline status or error alert banner. */
export const Banner: React.FC<BannerProps> = ({ kind, children }) => (
  <div
    role={kind === 'error' ? 'alert' : 'status'}
    className={clsx(
      'p-3 rounded-xl text-xs border',
      kind === 'error' ? 'bg-danger/10 border-danger/30 text-danger' : 'bg-success/10 border-success/30 text-success'
    )}
  >
    {children}
  </div>
);
