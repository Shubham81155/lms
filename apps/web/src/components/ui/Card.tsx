import React from 'react';
import clsx from 'clsx';

export type CardVariant = 'canvas' | 'surface' | 'elevated';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

const VARIANT_CLASSES: Record<CardVariant, string> = {
  canvas: 'bg-canvas border border-line rounded-2xl',
  surface: 'bg-surface border border-line rounded-2xl',
  elevated: 'bg-surface border border-line rounded-3xl shadow-2xl shadow-black/20',
};

const PADDING_CLASSES: Record<CardPadding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6 sm:p-8',
};

export function cardClasses({
  variant = 'canvas',
  padding = 'md',
  className,
}: {
  variant?: CardVariant;
  padding?: CardPadding;
  className?: string;
} = {}) {
  return clsx(VARIANT_CLASSES[variant], PADDING_CLASSES[padding], className);
}

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  padding?: CardPadding;
}

/** Shared surface container using semantic canvas, surface, and line tokens. */
export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ variant = 'canvas', padding = 'md', className, children, ...props }, ref) => (
    <div ref={ref} className={cardClasses({ variant, padding, className })} {...props}>
      {children}
    </div>
  )
);

Card.displayName = 'Card';
