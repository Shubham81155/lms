'use client';

import React, { useState, useEffect } from 'react';
import clsx from 'clsx';
import { LogOut, User, UserCog, X } from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { initialsOf, roleTitle, type Area, type NavItem, type NavSection } from '@/lib/navigation';
import { useT } from '@/lib/i18n';

// Same hue per area as the role pill used elsewhere: brand for students, orchid for faculty, accent for admins.
const AVATAR: Record<Area, string> = {
  student: 'bg-brand/15 text-brand-fg border-brand/40',
  teacher: 'bg-orchid/15 text-orchid border-orchid/40',
  admin: 'bg-accent/15 text-accent border-accent/40',
  audit: 'bg-success/15 text-success border-success/40',
  platform: 'bg-orchid/15 text-orchid border-orchid/40',
};

interface SidebarProps {
  area: Area;
  sections: NavSection[];
  activeKey?: string;
  /** The desktop rail can shrink to icons; the drawer is always full width. */
  variant: 'rail' | 'drawer';
  collapsed?: boolean;
  onSelect: (item: NavItem) => void;
  onClose?: () => void;
  user: { name?: string; role?: string; avatarUrl?: string | null } | null;
  onOpenProfile?: () => void;
  onOpenPrivacy: () => void;
  onSignOut: () => void;
}

const rowBase =
  'group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand';

export const Sidebar: React.FC<SidebarProps> = ({
  area,
  sections,
  activeKey,
  variant,
  collapsed = false,
  onSelect,
  onClose,
  user,
  onOpenProfile,
  onOpenPrivacy,
  onSignOut,
}) => {
  const compact = variant === 'rail' && collapsed;
  const t = useT();
  const [avatarImgError, setAvatarImgError] = useState(false);

  useEffect(() => {
    setAvatarImgError(false);
  }, [user?.avatarUrl]);

  const labelOf = (item: NavItem) => t.dyn(`nav.item.${area}.${item.key}`, item.label);

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    const active = item.kind === 'tab' && item.key === activeKey;
    const className = clsx(
      rowBase,
      compact && 'justify-center px-0',
      active ? 'bg-brand/15 text-brand-fg' : 'text-ink-muted hover:bg-raised hover:text-ink'
    );
    const inner = (
      <>
        {active && <span aria-hidden="true" className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-brand" />}
        <Icon className={clsx('h-[18px] w-[18px] shrink-0', active ? 'text-brand-fg' : 'text-ink-subtle group-hover:text-ink')} />
        <span className={compact ? 'sr-only' : 'truncate'}>{labelOf(item)}</span>
      </>
    );

    if (item.kind === 'tab') {
      return (
        <a
          href={item.href}
          aria-current={active ? 'page' : undefined}
          title={compact ? labelOf(item) : undefined}
          className={className}
          onClick={(e) => {
            // Keep new-tab / copy-link behaviour; handle a plain click in the page without a reload.
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            onSelect(item);
          }}
        >
          {inner}
        </a>
      );
    }
    return (
      <button type="button" title={compact ? labelOf(item) : undefined} className={className} onClick={() => onSelect(item)}>
        {inner}
      </button>
    );
  };

  const footerRow = 'text-ink-muted hover:bg-raised hover:text-ink';

  return (
    <div className="flex h-full flex-col">
      <div
        className={clsx('flex h-16 shrink-0 items-center border-b border-line px-4', compact ? 'justify-center px-0' : 'justify-between')}
      >
        <BrandLogo href={`/${area}`} compact={compact} />
        {variant === 'drawer' && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t('shell.closeNavigation')}
            className="rounded-xl p-2 text-ink-muted outline-none hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-brand"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <nav aria-label={t('shell.mainNavigation')} className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
        {sections.map((section) => (
          <div key={section.id}>
            <p className={clsx('mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle', compact && 'sr-only')}>
              {t.dyn(`nav.section.${area}.${section.id}`, section.title)}
            </p>
            <ul className="space-y-1">
              {section.items.map((item) => (
                <li key={item.key}>{renderItem(item)}</li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 space-y-1 border-t border-line p-3">
        <button
          type="button"
          onClick={onOpenProfile}
          className={clsx(
            'group mb-1 flex w-full items-center gap-3 rounded-xl p-1.5 text-left transition-colors hover:bg-raised focus-visible:ring-2 focus-visible:ring-brand outline-none',
            compact && 'justify-center p-0'
          )}
          title={compact ? (user?.name ?? t('shell.profileSettings')) : t('shell.profileSettings')}
        >
          <div
            aria-hidden="true"
            className={clsx(
              'relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border text-xs font-bold transition-transform group-hover:scale-105',
              AVATAR[area]
            )}
          >
            {user?.avatarUrl && !avatarImgError ? (
              /* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */
              <img
                src={user.avatarUrl}
                alt=""
                className="h-full w-full object-cover"
                onError={() => setAvatarImgError(true)}
              />
            ) : (
              <span>{initialsOf(user?.name)}</span>
            )}
          </div>
          {!compact && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-ink group-hover:text-brand-fg transition-colors">
                {user?.name ?? t('shell.userLoading')}
              </p>
              <p className="truncate text-[11px] text-ink-muted">
                {user ? t.dyn(`role.${user.role}`, roleTitle(user.role)) : ' '}
              </p>
            </div>
          )}
        </button>

        <button
          type="button"
          onClick={onOpenProfile}
          title={compact ? t('shell.profileSettings') : undefined}
          className={clsx(rowBase, footerRow, compact && 'justify-center px-0')}
        >
          <User className="h-[18px] w-[18px] shrink-0" />
          <span className={compact ? 'sr-only' : 'truncate'}>{t('shell.profileSettings')}</span>
        </button>

        <button
          type="button"
          onClick={onOpenPrivacy}
          title={compact ? t('shell.securityPrivacy') : undefined}
          className={clsx(rowBase, footerRow, compact && 'justify-center px-0')}
        >
          <UserCog className="h-[18px] w-[18px] shrink-0" />
          <span className={compact ? 'sr-only' : 'truncate'}>{t('shell.securityPrivacy')}</span>
        </button>
        <button
          type="button"
          onClick={onSignOut}
          title={compact ? t('common.signOut') : undefined}
          className={clsx(rowBase, 'text-ink-muted hover:bg-danger/10 hover:text-danger', compact && 'justify-center px-0')}
        >
          <LogOut className="h-[18px] w-[18px] shrink-0" />
          <span className={compact ? 'sr-only' : 'truncate'}>{t('common.signOut')}</span>
        </button>
      </div>
    </div>
  );
};
