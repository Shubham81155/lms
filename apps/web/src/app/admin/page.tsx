"use client";

import React, { useState } from "react";
import { Navigation } from "@/components/Navigation";
import {
  ShieldCheck,
  Users,
  Building,
  Lock,
  Key,
  Database,
  Terminal,
  Download,
  Settings,
  Globe,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  Activity,
  Webhook,
} from "lucide-react";
import { useAuditLogs, useDashboardStats } from "@/hooks/useAdmin";
import { useAuth } from "@/context/AuthContext";
import { useApiData } from "@/hooks/useApiData";
import { SamlPanel, ScimPanel, SsoPanel } from "@/components/admin/IdentityPanels";
import { FeaturesPanel, UsagePanel, WebhooksPanel, type Usage } from "@/components/admin/PlatformPanels";
import { BrandingPanel, CampusPanel, CompliancePanel } from "@/components/admin/OrgPanels";
import { LrsAnalyticsViewer } from "@/components/LrsAnalyticsViewer";

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<"overview" | "compliance" | "sso" | "platform" | "audit">("overview");
  const [showLrsStream, setShowLrsStream] = useState(false);

  const { logs } = useAuditLogs();
  const { stats } = useDashboardStats();
  const { user } = useAuth();
  const usage = useApiData<{ data: Usage }>("/api/v1/admin/usage");
  const features = useApiData<{ data: Record<string, boolean> }>("/api/v1/admin/features");
  const flags = features.data?.data ?? {};
  const seats = usage.data?.data.seats;

  React.useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash.replace("#", "");
      if (hash === "compliance" || hash === "sso" || hash === "platform" || hash === "audit" || hash === "overview") {
        setActiveTab(hash as any);
      }
    };
    handleHash();
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, []);

  const handleNavigateTab = (tabKey: string) => {
    if (tabKey === "overview" || tabKey === "compliance" || tabKey === "sso" || tabKey === "platform" || tabKey === "audit") {
      setActiveTab(tabKey as any);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <Navigation
        currentRole="admin"
        activeNavTab={activeTab}
        onNavigateTab={handleNavigateTab}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8 space-y-8">
        {/* Admin Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-900/50 text-amber-300 border border-amber-700/50 font-semibold">
                {user?.role === "SUPER_ADMIN" ? "Super Administrator" : "Administrator"}
              </span>
              <span className="text-xs text-slate-400">Plan: {usage.data?.data.tier ?? "…"}</span>
            </div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">
              Tenant Administration & Governance
            </h1>
            <p className="text-sm text-slate-400">
              Seats, single sign-on, directory provisioning, integrations and the audit trail
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setShowLrsStream(true)}
              className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors shadow-md"
            >
              <Activity className="h-4 w-4 text-cyan-400" />
              <span>xAPI LRS Stream</span>
            </button>

          </div>
        </div>

        {/* Top Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {[
            { label: "Seats in use", value: seats ? (seats.quota ? `${seats.used} / ${seats.quota}` : String(seats.used)) : "…", sub: seats ? `${usage.data?.data.last30Days.activeUsers ?? 0} active in 30 days` : "", icon: Users, color: "text-blue-400" },
            { label: "Courses", value: usage.data ? String(usage.data.data.totals.courses) : "…", sub: `${usage.data?.data.totals.enrollments ?? 0} enrolments`, icon: Database, color: "text-emerald-400" },
            { label: "Single sign-on", value: flags.sso ? "Available" : "Not in plan", sub: flags.scim ? "SCIM provisioning on" : "SCIM off", icon: Key, color: "text-amber-400" },
            { label: "Integrations", value: flags.webhooks ? "Webhooks on" : "Webhooks off", sub: flags.lti13 ? "LTI 1.3 on" : "LTI 1.3 off", icon: Terminal, color: "text-purple-400" },
          ].map((stat, idx) => {
            const Icon = stat.icon;
            return (
              <div key={idx} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3 shadow-lg">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-xs font-semibold">{stat.label}</span>
                  <Icon className={`h-5 w-5 ${stat.color}`} />
                </div>
                <div>
                  <div className="text-2xl font-bold text-white">{stat.value}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{stat.sub}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Tab Navigation for Admin Sections */}
        <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
          {[
            { id: "overview", label: "Organization & Hierarchy", icon: Building },
            { id: "compliance", label: "Security & Compliance", icon: ShieldCheck },
            { id: "sso", label: "Identity & Provisioning", icon: Key },
            { id: "platform", label: "Plan, Webhooks & Usage", icon: Webhook },
            { id: "audit", label: "Audit Log", icon: Terminal },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${
                  activeTab === tab.id
                    ? "bg-blue-600/20 text-blue-400 border border-blue-600/30"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Contents */}
        {activeTab === "overview" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
              <CampusPanel />
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
              <BrandingPanel />
            </div>
          </div>
        )}

        {activeTab === "compliance" && (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
            <CompliancePanel />
          </div>
        )}

        {activeTab === "sso" && (
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
              <SsoPanel available={!!flags.sso} />
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
              <SamlPanel available={!!flags.sso} />
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
              <ScimPanel available={!!flags.scim} />
            </div>
          </div>
        )}

        {activeTab === "platform" && (
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
              <UsagePanel />
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
              <FeaturesPanel onChanged={features.reload} />
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
              <WebhooksPanel available={!!flags.webhooks} />
            </div>
          </div>
        )}

        {activeTab === "audit" && (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-bold text-base text-white">Audit log</h3>
                <p className="text-xs text-slate-400">Append-only for the application: it can add entries but not change or delete them.</p>
              </div>
                          </div>

            <div className="bg-slate-950 rounded-2xl p-4 font-mono text-[11px] text-slate-300 space-y-2 overflow-x-auto">
              {logs && logs.length > 0 ? (
                logs.map((log) => (
                  <p key={log.id} className="text-emerald-400">
                    [{new Date(log.createdAt).toISOString()}] {log.action}: resource="{log.resourceType}" {log.resourceId ? `id="${log.resourceId}"` : ""} user="{log.userId || "system"}"
                  </p>
                ))
              ) : (
                <p className="text-slate-500">No audit events recorded yet.</p>
              )}
            </div>
          </div>
        )}

        {/* xAPI Learning Record Store (LRS) Statement Stream */}
        {showLrsStream && (
          <LrsAnalyticsViewer
            onClose={() => setShowLrsStream(false)}
          />
        )}

      </main>
    </div>
  );
}
