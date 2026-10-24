'use client';

import React, { useState } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { Building, Users, Key, Database, Terminal, UserCog } from 'lucide-react';
import { useBranding } from '@/context/BrandingContext';
import { useAuth } from '@/context/AuthContext';
import { useApiData } from '@/hooks/useApiData';
import { SamlPanel, ScimPanel, SsoPanel } from '@/components/admin/IdentityPanels';
import { FeaturesPanel, UsagePanel, WebhooksPanel, type Usage } from '@/components/admin/PlatformPanels';
import { BrandingPanel, CampusPanel, CompliancePanel, TermsPanel } from '@/components/admin/OrgPanels';
import { CustomDomainPanel } from '@/components/admin/CustomDomainPanel';
import { PrivacyPanel } from '@/components/admin/PrivacyPanel';
import { ConsentPurposesPanel } from '@/components/admin/ConsentPurposesPanel';
import { BreachRegisterPanel } from '@/components/admin/BreachRegisterPanel';
import { GrievanceOfficerPanel } from '@/components/admin/GrievanceOfficerPanel';
import { DataRequestsPanel } from '@/components/admin/DataRequestsPanel';
import { RetentionPanel } from '@/components/admin/RetentionPanel';
import { AiSettingsPanel } from '@/components/admin/AiSettingsPanel';
import { SetupChecklist } from '@/components/admin/SetupChecklist';
import { TrialBanner } from '@/components/admin/TrialBanner';
import { DeletionBanner, OffboardingPanel } from '@/components/admin/OffboardingPanel';
import { BillingBanner, BillingPanel } from '@/components/admin/BillingPanel';
import { SupportAccessPanel } from '@/components/admin/SupportAccessPanel';
import { LrsAnalyticsViewer } from '@/components/LrsAnalyticsViewer';
import { CourseAnnouncements } from '@/components/CourseAnnouncements';
import { CourseGradebook } from '@/components/CourseGradebook';
import { useOpenIntent } from '@/hooks/useOpenIntent';
import { UserManager } from '@/components/UserManager';
import { AuditLogPanel } from '@/components/AuditLogPanel';
import { CourseReviewPanel } from '@/components/admin/CourseReviewPanel';
import { AdminCourseTable } from '@/components/admin/AdminCourseTable';
import { plural } from '@/lib/plural';
import { currentTab } from '@/lib/navigation';

