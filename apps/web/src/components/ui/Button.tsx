import React from 'react';
import clsx from 'clsx';

export type ButtonVariant = 'primary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand font-bold transition-all',
  ghost: 'bg-surface hover:bg-raised border border-line text-ink font-semibold transition-colors disabled:opacity-50',
  danger: 'bg-danger hover:opacity-90 disabled:opacity-50 text-on-brand font-bold transition-all',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 rounded-lg text-[11px]',
  md: 'px-4 py-2 rounded-xl text-xs',
  lg: 'px-5 py-2.5 rounded-xl text-xs',
};

export function buttonClasses({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
} = {}) {
  return clsx(
    'inline-flex items-center justify-center gap-1.5',
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    fullWidth && 'w-full',
    className
  );
}

/** Shared button primitive using the semantic theme tokens. */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', fullWidth = false, className, children, ...props }, ref) => (
    <button ref={ref} className={buttonClasses({ variant, size, fullWidth, className })} {...props}>
      {children}
    </button>
  )
);

Button.displayName = 'Button';
