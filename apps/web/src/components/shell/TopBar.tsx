'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, ChevronRight, Menu, PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react';
import clsx from 'clsx';
import { BrandLogo } from '@/components/BrandLogo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { NotificationCenter } from '@/components/NotificationCenter';
import { useNotifications } from '@/hooks/useNotifications';
import { useAuth } from '@/context/AuthContext';
import { resolveDeepLink } from '@/lib/deeplink';
import { AREA_LABEL, type Area } from '@/lib/navigation';
import { LanguageSwitcher, useT } from '@/lib/i18n';

export interface TopBarSearch {
  placeholder: string;
  /** Called with the trimmed text; an empty string means "show everything". */
  onSubmit: (query: string) => void;
}

interface TopBarProps {
  area: Area;
  /** Without this the search box is not shown, so there is never an input that does nothing. */
  search?: TopBarSearch;
  /** Label of the current place, shown as the breadcrumb. */
  currentLabel: string;
  drawerOpen: boolean;
  onOpenMenu: () => void;
  /** Desktop only: whether the sidebar rail is shrunk to icons, and how to switch it. */
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

/** What stays across the top once navigation lives in the sidebar: where you are, search, alerts, theme. */
export const TopBar: React.FC<TopBarProps> = ({
  area,
  search,
  currentLabel,
  drawerOpen,
  onOpenMenu,
  sidebarCollapsed,
  onToggleSidebar,
}) => {
  const [showNotifications, setShowNotifications] = useState(false);
  const [query, setQuery] = useState('');
  const notifications = useNotifications();
  const { user } = useAuth();
  const router = useRouter();
  const t = useT();

  const handleNotificationAction = (url: string) => {
    if (!url) return;

    // External links
    if (/^https?:\/\//i.test(url)) {
      window.location.href = url;
      return;
    }

    // Resolve internal deeplinks (/courses/..., /quizzes/..., /assignments/...)
    let target = url;
    if (user && (target.startsWith('/courses') || target.startsWith('/quizzes') || target.startsWith('/assignments'))) {
      target = resolveDeepLink(target, user.role);
    }

    const [targetPath, targetHash] = target.split('#');
    const currentPath = typeof window !== 'undefined' ? window.location.pathname : '';

    if (targetHash && (!targetPath || targetPath === currentPath)) {
      if (window.location.hash !== `#${targetHash}`) {
        window.location.hash = targetHash;
      }
      // Explicitly fire hashchange event so SPA dashboard listeners switch tabs
      window.dispatchEvent(new HashChangeEvent('hashchange'));

      setTimeout(() => {
        const el =
          document.getElementById(targetHash) ||
          document.getElementById(`admin-${targetHash}`) ||
          document.getElementById('review-h') ||
          document.getElementById('admin-courses');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 50);
      return;
    }

    if (target.includes('#')) {
      // Cross-page navigation with a hash
      window.location.href = target;
    } else {
      router.push(target);
    }
  };

  return (
    <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-3 border-b border-line bg-canvas/85 px-4 backdrop-blur-md sm:px-6">
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label={t('shell.openNavigation')}
        aria-expanded={drawerOpen}
        aria-controls="app-drawer"
        className="rounded-xl border border-line bg-surface p-2 text-ink-muted outline-none transition-colors hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-brand lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>
      <div className="lg:hidden">
        <BrandLogo href={`/${area}`} compact />
      </div>
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label={sidebarCollapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')}
        title={sidebarCollapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')}
        aria-expanded={!sidebarCollapsed}
        aria-controls="app-sidebar"
        className="hidden rounded-xl border border-line bg-surface p-2 text-ink-muted outline-none transition-colors hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-brand lg:inline-flex"
      >
        {sidebarCollapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
      </button>

      <nav aria-label={t('shell.breadcrumb')} className="hidden items-center gap-1.5 text-sm lg:flex">
        <span className="text-ink-muted">{t.dyn(`nav.area.${area}`, AREA_LABEL[area])}</span>
        <ChevronRight className="h-4 w-4 text-ink-subtle" aria-hidden="true" />
        <span aria-current="page" className="font-semibold text-ink">
          {currentLabel}
        </span>
      </nav>

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        {search && (
          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              search.onSubmit(query.trim());
            }}
            className="hidden items-center gap-2 rounded-xl border border-line bg-surface px-3 py-1.5 text-xs text-ink-muted transition-colors focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20 md:flex"
          >
            <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <input
              type="search"
              aria-label={search.placeholder}
              placeholder={search.placeholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={100}
              className="w-32 border-none bg-transparent text-xs text-ink transition-all placeholder:text-ink-subtle focus:w-52 focus:outline-none lg:w-40"
            />
          </form>
        )}

        <div className="relative">
          <button
            type="button"
            onClick={() => setShowNotifications(!showNotifications)}
            aria-label={
              notifications.unreadCount > 0
                ? t('shell.notificationsUnread', { count: notifications.unreadCount })
                : t('shell.notifications')
            }
            aria-expanded={showNotifications}
            className={clsx(
              'relative rounded-xl border p-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand',
              showNotifications
                ? 'border-brand bg-brand text-on-brand shadow-md shadow-brand/20'
                : 'border-line bg-surface text-ink-muted hover:bg-raised hover:text-ink'
            )}
          >
            <Bell className="h-4 w-4" />
            {notifications.unreadCount > 0 && (
              <span
                aria-hidden="true"
                className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-hover px-1 text-[9px] font-bold text-on-brand ring-2 ring-canvas"
              >
                {notifications.unreadCount > 9 ? '9+' : notifications.unreadCount}
              </span>
            )}
          </button>

          <NotificationCenter
            isOpen={showNotifications}
            onClose={() => setShowNotifications(false)}
            items={notifications.items}
            isLoading={notifications.isLoading}
            error={notifications.error}
            onMarkRead={notifications.markRead}
            onMarkAllRead={notifications.markAllRead}
            onDismiss={notifications.dismiss}
            onActionClick={handleNotificationAction}
          />
        </div>

        <LanguageSwitcher />
        <ThemeToggle />
      </div>
    </header>
  );
};
