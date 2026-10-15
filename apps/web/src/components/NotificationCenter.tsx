"use client";

import React, { useState } from "react";
import type { NotificationItem } from "@/hooks/useNotifications";
import { NotificationSettings } from "@/components/NotificationSettings";

export type { NotificationItem };
import {
  Bell,
  Check,
  CheckCheck,
  Clock,
  Award,
  Video,
  FileCheck,
  AlertTriangle,
  Sparkles,
  X,
  ExternalLink,
  Settings,
} from "lucide-react";

interface NotificationCenterProps {
  isOpen: boolean;
  onClose: () => void;
  onActionClick?: (actionUrl: string) => void;
  items: NotificationItem[];
  isLoading?: boolean;
  error?: string | null;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  isOpen,
  onClose,
  onActionClick,
  items: notifications,
  isLoading = false,
  error = null,
  onMarkRead,
  onMarkAllRead,
}) => {
  const [filter, setFilter] = useState<"ALL" | "UNREAD" | "ACADEMIC" | "SECURITY">("ALL");
  const [showSettings, setShowSettings] = useState(false);

  if (!isOpen) return null;

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const filteredNotifications = notifications.filter((n) => {
    if (filter === "UNREAD") return !n.isRead;
    if (filter === "ACADEMIC") return n.type === "ACADEMIC" || n.type === "EXAM";
    if (filter === "SECURITY") return n.type === "SECURITY";
    return true;
  });

  const markAllAsRead = onMarkAllRead;
  const markSingleAsRead = onMarkRead;

  return (
    <div className="absolute right-0 top-12 z-50 w-96 max-w-[calc(100vw-2rem)] bg-surface border border-line rounded-3xl shadow-2xl overflow-hidden animate-fadeIn">
      {/* Header */}
      <div className="bg-canvas border-b border-line p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-xl bg-brand/20 text-brand-fg flex items-center justify-center border border-brand/30">
            <Bell className="h-4 w-4" />
          </div>
          <div>
            <h4 className="font-bold text-xs text-ink">Notification Center</h4>
            <p className="text-[10px] text-ink-muted">
              {unreadCount > 0 ? `${unreadCount} unread alerts` : "All caught up"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              onClick={markAllAsRead}
              className="text-[10px] font-semibold text-brand-fg hover:text-brand-fg flex items-center gap-1"
            >
              <CheckCheck className="h-3 w-3" />
              <span>Mark all read</span>
            </button>
          )}
          <button
            onClick={() => setShowSettings((v) => !v)}
            aria-label="Notification settings"
            aria-pressed={showSettings}
            className={`p-1 rounded-lg transition-colors ${showSettings ? "text-brand-fg bg-raised" : "text-ink-muted hover:text-ink hover:bg-raised"}`}
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onClose}
            aria-label="Close notifications"
            className="p-1 rounded-lg text-ink-muted hover:text-ink hover:bg-raised transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {showSettings ? (
        <NotificationSettings onDone={() => setShowSettings(false)} />
      ) : (
        <>
      {/* Filter Tabs */}
      <div className="bg-canvas/60 border-b border-line px-3 py-2 flex items-center gap-1 overflow-x-auto text-[11px]">
        {[
          { id: "ALL", label: "All" },
          { id: "UNREAD", label: `Unread (${unreadCount})` },
          { id: "ACADEMIC", label: "Academic" },
          { id: "SECURITY", label: "Security" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id as any)}
            className={`px-2.5 py-1 rounded-lg font-semibold whitespace-nowrap transition-colors ${
              filter === tab.id
                ? "bg-brand text-on-brand shadow-sm"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Notifications List */}
      <div className="max-h-96 overflow-y-auto divide-y divide-line/80">
        {isLoading && notifications.length === 0 ? (
          <div className="p-8 text-center text-ink-subtle text-xs">Loading notifications...</div>
        ) : error && notifications.length === 0 ? (
          <div className="p-8 text-center text-danger text-xs">{error}</div>
        ) : filteredNotifications.length === 0 ? (
          <div className="p-8 text-center text-ink-subtle text-xs">
            No notifications in this category.
          </div>
        ) : (
          filteredNotifications.map((notif) => (
            <div
              key={notif.id}
              onClick={() => markSingleAsRead(notif.id)}
              className={`p-3.5 text-xs transition-colors hover:bg-raised/40 cursor-pointer ${
                !notif.isRead ? "bg-brand/15" : "bg-transparent"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  {!notif.isRead && (
                    <span className="h-1.5 w-1.5 rounded-full bg-brand-hover shrink-0" />
                  )}
                  <strong className={`font-semibold text-ink ${!notif.isRead ? "text-ink" : ""}`}>
                    {notif.title}
                  </strong>
                </div>
                <span className="text-[10px] text-ink-subtle shrink-0">{notif.timestamp}</span>
              </div>

              <p className="text-[11px] text-ink-muted mt-1 leading-relaxed">
                {notif.message}
              </p>

              {notif.actionLabel && (
                <div className="mt-2.5 flex items-center justify-between">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      markSingleAsRead(notif.id);
                      if (onActionClick && notif.actionUrl) onActionClick(notif.actionUrl);
                      onClose();
                    }}
                    className="text-[10px] font-bold text-brand-fg hover:text-brand-fg flex items-center gap-1 bg-brand/15 px-2 py-1 rounded-md border border-brand/30 transition-colors"
                  >
                    <span>{notif.actionLabel}</span>
                    <ExternalLink className="h-2.5 w-2.5" />
                  </button>
                  <span className="text-[9px] uppercase font-bold text-ink-subtle tracking-wider">
                    {notif.type}
                  </span>
                </div>
              )}
            </div>
          ))
        )}
      </div>
        </>
      )}
    </div>
  );
};
