'use client';

import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { iconBtn, smallBtn } from './types';

/** Delete with a confirmation step in place of a browser dialog. */
export const ConfirmDelete: React.FC<{ label: string; warning: string; busy: boolean; onConfirm: () => void }> = ({
  label,
  warning,
  busy,
  onConfirm,
}) => {
  const t = useT();
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button onClick={() => setAsking(true)} disabled={busy} aria-label={label} className={`${iconBtn} hover:text-danger`}>
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-[11px]">
      <span className="text-danger">{warning}</span>
      <button onClick={onConfirm} disabled={busy} className="rounded-lg bg-danger px-2 py-1 font-bold text-on-brand disabled:opacity-50">
        {t('builder.common.delete')}
      </button>
      <button onClick={() => setAsking(false)} className={smallBtn}>
        {t('builder.common.keep')}
      </button>
    </span>
  );
};
