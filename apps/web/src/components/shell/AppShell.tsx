"use client";

import React, { useRef, useState } from "react";
import clsx from "clsx";
import { useAuth } from "@/context/AuthContext";
import { PrivacySettings } from "@/components/PrivacySettings";
import { Sidebar } from "@/components/shell/Sidebar";
import { TopBar } from "@/components/shell/TopBar";
import { useDrawerBehavior, useSidebar } from "@/hooks/useSidebar";
import { currentTab, visibleSections, type Area, type NavItem } from "@/lib/navigation";

interface AppShellProps {
  area: Area;
  /** Key of the tab the page is showing. */
  activeKey?: string;
  /** Called for tab items (the page switches what it shows). */
  onNavigate?: (key: string) => void;
  /** Handlers for the panels this page can open. Items without a handler are not shown. */
  actions?: Record<string, () => void>;
  children: React.ReactNode;
}

/**
 * Frame for every signed-in page: a sidebar (rail on desktop, drawer on smaller screens), a slim top bar and
 * the page content. Pages keep their own state and tell the shell what to do through onNavigate / actions.
 */
export function AppShell({ area, activeKey, onNavigate, actions, children }: AppShellProps) {
  const { user, logout } = useAuth();
  const { collapsed, ready, toggleCollapsed, mobileOpen, openMobile, closeMobile } = useSidebar();
  const [showPrivacy, setShowPrivacy] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  useDrawerBehavior(mobileOpen, drawerRef, closeMobile);

  const sections = visibleSections(area, actions, user?.role);
  const current = currentTab(area, activeKey);

  const select = (item: NavItem) => {
    if (item.kind === "tab") onNavigate?.(item.key);
    else actions?.[item.key]?.();
    closeMobile();
  };
  const sidebarUser = user ? { name: user.name, role: user.role } : null;
  const openPrivacy = () => {
    closeMobile();
    setShowPrivacy(true);
  };

  return (
    <div className="min-h-screen bg-canvas text-ink lg:flex">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-xl focus:bg-brand focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-on-brand"
      >
        Skip to content
      </a>

      {/* Desktop rail */}
      <aside
        id="app-sidebar"
        className={clsx(
          "sticky top-0 z-30 hidden h-screen shrink-0 border-r border-line bg-surface lg:block",
          ready && "transition-[width] duration-200",
          collapsed ? "w-[76px]" : "w-64",
        )}
      >
        <Sidebar
          area={area}
          sections={sections}
          activeKey={activeKey}
          variant="rail"
          collapsed={collapsed}
          onSelect={select}
          onToggleCollapsed={toggleCollapsed}
          user={sidebarUser}
          onOpenPrivacy={openPrivacy}
          onSignOut={logout}
        />
      </aside>

      {/* Drawer below the desktop breakpoint; always mounted so it can slide, and inert (no focus, not announced) while closed */}
      <div className="lg:hidden">
        <div
          aria-hidden="true"
          onClick={closeMobile}
          className={clsx("fixed inset-0 z-50 bg-black/50 backdrop-blur-sm transition-opacity duration-200", mobileOpen ? "opacity-100" : "pointer-events-none opacity-0")}
        />
        <aside
          id="app-drawer"
          ref={drawerRef}
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
          tabIndex={-1}
          inert={!mobileOpen}
          className={clsx(
            "fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] border-r border-line bg-surface shadow-2xl outline-none transition-transform duration-200",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <Sidebar
            area={area}
            sections={sections}
            activeKey={activeKey}
            variant="drawer"
            onSelect={select}
            onClose={closeMobile}
            user={sidebarUser}
            onOpenPrivacy={openPrivacy}
            onSignOut={logout}
          />
        </aside>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar area={area} currentLabel={current.label} drawerOpen={mobileOpen} onOpenMenu={openMobile} />
        <div id="main-content" tabIndex={-1} className="flex flex-1 flex-col outline-none">
          {children}
        </div>
      </div>

      {showPrivacy && <PrivacySettings onClose={() => setShowPrivacy(false)} />}
    </div>
  );
}
