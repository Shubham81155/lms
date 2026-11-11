import React from 'react';
import clsx from 'clsx';

export type BadgeTone = 'neutral' | 'surface' | 'brand' | 'success' | 'warning' | 'danger';
export type BadgeSize = 'sm' | 'md';

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-raised text-ink border-line',
  surface: 'bg-surface text-ink border-line',
  brand: 'bg-brand/15 text-brand-fg border-brand/40',
  success: 'bg-success/10 text-success border-success/30',
  warning: 'bg-accent/10 text-accent border-accent/30',
  danger: 'bg-danger/10 text-danger border-danger/30',
};

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: 'px-2 py-0.5 text-[10px] font-bold',
  md: 'px-2.5 py-1 text-[11px] font-semibold',
};

export function badgeClasses({
  tone = 'neutral',
  size = 'sm',
  className,
}: {
  tone?: BadgeTone;
  size?: BadgeSize;
  className?: string;
} = {}) {
  return clsx('inline-flex items-center gap-1 rounded-full border', TONE_CLASSES[tone], SIZE_CLASSES[size], className);
}

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: BadgeSize;
}

/** Shared status and category pill badge using semantic colour tokens. */
export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ tone = 'neutral', size = 'sm', className, children, ...props }, ref) => (
    <span ref={ref} className={badgeClasses({ tone, size, className })} {...props}>
      {children}
    </span>
  )
);

Badge.displayName = 'Badge';
