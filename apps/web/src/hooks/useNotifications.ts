"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/lib/api";

export interface ServerNotification {
  id: string;
  category: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  type: "ACADEMIC" | "EXAM" | "SECURITY" | "ANNOUNCEMENT";
  isRead: boolean;
  actionUrl?: string;
  actionLabel?: string;
}

const TYPE_BY_CATEGORY: Record<string, NotificationItem["type"]> = {
  GRADE: "ACADEMIC",
  COURSE: "ACADEMIC",
  FORUM: "ACADEMIC",
  EXAM: "EXAM",
  SYSTEM: "SECURITY",
  LIVE: "ANNOUNCEMENT",
};

export function timeAgo(iso: string, now: number = Date.now()): string {
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

export function toItem(n: ServerNotification): NotificationItem {
  return {
    id: n.id,
    title: n.title,
    message: n.body ?? "",
    timestamp: timeAgo(n.createdAt),
    type: TYPE_BY_CATEGORY[n.category] ?? "ANNOUNCEMENT",
    isRead: n.readAt !== null,
    actionUrl: n.link ?? undefined,
    actionLabel: n.link ? "Open" : undefined,
  };
}

const POLL_MS = 60_000;

/**
 * Loads the signed-in user's notifications and keeps the unread count fresh. Marking as read is
 * optimistic and rolls back if the server rejects it.
 */
export function useNotifications() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<{ data: ServerNotification[]; unreadCount: number }>("/api/v1/notifications", {
        params: { limit: 50 },
      });
      if (!alive.current) return;
      setItems(res.data.map(toItem));
      setUnreadCount(res.unreadCount);
      setError(null);
    } catch (e: any) {
      if (alive.current) setError(e?.message ?? "Could not load notifications");
    } finally {
      if (alive.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [refresh]);

  const markRead = useCallback(
    async (id: string) => {
      const target = items.find((n) => n.id === id);
      if (!target || target.isRead) return;
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
      setUnreadCount((c) => Math.max(0, c - 1));
      try {
        await api.post(`/api/v1/notifications/${id}/read`);
      } catch {
        refresh();
      }
    },
    [items, refresh]
  );

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
    try {
      await api.post("/api/v1/notifications/read-all");
    } catch {
      refresh();
    }
  }, [refresh]);

  return { items, unreadCount, isLoading, error, refresh, markRead, markAllRead };
}
