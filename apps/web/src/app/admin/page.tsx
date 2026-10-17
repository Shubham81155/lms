"use client";

import React, { useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { Users, Key, Database, Terminal, Plus, UserCog } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useApiData } from "@/hooks/useApiData";
import { SamlPanel, ScimPanel, SsoPanel } from "@/components/admin/IdentityPanels";
import { FeaturesPanel, UsagePanel, WebhooksPanel, type Usage } from "@/components/admin/PlatformPanels";
import { BrandingPanel, CampusPanel, CompliancePanel, TermsPanel } from "@/components/admin/OrgPanels";
import { PrivacyPanel } from "@/components/admin/PrivacyPanel";
import { AiSettingsPanel } from "@/components/admin/AiSettingsPanel";
import { OperatorPanel } from "@/components/admin/OperatorPanel";
import { LrsAnalyticsViewer } from "@/components/LrsAnalyticsViewer";
import { CourseBuilder } from "@/components/CourseBuilder";
import { CourseContentEditor } from "@/components/CourseContentEditor";
import { CourseSettings } from "@/components/CourseSettings";
import { CourseCopy } from "@/components/CourseCopy";
import { CourseAnnouncements } from "@/components/CourseAnnouncements";
import { StaffCourseList, type CourseTool } from "@/components/StaffCourseList";
import { AssignmentGrading } from "@/components/AssignmentGrading";
import { LiveClasses } from "@/components/LiveClasses";
import { DiscussionForum } from "@/components/DiscussionForum";
import { CourseRoster } from "@/components/CourseRoster";
import { CourseGradebook } from "@/components/CourseGradebook";
import { useOpenIntent } from "@/hooks/useOpenIntent";
import { AssessmentManager } from "@/components/AssessmentManager";
import { CalendarManager } from "@/components/CalendarManager";
import { UserManager } from "@/components/UserManager";
import { AuditLogPanel } from "@/components/AuditLogPanel";
import { CourseReviewPanel } from "@/components/admin/CourseReviewPanel";
import { createCourseWithCurriculum } from "@/hooks/useCourses";
import { plural } from "@/lib/plural";

const TABS = ["overview", "courses", "compliance", "sso", "platform", "audit"] as const;
type Tab = (typeof TABS)[number];
const isTab = (v: string): v is Tab => (TABS as readonly string[]).includes(v);

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [showLrsStream, setShowLrsStream] = useState(false);
  const [showPeople, setShowPeople] = useState(false);
  const [open, setOpen] = useState<{ tool: CourseTool | "builder"; courseId: string | null } | null>(null);
  const [coursesVersion, setCoursesVersion] = useState(0);
  const show = (tool: CourseTool | "builder", courseId: string | null = null) => setOpen({ tool, courseId });
  const close = () => setOpen(null);

  const { user } = useAuth();

  // A link from a notification or email can ask for a tool, on a particular course (see lib/deeplink).
  useOpenIntent(!!user, {
    gradebook: (id) => show("gradebook", id),
    learners: (id) => show("learners", id),
    assessments: (id) => show("assessments", id),
    announcements: (id) => show("announcements", id),
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
              Administration
            </h1>
            <p className="text-sm text-ink-muted">
              People, courses, sign-in, integrations and the audit trail
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
              onClick={() => show("builder")}
              className="px-4 py-2.5 bg-brand hover:bg-brand-hover text-on-brand rounded-xl text-xs font-bold flex items-center gap-2 transition-colors shadow-md"
            >
              <Plus className="h-4 w-4" />
              <span>Create course</span>
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
            <div className="md:col-span-3 bg-surface border border-line rounded-3xl p-6 shadow-xl">
              <TermsPanel />
            </div>
          </div>
        )}

        {activeTab === "courses" && (
          <div className="space-y-6">
          <CourseReviewPanel onDecided={() => setCoursesVersion((v) => v + 1)} />
          <StaffCourseList
            title="All courses"
            canEdit
            tools={["content", "settings", "copy", "announcements", "learners", "assessments", "grading", "gradebook", "forum", "live", "calendar"]}
            onOpen={(tool, id) => show(tool, id)}
            emptyText="No courses yet. Create one, or ask an instructor to."
            refreshKey={coursesVersion}
          />
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
            {user?.role === "SUPER_ADMIN" && <OperatorPanel />}
            <div className="bg-surface border border-line rounded-3xl p-6 shadow-xl">
              <UsagePanel />
            </div>
            <div className="bg-surface border border-line rounded-3xl p-6 shadow-xl">
              <FeaturesPanel />
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
          <div className="bg-surface border border-line rounded-3xl p-6 shadow-xl">
            <AuditLogPanel />
          </div>
        )}

        {open?.tool === "builder" && (
          <CourseBuilder
            onClose={close}
            onSave={async (draft) => {
              try {
                await createCourseWithCurriculum(draft);
              } finally {
                usage.reload();
                setCoursesVersion((v) => v + 1);
              }
            }}
          />
        )}
        {open?.tool === "content" && <CourseContentEditor initialCourseId={open.courseId} onClose={() => { close(); setCoursesVersion((v) => v + 1); }} />}
        {open?.tool === "announcements" && open.courseId && <CourseAnnouncements courseId={open.courseId} canPost onClose={close} />}
        {open?.tool === "settings" && open.courseId && <CourseSettings courseId={open.courseId} onClose={close} onSaved={() => setCoursesVersion((v) => v + 1)} />}
        {open?.tool === "copy" && open.courseId && <CourseCopy courseId={open.courseId} onClose={close} onCopied={() => setCoursesVersion((v) => v + 1)} />}
        {open?.tool === "learners" && <CourseRoster initialCourseId={open.courseId} onClose={() => { close(); setCoursesVersion((v) => v + 1); }} />}
        {open?.tool === "gradebook" && <CourseGradebook initialCourseId={open.courseId} onClose={close} />}
        {open?.tool === "assessments" && <AssessmentManager initialCourseId={open.courseId} onClose={close} />}
        {open?.tool === "grading" && <AssignmentGrading initialCourseId={open.courseId} onClose={close} />}
        {open?.tool === "live" && <LiveClasses initialCourseId={open.courseId} onClose={close} />}
        {open?.tool === "forum" && <DiscussionForum courseId={open.courseId} onClose={close} />}
        {open?.tool === "calendar" && <CalendarManager onClose={close} />}

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
