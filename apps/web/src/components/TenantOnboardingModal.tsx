"use client";

import React, { useState } from "react";
import {
  X,
  Building,
  CheckCircle2,
  Sliders,
  Shield,
  Layers,
  Globe,
  HardDrive,
  Users,
  CreditCard,
  Zap,
} from "lucide-react";

interface TenantOnboardingModalProps {
  onClose: () => void;
  onSaved?: () => void;
}

export const TenantOnboardingModal: React.FC<TenantOnboardingModalProps> = ({
  onClose,
  onSaved,
}) => {
  const [tenantName, setTenantName] = useState("Harvard University");
  const [customDomain, setCustomDomain] = useState("learn.harvard.edu");
  const [selectedTier, setSelectedTier] = useState<"ACADEMIC_PRO" | "ENTERPRISE_DEDICATED">("ENTERPRISE_DEDICATED");
  const [primaryColor, setPrimaryColor] = useState("#a51c30");
  const [notification, setNotification] = useState<string | null>(null);

  // Tenant Feature Flags
  const [featureFlags, setFeatureFlags] = useState({
    scorm: true,
    xapi: true,
    lti13: true,
    aiProctoring: true,
    ssoOkta: true,
    codeSandbox: true,
  });

  const handleSaveConfig = () => {
    setNotification("Tenant configuration, feature flags, and custom domain SSL verified successfully!");
    setTimeout(() => {
      setNotification(null);
      if (onSaved) onSaved();
      onClose();
    }, 1800);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Tenant provisioning">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="bg-slate-950 border-b border-slate-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Building className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-white">Multi-Tenant Provisioning & Usage Metering</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-950 text-blue-400 border border-blue-800">
                  Tier: {selectedTier.replace("_", " ")}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Tenant isolation, white-label branding, module feature flags, and seat quota metering.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Notification Banner */}
        {notification && (
          <div className="bg-emerald-950/90 border-b border-emerald-800/80 px-6 py-2.5 text-xs text-emerald-300 flex items-center gap-2 animate-fadeIn">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <span className="font-semibold">{notification}</span>
          </div>
        )}

        {/* Metering Usage Stats */}
        <div className="bg-slate-950/50 border-b border-slate-800 p-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-slate-950 border border-slate-800 p-4 rounded-2xl space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-1.5 font-semibold">
                <Users className="h-4 w-4 text-blue-400" />
                <span>Enrolled Seats</span>
              </span>
              <span className="text-white font-bold">24,850 / 30,000</span>
            </div>
            <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800">
              <div className="bg-gradient-to-r from-blue-500 to-indigo-500 h-2 rounded-full" style={{ width: "82.8%" }} />
            </div>
            <span className="text-[10px] text-slate-500 block">82.8% of allocated institutional seats provisioned</span>
          </div>

          <div className="bg-slate-950 border border-slate-800 p-4 rounded-2xl space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-1.5 font-semibold">
                <HardDrive className="h-4 w-4 text-purple-400" />
                <span>Encrypted S3 Storage</span>
              </span>
              <span className="text-white font-bold">4.2 TB / 10 TB</span>
            </div>
            <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800">
              <div className="bg-gradient-to-r from-purple-500 to-pink-500 h-2 rounded-full" style={{ width: "42%" }} />
            </div>
            <span className="text-[10px] text-slate-500 block">AES-256 encrypted video lectures & SCORM archives</span>
          </div>

          <div className="bg-slate-950 border border-slate-800 p-4 rounded-2xl space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-1.5 font-semibold">
                <Globe className="h-4 w-4 text-emerald-400" />
                <span>Custom Domain & SSL</span>
              </span>
              <span className="text-emerald-400 font-bold">TLS 1.3 Active</span>
            </div>
            <div className="text-xs font-mono text-slate-300 truncate">
              CNAME: learn.harvard.edu
            </div>
            <span className="text-[10px] text-emerald-400 font-medium">Automatic Let's Encrypt Wildcard Auto-Renew</span>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 p-6 overflow-y-auto max-w-4xl mx-auto w-full space-y-6">
          {/* Institutional Branding */}
          <div className="bg-slate-950 border border-slate-800 p-6 rounded-2xl space-y-4">
            <h4 className="text-sm font-bold text-white uppercase tracking-wider">
              White-Label Identity & Custom Domain
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="text-slate-400 font-semibold block mb-1">Institution Display Name</label>
                <input
                  type="text"
                  value={tenantName}
                  onChange={(e) => setTenantName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white"
                />
              </div>

              <div>
                <label className="text-slate-400 font-semibold block mb-1">Custom Fully Qualified Domain (FQDN)</label>
                <input
                  type="text"
                  value={customDomain}
                  onChange={(e) => setCustomDomain(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white font-mono"
                />
              </div>

              <div>
                <label className="text-slate-400 font-semibold block mb-1">Primary Branding Color</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="h-9 w-12 rounded-lg bg-transparent cursor-pointer border border-slate-800"
                  />
                  <span className="font-mono text-slate-300">{primaryColor}</span>
                </div>
              </div>

              <div>
                <label className="text-slate-400 font-semibold block mb-1">Provisioned Tier</label>
                <select
                  value={selectedTier}
                  onChange={(e) => setSelectedTier(e.target.value as any)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-slate-200"
                >
                  <option value="ACADEMIC_PRO">Academic Pro (Up to 10k seats)</option>
                  <option value="ENTERPRISE_DEDICATED">Enterprise Dedicated (Unlimited + Dedicated VPC)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Module Feature Flags */}
          <div className="bg-slate-950 border border-slate-800 p-6 rounded-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-white uppercase tracking-wider">
                  Tenant-Level Feature Flags
                </h4>
                <p className="text-xs text-slate-400">
                  Granularly toggle system capabilities for this tenant domain.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              {[
                { key: "scorm", title: "SCORM 2004 Runtime Engine", desc: "Enable CMI data model and packaging" },
                { key: "xapi", title: "xAPI / Cmi5 Telemetry Pipeline", desc: "Stream learning records to LRS" },
                { key: "lti13", title: "1EdTech LTI 1.3 Advantage", desc: "Deep linking and assignments/grades" },
                { key: "aiProctoring", title: "AI Webcam & Proctoring Radar", desc: "Anomaly detection and face tracking" },
                { key: "ssoOkta", title: "SAML 2.0 / Okta SSO Federation", desc: "Single sign-on via campus IdP" },
                { key: "codeSandbox", title: "V8 Cloud Code Execution Sandbox", desc: "Interactive unit testing in browser" },
              ].map((flag) => (
                <label
                  key={flag.key}
                  className="flex items-start justify-between p-3.5 rounded-xl bg-slate-900 border border-slate-800 cursor-pointer"
                >
                  <div>
                    <strong className="text-white block">{flag.title}</strong>
                    <span className="text-[11px] text-slate-400">{flag.desc}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={(featureFlags as any)[flag.key]}
                    onChange={(e) =>
                      setFeatureFlags({ ...featureFlags, [flag.key]: e.target.checked })
                    }
                    className="rounded bg-slate-950 border-slate-700 text-blue-600 mt-1 h-4 w-4"
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              onClick={handleSaveConfig}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-500/20 transition-all"
            >
              Save Tenant Configuration
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
