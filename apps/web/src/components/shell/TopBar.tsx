"use client";

import React, { useState } from "react";
import { Bell, ChevronRight, Menu, Search } from "lucide-react";
import clsx from "clsx";
import { BrandLogo } from "@/components/BrandLogo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NotificationCenter } from "@/components/NotificationCenter";
import { useNotifications } from "@/hooks/useNotifications";
import { AREA_LABEL, type Area } from "@/lib/navigation";

interface TopBarProps {
  area: Area;
  /** Label of the current place, shown as the breadcrumb. */
  currentLabel: string;
  drawerOpen: boolean;
  onOpenMenu: () => void;
}

/** What stays across the top once navigation lives in the sidebar: where you are, search, alerts, theme. */
export const TopBar: React.FC<TopBarProps> = ({ area, currentLabel, drawerOpen, onOpenMenu }) => {
  const [showNotifications, setShowNotifications] = useState(false);
  const notifications = useNotifications();

  return (
    <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-3 border-b border-line bg-canvas/85 px-4 backdrop-blur-md sm:px-6">
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Open navigation"
        aria-expanded={drawerOpen}
        aria-controls="app-drawer"
        className="rounded-xl border border-line bg-surface p-2 text-ink-muted outline-none transition-colors hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-brand lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>
      <div className="lg:hidden">
        <BrandLogo href={`/${area}`} compact />
      </div>

      <nav aria-label="Breadcrumb" className="hidden items-center gap-1.5 text-sm lg:flex">
        <span className="text-ink-muted">{AREA_LABEL[area]}</span>
        <ChevronRight className="h-4 w-4 text-ink-subtle" aria-hidden="true" />
        <span aria-current="page" className="font-semibold text-ink">
          {currentLabel}
        </span>
      </nav>

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        <div className="hidden items-center gap-2 rounded-xl border border-line bg-surface px-3 py-1.5 text-xs text-ink-muted xl:flex">
          <Search className="h-3.5 w-3.5" />
          <input
            type="text"
            aria-label="Search"
            placeholder="Search catalog, records..."
            className="w-36 border-none bg-transparent text-xs text-ink transition-all focus:w-48 focus:outline-none"
          />
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setShowNotifications(!showNotifications)}
            aria-label={notifications.unreadCount > 0 ? `Notifications, ${notifications.unreadCount} unread` : "Notifications"}
            aria-expanded={showNotifications}
            className={clsx(
              "relative rounded-xl border p-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand",
              showNotifications ? "border-brand bg-brand text-on-brand shadow-md shadow-brand/20" : "border-line bg-surface text-ink-muted hover:bg-raised hover:text-ink",
            )}
          >
            <Bell className="h-4 w-4" />
            {notifications.unreadCount > 0 && (
              <span aria-hidden="true" className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-hover px-1 text-[9px] font-bold text-on-brand ring-2 ring-canvas">
                {notifications.unreadCount > 9 ? "9+" : notifications.unreadCount}
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
          />
        </div>

        <ThemeToggle />
      </div>
    </header>
  );
};
