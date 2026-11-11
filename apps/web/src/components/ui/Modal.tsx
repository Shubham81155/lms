'use client';

import React, { useCallback, useId } from 'react';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { useEscapeKey } from '@/hooks/useEscapeKey';

export type ModalSize = 'md' | 'lg' | 'xl' | '2xl' | '4xl';

const MODAL_SIZE_CLASSES: Record<ModalSize, string> = {
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '4xl': 'max-w-4xl',
};

export interface ModalProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  open?: boolean;
  onClose?: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  headerActions?: React.ReactNode;
  closeLabel?: string;
  ariaLabel?: string;
  size?: ModalSize;
  panelClassName?: string;
  children: React.ReactNode;
}

const ModalDialog = React.forwardRef<HTMLDivElement, Omit<ModalProps, 'open'>>(
  (
    {
      onClose,
      title,
      subtitle,
      headerActions,
      closeLabel = 'Close',
      ariaLabel,
      size = 'lg',
      panelClassName,
      className,
      children,
      ...props
    },
    ref
  ) => {
    const titleId = useId();
    const handleEscape = useCallback(() => {
      onClose?.();
    }, [onClose]);
    useEscapeKey(handleEscape);

    return (
      <div
        ref={ref}
        className={clsx('fixed inset-0 z-50 flex items-center justify-center bg-canvas/85 p-4 backdrop-blur-md', className)}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={!ariaLabel && title ? titleId : undefined}
        {...props}
      >
        <div
          className={clsx(
            'flex w-full flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl',
            MODAL_SIZE_CLASSES[size],
            panelClassName
          )}
        >
          {(title || headerActions || onClose) && (
            <div className="flex items-center justify-between gap-4 border-b border-line bg-canvas px-6 py-4">
              {title && (
                <div>
                  <h3 id={titleId} className="text-base font-bold text-ink">
                    {title}
                  </h3>
                  {subtitle && <p className="text-xs text-ink-muted">{subtitle}</p>}
                </div>
              )}
              {headerActions && <div className="flex shrink-0 gap-2">{headerActions}</div>}
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={closeLabel}
                  className="rounded-xl p-1 text-ink-muted transition-colors hover:bg-raised hover:text-ink"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              )}
            </div>
          )}
          {children}
        </div>
      </div>
    );
  }
);

ModalDialog.displayName = 'ModalDialog';

/** Accessible modal dialog container integrating with global focus trapping and Escape dismissal. */
export const Modal = React.forwardRef<HTMLDivElement, ModalProps>(({ open = true, ...props }, ref) => {
  if (!open) return null;
  return <ModalDialog ref={ref} {...props} />;
});

Modal.displayName = 'Modal';
