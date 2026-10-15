"use client";

import React, { useState } from "react";
import { X, ShieldCheck, Download, EyeOff, Trash2, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";
import { useAction, useApiData, downloadFile } from "@/hooks/useApiData";
import { useAuth } from "@/context/AuthContext";
import { Banner } from "@/components/admin/IdentityPanels";

const card = "bg-slate-950 border border-slate-800 rounded-2xl p-5 space-y-3";
const input =
  "w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500";

/**
 * The signed-in person's own data rights (GDPR Art. 15/17/20, FERPA directory opt-out),
 * backed by /api/v1/privacy/me/*. Every action is written to the audit trail by the API.
 */
export const PrivacySettings: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { user, logout } = useAuth();
  const directory = useApiData<{ data: { optOut: boolean } }>("/api/v1/privacy/me/directory");
  const exportAction = useAction();
  const directoryAction = useAction();
  const eraseAction = useAction();
  const [exported, setExported] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [password, setPassword] = useState("");

  const optOut = directory.data?.data.optOut ?? false;
  const emailMatches = !!user && confirmEmail.trim().toLowerCase() === user.email.toLowerCase();

  const downloadMyData = () =>
    exportAction.run(async () => {
      await downloadFile("/api/v1/privacy/me/export", `personal-data-${user?.id ?? "me"}.json`);
      setExported(true);
    });

  const toggleDirectory = () =>
    directoryAction.run(async () => {
      await api.put("/api/v1/privacy/me/directory", { optOut: !optOut });
      await directory.reload();
    });

  const eraseAccount = () =>
    eraseAction.run(async () => {
      await api.post("/api/v1/privacy/me/erase", { confirmEmail: confirmEmail.trim(), password: password || undefined });
      // The API has already revoked every session; this clears local state and leaves the portal.
      await logout();
    });

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="privacy-h">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h3 id="privacy-h" className="font-bold text-base text-white">Privacy & your data</h3>
              <p className="text-xs text-slate-400">Your rights under GDPR and FERPA. Each action is recorded in the audit trail.</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Access and portability */}
          <section className={card} aria-labelledby="export-h">
            <div className="flex items-center gap-2">
              <Download className="h-4 w-4 text-blue-400" />
              <h4 id="export-h" className="text-sm font-bold text-white">Download your data</h4>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              A JSON file with your profile, enrolments, grades, quiz attempts, submissions, forum posts, notifications,
              live-class attendance, learning activity and recent account activity.
            </p>
            {exportAction.error && <Banner kind="error">{exportAction.error}</Banner>}
            {exported && !exportAction.error && <Banner kind="ok">Your data has been downloaded.</Banner>}
            <button
              onClick={downloadMyData}
              disabled={exportAction.busy}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all"
            >
              {exportAction.busy ? "Preparing…" : "Download my data"}
            </button>
          </section>

          {/* FERPA directory opt-out */}
          <section className={card} aria-labelledby="dir-h">
            <div className="flex items-center gap-2">
              <EyeOff className="h-4 w-4 text-amber-400" />
              <h4 id="dir-h" className="text-sm font-bold text-white">Hide my name from classmates</h4>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Other students see &ldquo;Anonymous learner&rdquo; instead of your name on leaderboards and in forums. Your teachers and administrators still see it.
            </p>
            {(directory.error || directoryAction.error) && <Banner kind="error">{directory.error || directoryAction.error}</Banner>}
            <label className="flex items-center justify-between p-3 rounded-xl bg-slate-900 border border-slate-800 cursor-pointer">
              <span className="text-xs text-slate-300">{optOut ? "Hidden from classmates" : "Visible to classmates"}</span>
              <input
                type="checkbox"
                role="switch"
                checked={optOut}
                disabled={directory.isLoading || directoryAction.busy || !directory.data}
                onChange={toggleDirectory}
                className="h-4 w-4 accent-emerald-500"
              />
            </label>
          </section>

          {/* Erasure */}
          <section className="bg-slate-950 border border-rose-900/50 rounded-2xl p-5 space-y-3" aria-labelledby="erase-h">
            <div className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-rose-400" />
              <h4 id="erase-h" className="text-sm font-bold text-white">Erase my account</h4>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Your name, e-mail, sign-in details, notifications and anything you wrote (submissions, forum posts) are removed
              and you are signed out everywhere. Grades and scores stay on record, as the institution must keep them, but no
              longer identify you. The audit trail cannot be edited and keeps its existing entries.
            </p>
            <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-950/30 border border-rose-900/50 text-[11px] text-rose-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>This cannot be undone. Download your data first if you want a copy.</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-[11px] text-slate-400">Type your e-mail address to confirm</span>
                <input className={input} type="email" autoComplete="off" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} placeholder={user?.email} />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-slate-400">Password (leave empty if you use single sign-on)</span>
                <input className={input} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
            </div>
            {eraseAction.error && <Banner kind="error">{eraseAction.error}</Banner>}
            <button
              onClick={eraseAccount}
              disabled={!emailMatches || eraseAction.busy}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold transition-all"
            >
              {eraseAction.busy ? "Erasing…" : "Erase my account"}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
};
