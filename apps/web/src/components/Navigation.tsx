"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  GraduationCap,
  BookOpen,
  Users,
  ShieldCheck,
  Award,
  Video,
  FileCheck,
  Bell,
  Search,
  LogOut,
  Terminal,
  Building,
  Calendar,
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
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const notifications = useNotifications();

  // Fallback info if session is loading
  const displayInfo = {
    name: user?.name || (currentRole === "student" ? "Alex Chen" : currentRole === "teacher" ? "Prof. David Malan" : "Sarah Connor"),
    email: user?.email || (currentRole === "student" ? "alex.chen@harvard.edu" : currentRole === "teacher" ? "david.malan@harvard.edu" : "admin@harvard.edu"),
    roleTitle: user?.role === "STUDENT" ? "Enrolled Student" : user?.role === "INSTRUCTOR" ? "Faculty Instructor" : "Tenant Administrator",
    badgeColor: currentRole === "student" ? "bg-blue-900/50 text-blue-400 border-blue-700/50" : currentRole === "teacher" ? "bg-purple-900/50 text-purple-400 border-purple-700/50" : "bg-amber-900/50 text-amber-400 border-amber-700/50",
    avatarBg: currentRole === "student" ? "bg-blue-600" : currentRole === "teacher" ? "bg-purple-600" : "bg-amber-600",
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
    <header className="border-b border-slate-800 bg-slate-950 px-6 py-3 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Brand & Institution Info */}
        <div className="flex items-center gap-6">
          <Link href={currentRole === "student" ? "/student" : currentRole === "teacher" ? "/teacher" : "/admin"} className="flex items-center gap-2.5 font-bold text-lg text-white group">
            <div className="h-9 w-9 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/30 group-hover:scale-105 transition-transform">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div className="flex flex-col">
              <span className="leading-tight">
                Apex<span className="text-blue-500">LMS</span>
              </span>
              <span className="text-[10px] text-slate-400 font-normal">Enterprise Education</span>
            </div>
          </Link>

          <div className="hidden lg:flex items-center gap-2 pl-4 border-l border-slate-800">
            <span className={`text-[10px] px-2.5 py-0.5 rounded-full border font-medium ${displayInfo.badgeColor}`}>
              {displayInfo.roleTitle}
            </span>
          </div>
        </div>

        {/* Role-Specific Contextual Navigation Menu */}
        <nav className="hidden md:flex items-center gap-1 bg-slate-900/60 p-1 rounded-xl border border-slate-800/80">
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
                    ? "text-blue-400 bg-blue-600/15 border border-blue-500/30 font-semibold shadow-sm"
                    : "text-slate-300 hover:text-white hover:bg-slate-800/80 border border-transparent"
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${isActive ? "text-blue-400" : "text-slate-400"}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* User Profile, Notifications & Sign Out */}
        <div className="flex items-center gap-4">
          <div className="hidden xl:flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-slate-400 text-xs">
            <Search className="h-3.5 w-3.5" />
            <input
              type="text"
              placeholder="Search catalog, records..."
              className="bg-transparent border-none text-slate-200 text-xs focus:outline-none w-36 focus:w-48 transition-all"
            />
          </div>

          <div className="relative">
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className={`relative p-2 rounded-xl border transition-colors ${
                showNotifications
                  ? "bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-500/20"
                  : "bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800"
              }`}
            >
              <Bell className="h-4 w-4" />
              {notifications.unreadCount > 0 && (
                <span
                  aria-label={`${notifications.unreadCount} unread notifications`}
                  className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-blue-500 ring-2 ring-slate-950 text-[9px] font-bold text-white flex items-center justify-center"
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
          <div className="flex items-center gap-3 pl-2 border-l border-slate-800">
            <div className={`h-8 w-8 rounded-xl ${displayInfo.avatarBg} flex items-center justify-center text-white font-bold text-xs shadow-md`}>
              {displayInfo.avatarInitials}
            </div>

            <div className="hidden sm:flex flex-col text-left">
              <span className="text-xs font-bold text-slate-200 leading-tight">{displayInfo.name}</span>
              <span className="text-[10px] text-slate-400">{displayInfo.roleTitle}</span>
            </div>

            <button
              onClick={() => setShowPrivacy(true)}
              title="Privacy & your data"
              aria-label="Privacy and your data"
              className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 hover:text-white text-slate-400 border border-slate-800 transition-colors ml-1"
            >
              <UserCog className="h-4 w-4" />
            </button>

            {/* Production Sign Out Button */}
            <button
              onClick={() => logout()}
              title="Sign Out of LMS Session"
              className="p-2 rounded-xl bg-slate-900 hover:bg-rose-950/50 hover:text-rose-400 text-slate-400 border border-slate-800 hover:border-rose-800 transition-colors ml-1"
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
