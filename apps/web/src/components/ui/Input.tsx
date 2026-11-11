import React from 'react';
import clsx from 'clsx';

export type InputSize = 'md' | 'lg';

const SIZE_CLASSES: Record<InputSize, string> = {
  md: 'px-3 py-2 text-xs',
  lg: 'px-3.5 py-2.5 text-xs focus:ring-2 focus:ring-brand/20 transition-colors',
};

export const inputBaseClass =
  'bg-canvas border border-line rounded-xl text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand disabled:opacity-60';

export function inputClasses({
  size = 'md',
  fullWidth = true,
  invalid = false,
  className,
}: {
  size?: InputSize;
  fullWidth?: boolean;
  invalid?: boolean;
  className?: string;
} = {}) {
  return clsx(inputBaseClass, SIZE_CLASSES[size], fullWidth && 'w-full', invalid && 'border-danger', className);
}

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: InputSize;
  fullWidth?: boolean;
  invalid?: boolean;
}

/** Shared text input primitive using the semantic theme tokens. */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ size = 'md', fullWidth = true, invalid = false, className, ...props }, ref) => (
    <input
      ref={ref}
      aria-invalid={props['aria-invalid'] ?? (invalid ? true : undefined)}
      className={inputClasses({ size, fullWidth, invalid, className })}
      {...props}
    />
  )
);

Input.displayName = 'Input';

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: InputSize;
  fullWidth?: boolean;
  invalid?: boolean;
}

/** Shared select primitive matching Input styling and semantic theme tokens. */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ size = 'md', fullWidth = true, invalid = false, className, children, ...props }, ref) => (
    <select
      ref={ref}
      aria-invalid={props['aria-invalid'] ?? (invalid ? true : undefined)}
      className={inputClasses({ size, fullWidth, invalid, className })}
      {...props}
    >
      {children}
    </select>
  )
);

Select.displayName = 'Select';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  size?: InputSize;
  fullWidth?: boolean;
  invalid?: boolean;
}

/** Shared textarea primitive matching Input styling and semantic theme tokens. */
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ size = 'md', fullWidth = true, invalid = false, className, ...props }, ref) => (
    <textarea
      ref={ref}
      aria-invalid={props['aria-invalid'] ?? (invalid ? true : undefined)}
      className={inputClasses({ size, fullWidth, invalid, className })}
      {...props}
    />
  )
);

Textarea.displayName = 'Textarea';