const TABS = ['overview', 'courses', 'compliance', 'sso', 'platform', 'billing', 'audit'] as const;
type Tab = (typeof TABS)[number];
const isTab = (v: string): v is Tab => (TABS as readonly string[]).includes(v);

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [showLrsStream, setShowLrsStream] = useState(false);
  const [showPeople, setShowPeople] = useState(false);
  // Administrators oversee courses; the only course tools they open are the gradebook (to approve final
  // grades) and announcements reached from a notification, read-only.
  const [open, setOpen] = useState<{ tool: 'gradebook' | 'announcements'; courseId: string | null } | null>(null);
  const [coursesVersion, setCoursesVersion] = useState(0);
  // Bumped when the deletion is scheduled or cancelled, so the banner reloads.
  const [offboardingVersion, setOffboardingVersion] = useState(0);
  const show = (tool: 'gradebook' | 'announcements', courseId: string | null = null) => setOpen({ tool, courseId });
  const close = () => setOpen(null);

  const { user } = useAuth();
  const branding = useBranding();
  const orgName = branding?.name || user?.tenantName || '';

  // A link from a notification or email can ask for a tool, on a particular course (see lib/deeplink).
  useOpenIntent(!!user, {
    gradebook: (id) => show('gradebook', id),
    announcements: (id) => show('announcements', id),
  });
  const usage = useApiData<{ data: Usage }>('/api/v1/admin/usage');
  const features = useApiData<{ data: Record<string, boolean> }>('/api/v1/admin/features');
  const flags = features.data?.data ?? {};
  const seats = usage.data?.data.seats;

  React.useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash.replace('#', '');
      if (isTab(hash)) setActiveTab(hash);
    };
    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  const handleNavigateTab = (tabKey: string) => {
    if (isTab(tabKey)) setActiveTab(tabKey);
  };

  return (
    <AppShell area="admin" activeKey={activeTab} onNavigate={handleNavigateTab} actions={{ lrs: () => setShowLrsStream(true) }}>
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8 space-y-8">
        <TrialBanner onOpenBilling={() => setActiveTab('billing')} />
        <BillingBanner onOpenBilling={() => setActiveTab('billing')} />
        <DeletionBanner
          key={offboardingVersion}
          onManage={() => {
            setActiveTab('platform');
            setTimeout(() => document.getElementById('admin-offboarding')?.scrollIntoView({ behavior: 'smooth' }), 50);
          }}
        />
        {/* Admin Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          {/* Whose administration this is: the organisation's own name and logo, so nobody mistakes it for the
              platform console or for another organisation. */}
          <div className="space-y-2 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/50 font-semibold">
                {user?.role === 'SUPER_ADMIN' ? 'Organisation super administrator' : 'Organisation administrator'}
              </span>
              <span className="text-xs text-ink-muted">Plan: {usage.data?.data.tier ?? '…'}</span>
            </div>
            <div className="flex items-center gap-3 min-w-0">
              {branding?.logoUrl ? (
                <img
                  src={branding.logoUrl}
                  alt=""
                  className="h-12 w-12 shrink-0 rounded-2xl border border-line bg-surface object-contain"
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="h-12 w-12 shrink-0 rounded-2xl border border-accent/30 bg-accent/10 text-accent flex items-center justify-center"
                >
                  <Building className="h-6 w-6" />
                </div>
              )}
              <div className="min-w-0">
                <h1 className="text-3xl font-extrabold text-ink tracking-tight truncate">{orgName || 'Your organisation'}</h1>
                <p className="text-sm text-ink-muted">Administration: people, courses, sign-in, integrations and the audit trail</p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setShowPeople(true)}
              className="px-4 py-2.5 bg-surface hover:bg-raised border border-line text-ink rounded-xl text-xs font-bold flex items-center gap-2 transition-colors shadow-md"
            >
              <UserCog className="h-4 w-4 text-accent" />
              <span>People</span>
            </button>
          </div>
        </div>

        {/* Top Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {[
            {
              label: 'Seats in use',
              value: seats ? (seats.quota ? `${seats.used} / ${seats.quota}` : String(seats.used)) : '…',
              sub: seats ? `${usage.data?.data.last30Days.activeUsers ?? 0} active in 30 days` : '',
              icon: Users,
              color: 'text-brand-fg',
            },
            {
              label: 'Courses',
              value: usage.data ? String(usage.data.data.totals.courses) : '…',
              sub: plural(usage.data?.data.totals.enrollments ?? 0, 'enrolment'),
              icon: Database,
              color: 'text-success',
            },
            {
              label: 'Single sign-on',
              value: flags.sso ? 'Available' : 'Not in plan',
              sub: flags.scim ? 'SCIM provisioning on' : 'SCIM off',
              icon: Key,
              color: 'text-accent',
            },
            {
              label: 'Integrations',
              value: flags.webhooks ? 'Webhooks on' : 'Webhooks off',
              sub: flags.lti13 ? 'LTI 1.3 on' : 'LTI 1.3 off',
              icon: Terminal,
              color: 'text-orchid',
            },
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
        <h2 className="sr-only">{currentTab('admin', activeTab).label}</h2>
        {activeTab === 'overview' && (
          <SetupChecklist
            seatsUsed={seats?.used ?? null}
            courses={usage.data?.data.totals.courses ?? null}
            ssoAvailable={!!flags.sso}
            onGo={(step) => {
              if (step === 'people' || step === 'course') setShowPeople(true);
              else if (step === 'signin') setActiveTab('sso');
              else
                document
                  .getElementById(step === 'terms' ? 'admin-terms' : 'admin-branding')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
          />
        )}

        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 bg-surface border border-line rounded-3xl p-6 shadow-xl">
              <CampusPanel />
            </div>
            <div id="admin-branding" className="bg-surface border border-line rounded-3xl p-6 shadow-xl scroll-mt-20">
              <BrandingPanel />
            </div>
            <div id="admin-domain" className="md:col-span-3 bg-surface border border-line rounded-3xl p-6 shadow-xl scroll-mt-20">
              <CustomDomainPanel />
            </div>
            <div id="admin-terms" className="md:col-span-3 bg-surface border border-line rounded-3xl p-6 shadow-xl scroll-mt-20">
              <TermsPanel />
            </div>
          </div>
        )}

        {activeTab === 'courses' && (
          <div className="space-y-6">
            <CourseReviewPanel onDecided={() => setCoursesVersion((v) => v + 1)} />
            <AdminCourseTable onOpenGradebook={(id) => show('gradebook', id)} refreshKey={coursesVersion} />
          </div>
        )}

        {activeTab === 'compliance' && (
          <div className="space-y-6">
            <div className="bg-surface border border-line rounded-3xl p-6 shadow-xl">
              <CompliancePanel />
            </div>
            <div className="bg-surface border border-line rounded-3xl p-6 shadow-xl">
              <DataRequestsPanel />
            </div>
            <div className="bg-surface border border-line rounded-3xl p-6 shadow-xl">
              <ConsentPurposesPanel />
            </div>
            <div className="bg-surface border border-line rounded-3xl p-6 shadow-xl">
              <BreachRegisterPanel />
            </div>
            <div className="bg-surface border border-line rounded-3xl p-6 shadow-xl">
              <GrievanceOfficerPanel />
            </div>
            <div className="bg-surface border border-line rounded-3xl p-6 shadow-xl">
              <PrivacyPanel />
            </div>
            <div className="bg-surface border border-line rounded-3xl p-6 shadow-xl">
              <RetentionPanel />
            </div>
            <div id="admin-support" className="bg-surface border border-line rounded-3xl p-6 shadow-xl scroll-mt-20">
              <SupportAccessPanel />
            </div>
          </div>
        )}

        {activeTab === 'sso' && (
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

        {activeTab === 'platform' && (
          <div className="space-y-6">
            <div className="bg-surface border border-line rounded-3xl p-6 shadow-xl">
              <UsagePanel />
            </div>
            <div id="admin-offboarding" className="bg-surface border border-line rounded-3xl p-6 shadow-xl scroll-mt-20">
              <OffboardingPanel onChanged={() => setOffboardingVersion((v) => v + 1)} />
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

        {activeTab === 'billing' && (
          <div className="bg-surface border border-line rounded-3xl p-6 shadow-xl">
            <BillingPanel />
          </div>
        )}

        {activeTab === 'audit' && (
          <div className="bg-surface border border-line rounded-3xl p-6 shadow-xl">
            <AuditLogPanel />
          </div>
        )}

        {open?.tool === 'gradebook' && (
          <CourseGradebook
            initialCourseId={open.courseId}
            onClose={() => {
              close();
              setCoursesVersion((v) => v + 1);
            }}
          />
        )}
        {open?.tool === 'announcements' && open.courseId && (
          <CourseAnnouncements courseId={open.courseId} canPost={false} onClose={close} />
        )}

        {showPeople && (
          <UserManager
            onClose={() => {
              setShowPeople(false);
              usage.reload();
            }}
          />
        )}

        {/* xAPI Learning Record Store (LRS) Statement Stream */}
        {showLrsStream && <LrsAnalyticsViewer onClose={() => setShowLrsStream(false)} />}
      </main>
    </AppShell>
  );
}
