import {
  Activity,
  BookOpen,
  BookPlus,
  Building,
  CalendarDays,
  ChartColumn,
  ClipboardCheck,
  FileCheck,
  GraduationCap,
  FileQuestion,
  Inbox,
  KeyRound,
  LayoutGrid,
  MessageSquare,
  ScrollText,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { routeForRole, type Role } from "@/lib/roles";

/**
 * The signed-in areas. Which one a person lands in follows from their role (see roles.ts); "platform" is the
 * platform console, used only (and exclusively) by platform operators.
 */
export type Area = "student" | "teacher" | "admin" | "audit" | "platform";

export interface NavItem {
  key: string;
  label: string;
  icon: LucideIcon;
  /**
   * "tab" is a place inside the page: it is highlighted while active and is also a real link, so it can
   * be opened in a new tab. "action" opens a panel or dialog the page owns and is never highlighted.
   */
  kind: "tab" | "action";
  /** Only for tabs. */
  href?: string;
  /**
   * Roles that may use this item. Mirrors a role guard the API applies to everything the item opens, so the
   * sidebar does not offer something that would answer 403. Without it, everyone in the area sees the item.
   */
  roles?: readonly Role[];
}

export interface NavSection {
  id: string;
  title: string;
  items: NavItem[];
}

export const AREA_LABEL: Record<Area, string> = {
  student: "Student",
  teacher: "Teaching",
  admin: "Administration",
  audit: "Audit",
  platform: "Platform",
};

const tab = (key: string, label: string, icon: LucideIcon, href: string): NavItem => ({ key, label, icon, kind: "tab", href });
const action = (key: string, label: string, icon: LucideIcon, roles?: readonly Role[]): NavItem => ({ key, label, icon, kind: "action", roles });

// POST /courses and GET /analytics/cohort are limited to these roles; teaching assistants work inside courses they are assigned to.
const COURSE_LEADS: readonly Role[] = ["INSTRUCTOR", "TENANT_ADMIN", "SUPER_ADMIN"];

/** Single source of truth for the sidebar. Pages decide which actions they can handle (see visibleSections). */
export const NAVIGATION: Record<Area, NavSection[]> = {
  student: [
    {
      id: "learn",
      title: "Learn",
      items: [
        tab("courses", "My courses", BookOpen, "/student"),
        tab("exams", "To do", FileCheck, "/student#exams"),
        tab("grades", "Grades", GraduationCap, "/student#grades"),
      ],
    },
    {
      id: "tools",
      title: "Explore",
      items: [
        action("catalog", "Course catalogue", LayoutGrid),
        action("forum", "Forum", MessageSquare),
        action("calendar", "Calendar", CalendarDays),
        action("tutor", "Study tutor", Sparkles),
      ],
    },
  ],
  teacher: [
    {
      id: "teach",
      title: "Teach",
      items: [tab("courses", "My courses", BookOpen, "/teacher")],
    },
    {
      id: "tools",
      title: "Tools",
      items: [
        action("builder", "Create course", BookPlus, COURSE_LEADS),
        action("grading", "Grade submissions", ClipboardCheck),
        action("questionbank", "Question bank", FileQuestion),
        action("calendar", "Calendar", CalendarDays),
        action("analytics", "Learner analytics", ChartColumn, COURSE_LEADS),
      ],
    },
  ],
  admin: [
    {
      id: "manage",
      title: "Manage",
      items: [
        tab("overview", "Organisation", Building, "/admin#overview"),
        tab("courses", "Courses", BookOpen, "/admin#courses"),
        tab("compliance", "Security & Compliance", ShieldCheck, "/admin#compliance"),
        tab("sso", "Identity & Provisioning", KeyRound, "/admin#sso"),
        tab("platform", "Plan & Integrations", Webhook, "/admin#platform"),
        tab("audit", "Audit Log", ScrollText, "/admin#audit"),
      ],
    },
    {
      id: "tools",
      title: "Tools",
      items: [action("lrs", "Learning records (xAPI)", Activity)],
    },
  ],
  audit: [
    {
      id: "review",
      title: "Review",
      items: [tab("log", "Audit log", ScrollText, "/audit")],
    },
  ],
  platform: [
    {
      id: "operate",
      title: "Platform",
      items: [
        tab("overview", "Overview", LayoutGrid, "/platform"),
        tab("requests", "Registration requests", Inbox, "/platform#requests"),
        tab("organisations", "Organisations", Building, "/platform#organisations"),
      ],
    },
    {
      id: "team",
      title: "Platform team",
      items: [
        tab("operators", "Operators", UsersRound, "/platform#operators"),
        tab("audit", "Audit log", ScrollText, "/platform#audit"),
      ],
    },
  ],
};

export function areaForRole(role: string | null | undefined): Area {
  const route = routeForRole(role ?? "");
  return route === "/admin" ? "admin" : route === "/teacher" ? "teacher" : route === "/audit" ? "audit" : "student";
}

/**
 * The sections to render for a person: items limited to other roles are left out (and stay out until the
 * role is known), actions only appear when the page supplied a handler for them (so a page can never show a
 * button that does nothing), and no section is left without items.
 */
export function visibleSections(area: Area, actions?: Record<string, unknown>, role?: string | null): NavSection[] {
  const allowed = (i: NavItem) => !i.roles || (!!role && i.roles.includes(role as Role));
  return NAVIGATION[area]
    .map((s) => ({ ...s, items: s.items.filter((i) => allowed(i) && (i.kind === "tab" || typeof actions?.[i.key] === "function")) }))
    .filter((s) => s.items.length > 0);
}

/** The tab shown as the current place; falls back to the area's first tab. */
export function currentTab(area: Area, activeKey?: string): NavItem {
  const tabs = NAVIGATION[area].flatMap((s) => s.items).filter((i) => i.kind === "tab");
  return tabs.find((i) => i.key === activeKey) ?? tabs[0];
}

const ROLE_TITLES: Record<Role, string> = {
  SUPER_ADMIN: "Super Administrator",
  TENANT_ADMIN: "Tenant Administrator",
  INSTRUCTOR: "Faculty Instructor",
  TEACHING_ASSISTANT: "Teaching Assistant",
  STUDENT: "Student",
  PARENT_GUARDIAN: "Parent / Guardian",
  AUDITOR: "Auditor",
};

export function roleTitle(role: string | null | undefined): string {
  return ROLE_TITLES[role as Role] ?? "Member";
}

/** First letter of the first and last word ("Alex Chen" -> "AC"); two letters for a single word. */
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
