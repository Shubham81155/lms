"use client";

import React, { useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import {
  Users,
  Key,
  Database,
  Terminal,
  Activity,
  Plus,
  BookOpen,
  ClipboardList,
  FileCheck,
  CalendarDays,
  UserCog,
} from "lucide-react";
import { useAuditLogs } from "@/hooks/useAdmin";
import { useAuth } from "@/context/AuthContext";
import { useApiData } from "@/hooks/useApiData";
import { SamlPanel, ScimPanel, SsoPanel } from "@/components/admin/IdentityPanels";
import { FeaturesPanel, UsagePanel, WebhooksPanel, type Usage } from "@/components/admin/PlatformPanels";
import { BrandingPanel, CampusPanel, CompliancePanel } from "@/components/admin/OrgPanels";
import { PrivacyPanel } from "@/components/admin/PrivacyPanel";
import { AiSettingsPanel } from "@/components/admin/AiSettingsPanel";
import { LrsAnalyticsViewer } from "@/components/LrsAnalyticsViewer";
import { CourseBuilder } from "@/components/CourseBuilder";
import { CourseContentEditor } from "@/components/CourseContentEditor";
import { CourseRoster } from "@/components/CourseRoster";
import { CourseGradebook } from "@/components/CourseGradebook";
import { useOpenIntent } from "@/hooks/useOpenIntent";
import { AssessmentManager } from "@/components/AssessmentManager";
import { CalendarManager } from "@/components/CalendarManager";
import { UserManager } from "@/components/UserManager";
import { createCourseWithCurriculum } from "@/hooks/useCourses";
import { plural } from "@/lib/plural";

const TABS = ["overview", "compliance", "sso", "platform", "audit"] as const;
type Tab = (typeof TABS)[number];
const isTab = (v: string): v is Tab => (TABS as readonly string[]).includes(v);

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [showLrsStream, setShowLrsStream] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const [showContentEditor, setShowContentEditor] = useState(false);
  const [showRoster, setShowRoster] = useState(false);
  const [showGradebook, setShowGradebook] = useState(false);
  const [focusCourse, setFocusCourse] = useState<string | null>(null);
  const [showAssessments, setShowAssessments] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showPeople, setShowPeople] = useState(false);

  const { logs } = useAuditLogs();
  const { user } = useAuth();

  // A link from a notification or email can ask for a tool, on a particular course (see lib/deeplink).
  useOpenIntent(!!user, {
    gradebook: (id) => { setFocusCourse(id); setShowGradebook(true); },
    learners: (id) => { setFocusCourse(id); setShowRoster(true); },
    assessments: (id) => { setFocusCourse(id); setShowAssessments(true); },
  });
  const usage = useApiData<{ data: Usage }>("/api/v1/admin/usage");
  const features = useApiData<{ data: Record<string, boolean> }>("/api/v1/admin/features");
  const flags = features.data?.data ?? {};
  const seats = usage.data?.data.seats;

  React.useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash.replace("#", "");
      if (isTab(hash)) setActiveTab(hash);
    };
    handleHash();
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, []);

  const handleNavigateTab = (tabKey: string) => {
    if (isTab(tabKey)) setActiveTab(tabKey);
  };

  return (
    <AppShell
      area="admin"
      activeKey={activeTab}
      onNavigate={handleNavigateTab}
      actions={{ lrs: () => setShowLrsStream(true) }}
    >

      <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8 space-y-8">
        {/* Admin Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/50 font-semibold">
                {user?.role === "SUPER_ADMIN" ? "Super Administrator" : "Administrator"}
              </span>
              <span className="text-xs text-ink-muted">Plan: {usage.data?.data.tier ?? "…"}</span>
            </div>
            <h1 className="text-3xl font-extrabold text-ink tracking-tight">
              Tenant Administration & Governance
            </h1>
            <p className="text-sm text-ink-muted">
              Seats, single sign-on, directory provisioning, integrations and the audit trail
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setShowPeople(true)}
              className="px-4 py-2.5 bg-surface hover:bg-raised border border-line text-ink rounded-xl text-xs font-bold flex items-center gap-2 transition-colors shadow-md"
            >
              <UserCog className="h-4 w-4 text-accent" />
              <span>People</span>
            </button>

            <button
              onClick={() => setShowBuilder(true)}
              className="px-4 py-2.5 bg-brand hover:bg-brand-hover text-on-brand rounded-xl text-xs font-bold flex items-center gap-2 transition-colors shadow-md"
            >
              <Plus className="h-4 w-4" />
              <span>Create Course</span>
            </button>

            <button
              onClick={() => setShowContentEditor(true)}
              className="px-4 py-2.5 bg-surface hover:bg-raised border border-line text-ink rounded-xl text-xs font-bold flex items-center gap-2 transition-colors shadow-md"
            >
              <BookOpen className="h-4 w-4 text-brand-fg" />
              <span>Course Content</span>
            </button>

            <button
              onClick={() => setShowAssessments(true)}
              className="px-4 py-2.5 bg-surface hover:bg-raised border border-line text-ink rounded-xl text-xs font-bold flex items-center gap-2 transition-colors shadow-md"
            >
              <ClipboardList className="h-4 w-4 text-accent" />
              <span>Quizzes &amp; Assignments</span>
            </button>

            <button
              onClick={() => setShowCalendar(true)}
              className="px-4 py-2.5 bg-surface hover:bg-raised border border-line text-ink rounded-xl text-xs font-bold flex items-center gap-2 transition-colors shadow-md"
            >
              <CalendarDays className="h-4 w-4 text-orchid" />
              <span>Calendar Events</span>
            </button>

            <button
              onClick={() => setShowGradebook(true)}
              className="px-4 py-2.5 bg-surface hover:bg-raised border border-line text-ink rounded-xl text-xs font-bold flex items-center gap-2 transition-colors shadow-md"
            >
              <FileCheck className="h-4 w-4 text-success" />
              <span>Gradebook</span>
            </button>

            <button
              onClick={() => setShowRoster(true)}
              className="px-4 py-2.5 bg-surface hover:bg-raised border border-line text-ink rounded-xl text-xs font-bold flex items-center gap-2 transition-colors shadow-md"
            >
              <Users className="h-4 w-4 text-success" />
              <span>Learners</span>
            </button>

            <button
              onClick={() => setShowLrsStream(true)}
              className="px-4 py-2.5 bg-surface hover:bg-raised border border-line text-ink rounded-xl text-xs font-bold flex items-center gap-2 transition-colors shadow-md"
            >
              <Activity className="h-4 w-4 text-cyan-400" />
              <span>xAPI LRS Stream</span>
            </button>

          </div>
        </div>

        {/* Top Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {[
            { label: "Seats in use", value: seats ? (seats.quota ? `${seats.used} / ${seats.quota}` : String(seats.used)) : "…", sub: seats ? `${usage.data?.data.last30Days.activeUsers ?? 0} active in 30 days` : "", icon: Users, color: "text-brand-fg" },
            { label: "Courses", value: usage.data ? String(usage.data.data.totals.courses) : "…", sub: plural(usage.data?.data.totals.enrollments ?? 0, "enrolment"), icon: Database, color: "text-success" },
            { label: "Single sign-on", value: flags.sso ? "Available" : "Not in plan", sub: flags.scim ? "SCIM provisioning on" : "SCIM off", icon: Key, color: "text-accent" },
            { label: "Integrations", value: flags.webhooks ? "Webhooks on" : "Webhooks off", sub: flags.lti13 ? "LTI 1.3 on" : "LTI 1.3 off", icon: Terminal, color: "text-orchid" },
          ].map((stat, idx) => {
            const Icon = stat.icon;
            return (
              <div key={idx} className="bg-surface border border-line rounded-2xl p-5 space-y-3 shadow-lg">
                <div className="flex items-center justify-between text-ink-muted">
                  <span className="text-xs font-semibold">{stat.label}</span>
                  <Icon className={`h-5 w-5 ${stat.color}`} />
                </div>
                <div>
                  <div className="text-2xl font-bold text-ink">{stat.value}</div>
                  <div className="text-[11px] text-ink-subtle mt-0.5">{stat.sub}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Tab Contents */}
        {activeTab === "overview" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 bg-surface border border-line rounded-3xl p-6 shadow-xl">
              <CampusPanel />
            </div>
            <div className="bg-surface border border-line rounded-3xl p-6 shadow-xl">
              <BrandingPanel />
            </div>
          </div>
        )}

        {activeTab === "compliance" && (
          <div className="space-y-6">
            <div className="bg-surface border border-line rounded-3xl p-6 shadow-xl">
              <CompliancePanel />
            </div>
            <div className="bg-surface border border-line rounded-3xl p-6 shadow-xl">
              <PrivacyPanel />
            </div>
          </div>
        )}

        {activeTab === "sso" && (
          <div className="space-y-6">
            <div className="bg-surface border border-line rounded-3xl p-6 shadow-xl">
              <SsoPanel available={!!flags.sso} />
            </div>
            <div className="bg-surface border border-line rounded-3xl p-6 shadow-xl">
              <SamlPanel available={!!flags.sso} />
            </div>
            <div className="bg-surface border border-line rounded-3xl p-6 shadow-xl">
              <ScimPanel available={!!flags.scim} />
            </div>
          </div>
        )}

        {activeTab === "platform" && (
          <div className="space-y-6">
            <div className="bg-surface border border-line rounded-3xl p-6 shadow-xl">
              <UsagePanel />
            </div>
            <div className="bg-surface border border-line rounded-3xl p-6 shadow-xl">
              <FeaturesPanel onChanged={features.reload} />
            </div>
            <div className="bg-surface border border-line rounded-3xl p-6 shadow-xl">
              <AiSettingsPanel />
            </div>
            <div className="bg-surface border border-line rounded-3xl p-6 shadow-xl">
              <WebhooksPanel available={!!flags.webhooks} />
            </div>
          </div>
        )}

        {activeTab === "audit" && (
          <div className="bg-surface border border-line rounded-3xl p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h3 className="font-bold text-base text-ink">Audit log</h3>
                <p className="text-xs text-ink-muted">Append-only for the application: it can add entries but not change or delete them.</p>
              </div>
            </div>

            <div className="bg-canvas rounded-2xl p-4 font-mono text-[11px] text-ink space-y-2 overflow-x-auto">
              {logs && logs.length > 0 ? (
                logs.map((log) => (
                  <p key={log.id} className="text-success">
                    [{new Date(log.createdAt).toISOString()}] {log.action}: resource="{log.resourceType}" {log.resourceId ? `id="${log.resourceId}"` : ""} user="{log.userId || "system"}"
                  </p>
                ))
              ) : (
                <p className="text-ink-subtle">No audit events recorded yet.</p>
              )}
            </div>
          </div>
        )}

        {showBuilder && (
          <CourseBuilder
            onClose={() => setShowBuilder(false)}
            onSave={async (draft) => {
              try {
                await createCourseWithCurriculum(draft);
              } finally {
                usage.reload();
              }
            }}
          />
        )}

        {showContentEditor && <CourseContentEditor onClose={() => setShowContentEditor(false)} />}

        {showRoster && <CourseRoster initialCourseId={focusCourse} onClose={() => setShowRoster(false)} />}

        {showGradebook && <CourseGradebook initialCourseId={focusCourse} onClose={() => setShowGradebook(false)} />}

        {showAssessments && <AssessmentManager initialCourseId={focusCourse} onClose={() => setShowAssessments(false)} />}

        {showCalendar && <CalendarManager onClose={() => setShowCalendar(false)} />}

        {showPeople && <UserManager onClose={() => { setShowPeople(false); usage.reload(); }} />}

        {/* xAPI Learning Record Store (LRS) Statement Stream */}
        {showLrsStream && (
          <LrsAnalyticsViewer
            onClose={() => setShowLrsStream(false)}
          />
        )}

      </main>
    </AppShell>
  );
}
