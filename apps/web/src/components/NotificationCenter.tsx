"use client";

import React, { useState } from "react";
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
} from "lucide-react";

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

interface NotificationCenterProps {
  isOpen: boolean;
  onClose: () => void;
  onActionClick?: (actionUrl: string) => void;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  isOpen,
  onClose,
  onActionClick,
}) => {
  const [filter, setFilter] = useState<"ALL" | "UNREAD" | "ACADEMIC" | "SECURITY">("ALL");
  const [notifications, setNotifications] = useState<NotificationItem[]>([
    {
      id: "notif_1",
      title: "CS-101 Midterm Examination Scheduled",
      message: "Your AI-proctored distributed systems midterm opens tomorrow at 2:00 PM EST. Please verify webcam permissions.",
      timestamp: "10 mins ago",
      type: "EXAM",
      isRead: false,
      actionUrl: "exam",
      actionLabel: "View Exam Details",
    },
    {
      id: "notif_2",
      title: "Grade Committed: Lab 3 Zero-Trust Ingress",
      message: "Prof. David Malan committed an evaluation score of 94% with written rubric feedback.",
      timestamp: "1 hour ago",
      type: "ACADEMIC",
      isRead: false,
      actionUrl: "gradebook",
      actionLabel: "View Rubric",
    },
    {
      id: "notif_3",
      title: "Live WebRTC Session Active: Raft Protocol",
      message: "CS-101 live lecture is currently in progress with 128 learners and breakout rooms.",
      timestamp: "2 hours ago",
      type: "ANNOUNCEMENT",
      isRead: false,
      actionUrl: "live",
      actionLabel: "Join Live Room",
    },
    {
      id: "notif_4",
      title: "Open Badges 3.0 Credential Issued",
      message: "W3C cryptographic verifiable badge for 'Distributed Consensus Mastery' has been cryptographically signed.",
      timestamp: "1 day ago",
      type: "ACADEMIC",
      isRead: true,
      actionUrl: "badge",
      actionLabel: "Verify Certificate",
    },
    {
      id: "notif_5",
      title: "FERPA Audit Compliance Log Verified",
      message: "Automated cryptographic audit log chain validated for institutional data region us-east-1.",
      timestamp: "2 days ago",
      type: "SECURITY",
      isRead: true,
    },
  ]);

  if (!isOpen) return null;

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const filteredNotifications = notifications.filter((n) => {
    if (filter === "UNREAD") return !n.isRead;
    if (filter === "ACADEMIC") return n.type === "ACADEMIC" || n.type === "EXAM";
    if (filter === "SECURITY") return n.type === "SECURITY";
    return true;
  });

  const markAllAsRead = () => {
    setNotifications(notifications.map((n) => ({ ...n, isRead: true })));
  };

  const markSingleAsRead = (id: string) => {
    setNotifications(
      notifications.map((n) => (n.id === id ? { ...n, isRead: true } : n))
    );
  };

  return (
    <div className="absolute right-0 top-12 z-50 w-96 max-w-[calc(100vw-2rem)] bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden animate-fadeIn">
      {/* Header */}
      <div className="bg-slate-950 border-b border-slate-800 p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-xl bg-blue-600/20 text-blue-400 flex items-center justify-center border border-blue-500/30">
            <Bell className="h-4 w-4" />
          </div>
          <div>
            <h4 className="font-bold text-xs text-white">Notification Center</h4>
            <p className="text-[10px] text-slate-400">
              {unreadCount > 0 ? `${unreadCount} unread alerts` : "All caught up"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              onClick={markAllAsRead}
              className="text-[10px] font-semibold text-blue-400 hover:text-blue-300 flex items-center gap-1"
            >
              <CheckCheck className="h-3 w-3" />
              <span>Mark all read</span>
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="bg-slate-950/60 border-b border-slate-800 px-3 py-2 flex items-center gap-1 overflow-x-auto text-[11px]">
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
                ? "bg-blue-600 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Notifications List */}
      <div className="max-h-96 overflow-y-auto divide-y divide-slate-800/80">
        {filteredNotifications.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs">
            No notifications in this category.
          </div>
        ) : (
          filteredNotifications.map((notif) => (
            <div
              key={notif.id}
              onClick={() => markSingleAsRead(notif.id)}
              className={`p-3.5 text-xs transition-colors hover:bg-slate-800/40 cursor-pointer ${
                !notif.isRead ? "bg-blue-950/20" : "bg-transparent"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  {!notif.isRead && (
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
                  )}
                  <strong className={`font-semibold text-slate-200 ${!notif.isRead ? "text-white" : ""}`}>
                    {notif.title}
                  </strong>
                </div>
                <span className="text-[10px] text-slate-500 shrink-0">{notif.timestamp}</span>
              </div>

              <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
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
                    className="text-[10px] font-bold text-blue-400 hover:text-blue-300 flex items-center gap-1 bg-blue-950/60 px-2 py-1 rounded-md border border-blue-800/60 transition-colors"
                  >
                    <span>{notif.actionLabel}</span>
                    <ExternalLink className="h-2.5 w-2.5" />
                  </button>
                  <span className="text-[9px] uppercase font-bold text-slate-500 tracking-wider">
                    {notif.type}
                  </span>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
