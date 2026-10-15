"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  GraduationCap,
  BookOpen,
  Users,
  ShieldCheck,
  Award,
  FileCheck,
  Bell,
  Search,
  LogOut,
  Terminal,
  Building,
  UserCog,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NotificationCenter } from "@/components/NotificationCenter";
import { PrivacySettings } from "@/components/PrivacySettings";
import { useNotifications } from "@/hooks/useNotifications";

interface NavigationProps {
  currentRole: "student" | "teacher" | "admin";
  activeNavTab?: string;
  onNavigateTab?: (tabKey: string) => void;
}

export const Navigation: React.FC<NavigationProps> = ({
  currentRole,
  activeNavTab,
  onNavigateTab,
}) => {
  const { user, logout } = useAuth();
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const notifications = useNotifications();

  // Fallback info if session is loading
  const displayInfo = {
    name: user?.name || (currentRole === "student" ? "Alex Chen" : currentRole === "teacher" ? "Prof. David Malan" : "Sarah Connor"),
    email: user?.email || (currentRole === "student" ? "alex.chen@harvard.edu" : currentRole === "teacher" ? "david.malan@harvard.edu" : "admin@harvard.edu"),
    roleTitle: user?.role === "STUDENT" ? "Enrolled Student" : user?.role === "INSTRUCTOR" ? "Faculty Instructor" : "Tenant Administrator",
    badgeColor: currentRole === "student" ? "bg-brand/15 text-brand-fg border-brand/50" : currentRole === "teacher" ? "bg-orchid/15 text-orchid border-orchid/50" : "bg-accent/10 text-accent border-accent/50",
    avatarBg: currentRole === "student" ? "bg-brand" : currentRole === "teacher" ? "bg-purple-600" : "bg-amber-600",
    avatarInitials: currentRole === "student" ? "AC" : currentRole === "teacher" ? "DM" : "SC",
  };

  // Role-specific navigation links
  const studentLinks = [
    { key: "courses", label: "My Courses", href: "/student", icon: BookOpen },
    { key: "exams", label: "Assignments & Exams", href: "/student#exams", icon: FileCheck },
    { key: "badges", label: "Verifiable Badges", href: "/student#badges", icon: Award },
  ];

  const teacherLinks = [
    { key: "courses", label: "Courses Taught", href: "/teacher", icon: BookOpen },
    { key: "gradebook", label: "Gradebook & Rubrics", href: "/teacher#gradebook", icon: FileCheck },
    { key: "proctoring", label: "Proctoring Radar", href: "/teacher#proctoring", icon: ShieldCheck },
  ];

  const adminLinks = [
    { key: "overview", label: "Organization Hierarchy", href: "/admin", icon: Building },
    { key: "compliance", label: "Compliance (FERPA)", href: "/admin#compliance", icon: ShieldCheck },
    { key: "sso", label: "SSO & SCIM Sync", href: "/admin#sso", icon: Users },
    { key: "audit", label: "Audit Logs", href: "/admin#audit", icon: Terminal },
  ];

  const currentNavLinks = currentRole === "student" ? studentLinks : currentRole === "teacher" ? teacherLinks : adminLinks;

  return (
    <header className="border-b border-line bg-canvas px-4 sm:px-6 py-3 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Brand & Institution Info */}
        <div className="flex items-center gap-6">
          <Link href={currentRole === "student" ? "/student" : currentRole === "teacher" ? "/teacher" : "/admin"} className="flex items-center gap-2.5 font-bold text-lg text-ink group">
            <div className="h-9 w-9 rounded-xl bg-brand flex items-center justify-center text-on-brand shadow-lg shadow-brand/30 group-hover:scale-105 transition-transform">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div className="flex flex-col">
              <span className="leading-tight">
                Apex<span className="text-brand-fg">LMS</span>
              </span>
              <span className="hidden sm:block text-[10px] text-ink-muted font-normal">Enterprise Education</span>
            </div>
          </Link>

          <div className="hidden lg:flex items-center gap-2 pl-4 border-l border-line">
            <span className={`text-[10px] px-2.5 py-0.5 rounded-full border font-medium ${displayInfo.badgeColor}`}>
              {displayInfo.roleTitle}
            </span>
          </div>
        </div>

        {/* Role-Specific Contextual Navigation Menu */}
        <nav className="hidden md:flex items-center gap-1 bg-surface/60 p-1 rounded-xl border border-line/80">
          {currentNavLinks.map((item) => {
            const Icon = item.icon;
            const isActive = activeNavTab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  if (onNavigateTab) {
                    onNavigateTab(item.key);
                  } else {
                    window.location.href = item.href;
                  }
                }}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                  isActive
                    ? "text-brand-fg bg-brand/15 border border-brand/30 font-semibold shadow-sm"
                    : "text-ink hover:text-ink hover:bg-raised/80 border border-transparent"
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${isActive ? "text-brand-fg" : "text-ink-muted"}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* User Profile, Notifications & Sign Out */}
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="hidden xl:flex items-center gap-2 bg-surface border border-line rounded-xl px-3 py-1.5 text-ink-muted text-xs">
            <Search className="h-3.5 w-3.5" />
            <input
              type="text"
              placeholder="Search catalog, records..."
              className="bg-transparent border-none text-ink text-xs focus:outline-none w-36 focus:w-48 transition-all"
            />
          </div>

          <div className="relative">
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className={`relative p-2 rounded-xl border transition-colors ${
                showNotifications
                  ? "bg-brand text-on-brand border-brand shadow-md shadow-brand/20"
                  : "bg-surface border border-line text-ink hover:text-ink hover:bg-raised"
              }`}
            >
              <Bell className="h-4 w-4" />
              {notifications.unreadCount > 0 && (
                <span
                  aria-label={`${notifications.unreadCount} unread notifications`}
                  className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-brand-hover ring-2 ring-canvas text-[9px] font-bold text-on-brand flex items-center justify-center"
                >
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

          {/* Theme Toggle Button */}
          <ThemeToggle />

          {/* User Profile Info */}
          <div className="flex items-center gap-1.5 sm:gap-3 pl-1.5 sm:pl-2 border-l border-line">
            <div className={`h-8 w-8 rounded-xl ${displayInfo.avatarBg} flex items-center justify-center text-ink font-bold text-xs shadow-md`}>
              {displayInfo.avatarInitials}
            </div>

            <div className="hidden sm:flex flex-col text-left">
              <span className="text-xs font-bold text-ink leading-tight">{displayInfo.name}</span>
              <span className="text-[10px] text-ink-muted">{displayInfo.roleTitle}</span>
            </div>

            <button
              onClick={() => setShowPrivacy(true)}
              title="Privacy & your data"
              aria-label="Privacy and your data"
              className="p-2 rounded-xl bg-surface hover:bg-raised hover:text-ink text-ink-muted border border-line transition-colors sm:ml-1"
            >
              <UserCog className="h-4 w-4" />
            </button>

            {/* Production Sign Out Button */}
            <button
              onClick={() => logout()}
              title="Sign Out of LMS Session"
              className="p-2 rounded-xl bg-surface hover:bg-danger/10 hover:text-danger text-ink-muted border border-line hover:border-danger/30 transition-colors sm:ml-1"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      {showPrivacy && <PrivacySettings onClose={() => setShowPrivacy(false)} />}
    </header>
  );
};
