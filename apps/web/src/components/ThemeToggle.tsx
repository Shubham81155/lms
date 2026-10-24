'use client';

import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { useT } from '@/lib/i18n';

export const ThemeToggle: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { theme, toggleTheme } = useTheme();
  const t = useT();

  return (
    <button
      onClick={toggleTheme}
      type="button"
      title={theme === 'dark' ? t('site.theme.toLight') : t('site.theme.toDark')}
      aria-label={t('site.theme.toggle')}
      className={`p-2 rounded-xl border border-line bg-surface hover:bg-raised shadow-sm transition-all flex items-center justify-center ${
        theme === 'dark' ? 'text-accent' : 'text-brand-fg'
      } ${className}`}
    >
      {theme === 'dark' ? (
        <Sun className="h-4 w-4 transition-transform hover:rotate-45" />
      ) : (
        <Moon className="h-4 w-4 transition-transform hover:-rotate-12" />
      )}
    </button>
  );
};
