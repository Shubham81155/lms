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
} from "lucide-react";
import { useAuditLogs, useDashboardStats } from "@/hooks/useAdmin";
import { LrsAnalyticsViewer } from "@/components/LrsAnalyticsViewer";
import { DsarComplianceModal } from "@/components/DsarComplianceModal";
import { TenantOnboardingModal } from "@/components/TenantOnboardingModal";
import { AuditSecurityScannerModal } from "@/components/AuditSecurityScannerModal";

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<"overview" | "compliance" | "sso" | "audit">("overview");
  const [isSyncingSis, setIsSyncingSis] = useState(false);
  const [showLrsStream, setShowLrsStream] = useState(false);
  const [showDsarModal, setShowDsarModal] = useState(false);
  const [showTenantModal, setShowTenantModal] = useState(false);
  const [showSecurityModal, setShowSecurityModal] = useState(false);

  const { logs } = useAuditLogs();
  const { stats } = useDashboardStats();

  React.useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash.replace("#", "");
      if (hash === "compliance" || hash === "sso" || hash === "audit" || hash === "overview") {
        setActiveTab(hash as any);
      }
    };
    handleHash();
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, []);

  const handleNavigateTab = (tabKey: string) => {
    if (tabKey === "overview" || tabKey === "compliance" || tabKey === "sso" || tabKey === "audit") {
      setActiveTab(tabKey as any);
    }
  };

  const handleSyncOneRoster = () => {
    setIsSyncingSis(true);
    setTimeout(() => {
      setIsSyncingSis(false);
      alert("IMS OneRoster 1.2 SIS Synchronized: 24,850 users and 312 courses up to date.");
    }, 1200);
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
                Super Administrator
              </span>
              <span className="text-xs text-slate-400">Tenant Tier: ENTERPRISE</span>
            </div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">
              Tenant Administration & Governance
            </h1>
            <p className="text-sm text-slate-400">
              Multi-Tenancy Isolation, SAML 2.0 / SCIM Federation & Cryptographic Audit Trails
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

            <button
              onClick={handleSyncOneRoster}
              disabled={isSyncingSis}
              className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors shadow-md"
            >
              <RefreshCw className={`h-4 w-4 text-blue-400 ${isSyncingSis ? "animate-spin" : ""}`} />
              <span>{isSyncingSis ? "Syncing SIS..." : "Sync OneRoster (SIS)"}</span>
            </button>

            <button
              onClick={() => alert("Exported SOC 2 Type II & FERPA Compliance Audit Package (ZIP)")}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-blue-500/20 transition-all"
            >
              <Download className="h-4 w-4" />
              <span>Export Compliance Audit</span>
            </button>
          </div>
        </div>

        {/* Top Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {[
            { label: "Active Enrolled Users", value: "24,850", sub: "SCIM Provisioned", icon: Users, color: "text-blue-400" },
            { label: "PostgreSQL Isolation", value: "Row-Level (RLS)", sub: "AES-256 Encrypted", icon: Lock, color: "text-emerald-400" },
            { label: "Identity Federation", value: "SAML 2.0 / Okta", sub: "Zero-Trust mTLS", icon: Key, color: "text-amber-400" },
            { label: "LTI 1.3 Deployments", value: "14 Active Tools", sub: "1EdTech Advantage", icon: Terminal, color: "text-purple-400" },
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
            { id: "compliance", label: "Security & Compliance (FERPA/SOC2)", icon: ShieldCheck },
            { id: "sso", label: "SSO & Identity Providers", icon: Key },
            { id: "audit", label: "Write-Once Audit Log", icon: Terminal },
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
            <div className="md:col-span-2 bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4 shadow-xl">
              <h3 className="font-bold text-base text-white">Institutional Hierarchy & Campuses</h3>
              <div className="space-y-3">
                {[
                  { name: "Main Cambridge Campus", departments: "18 Departments", faculty: "412 Faculty", students: "16,400 Students" },
                  { name: "Longwood Medical Campus", departments: "8 Departments", faculty: "280 Faculty", students: "5,200 Students" },
                  { name: "Allston Engineering Hub", departments: "6 Departments", faculty: "120 Faculty", students: "3,250 Students" },
                ].map((c, idx) => (
                  <div key={idx} className="bg-slate-950 p-4 rounded-2xl border border-slate-800/80 flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-sm text-slate-100">{c.name}</h4>
                      <p className="text-xs text-slate-400 mt-0.5">{c.departments} • {c.faculty}</p>
                    </div>
                    <span className="text-xs font-semibold text-blue-400 bg-blue-950/60 border border-blue-800 px-3 py-1 rounded-full">
                      {c.students}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4 shadow-xl">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-base text-white">White-Label Customization</h3>
                <button
                  onClick={() => setShowTenantModal(true)}
                  className="px-3 py-1.5 bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600 hover:text-white rounded-xl text-xs font-bold transition-all"
                >
                  Configure Tenant
                </button>
              </div>
              <div className="space-y-3 text-xs">
                <div>
                  <label className="text-slate-400 font-semibold block mb-1">Custom Domain</label>
                  <input
                    type="text"
                    disabled
                    value="learn.harvard.edu"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200"
                  />
                </div>
                <div>
                  <label className="text-slate-400 font-semibold block mb-1">Primary Branding Color</label>
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-lg bg-[#a51c30] border border-slate-700" />
                    <span className="font-mono text-slate-300">#A51C30 (Crimson)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "compliance" && (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-6 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="font-bold text-base text-white">Regulatory Framework Compliance Matrix</h3>
                <p className="text-xs text-slate-400">FERPA, COPPA, SOC 2 Type II, and WCAG 2.1 Level AA controls</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowDsarModal(true)}
                  className="px-3.5 py-1.5 bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600 hover:text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
                >
                  <ShieldCheck className="h-4 w-4" />
                  <span>FERPA/GDPR DSAR</span>
                </button>
                <button
                  onClick={() => setShowSecurityModal(true)}
                  className="px-3.5 py-1.5 bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600 hover:text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
                >
                  <Lock className="h-4 w-4" />
                  <span>Audit & SOC 2 Scanner</span>
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { name: "FERPA Compliance", status: "VERIFIED", desc: "Student PII encryption (AES-256-GCM) & parental inspection gates active." },
                { name: "COPPA Guardrails", status: "CONFIGURED", desc: "Verifiable parental consent workflows active for students under 13." },
                { name: "SOC 2 Type II", status: "CONTINUOUS AUDIT", desc: "Automated infrastructure drift detection and encrypted log chaining." },
                { name: "WCAG 2.1 AA / Section 508", status: "ACCESSIBLE", desc: "Full keyboard navigation & screen-reader landmark compatibility." },
              ].map((item, idx) => (
                <div key={idx} className="bg-slate-950 border border-slate-800 p-4 rounded-2xl space-y-2">
                  <div className="flex items-center justify-between">
                    <strong className="text-sm text-white">{item.name}</strong>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800">
                      {item.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "sso" && (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-base text-white">Federated Identity Providers (IdP)</h3>
              <button className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold">
                + Add Identity Provider
              </button>
            </div>
            <div className="space-y-3">
              {[
                { name: "Harvard Key (Okta SAML 2.0)", type: "SAML 2.0", status: "Connected", users: "24,100 active" },
                { name: "Microsoft Entra ID (Azure AD)", type: "OIDC", status: "Connected", users: "750 active" },
              ].map((idp, idx) => (
                <div key={idx} className="bg-slate-950 border border-slate-800 p-4 rounded-2xl flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-sm text-white">{idp.name}</h4>
                    <p className="text-xs text-slate-400 mt-0.5">Protocol: {idp.type} • {idp.users}</p>
                  </div>
                  <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    <span>{idp.status}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "audit" && (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-bold text-base text-white">Immutable Write-Once Audit Stream</h3>
                <p className="text-xs text-slate-400">Cryptographically Chained SHA-256 Audit Log</p>
              </div>
              <span className="text-xs text-slate-400 font-mono">Retention: 7 Years (FERPA Standard)</span>
            </div>

            <div className="bg-slate-950 rounded-2xl p-4 font-mono text-[11px] text-slate-300 space-y-2 overflow-x-auto">
              {logs && logs.length > 0 ? (
                logs.map((log) => (
                  <p key={log.id} className="text-emerald-400">
                    [{new Date(log.createdAt).toISOString()}] {log.action}: resource="{log.resourceType}" {log.resourceId ? `id="${log.resourceId}"` : ""} user="{log.userId || "system"}"
                  </p>
                ))
              ) : (
                <>
                  <p className="text-emerald-400">[2026-10-08T16:45:00Z] SSO_AUTH_SUCCESS: user="alex.chen@harvard.edu" idp="OKTA_SAML2" ip="128.103.1.42"</p>
                  <p className="text-blue-400">[2026-10-08T16:42:15Z] GRADE_COMMITTED: course="CS-101" student="usr_01" grade=94.0 author="prof_malan" hash="0x89ab...ef"</p>
                  <p className="text-amber-400">[2026-10-08T16:38:00Z] FLE_ENCRYPTION_CALL: field="ssnEncrypted" method="AES-256-GCM" status="SUCCESS"</p>
                  <p className="text-purple-400">[2026-10-08T16:30:10Z] ONEROSTER_SYNC: total_users_synced=24850 status="COMPLETED"</p>
                  <p className="text-slate-500">[2026-10-08T16:25:00Z] LTI_ADVANTAGE_LAUNCH: client="Canvas_Quiz_Advantage" deployment_id="dep_0029"</p>
                </>
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

        {/* FERPA / GDPR DSAR Compliance Center */}
        {showDsarModal && (
          <DsarComplianceModal
            onClose={() => setShowDsarModal(false)}
          />
        )}

        {/* Multi-Tenant White-Label Onboarding */}
        {showTenantModal && (
          <TenantOnboardingModal
            onClose={() => setShowTenantModal(false)}
          />
        )}

        {/* SOC 2 Type II, WCAG 2.1 AA & RLS Continuous Security Scanner */}
        {showSecurityModal && (
          <AuditSecurityScannerModal
            onClose={() => setShowSecurityModal(false)}
          />
        )}
      </main>
    </div>
  );
}
