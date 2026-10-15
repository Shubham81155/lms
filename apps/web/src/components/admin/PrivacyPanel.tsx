"use client";

import React, { useState } from "react";
import { Download, Search, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAction, useApiData, downloadFile } from "@/hooks/useApiData";
import { useAuth } from "@/context/AuthContext";
import { Banner } from "@/components/admin/IdentityPanels";

const input =
  "w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500";
const ghostBtn =
  "px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50 inline-flex items-center gap-1.5";

interface TenantUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
}

/**
 * Data-subject requests answered by an administrator on someone else's behalf (GDPR Art. 15/17,
 * FERPA 34 CFR 99.10), backed by /api/v1/privacy/users/:id/*. People can do the same for
 * themselves from "Privacy & data" in the header.
 */
export const PrivacyPanel: React.FC = () => {
  const { user: me } = useAuth();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<string | null>(null);
  const results = useApiData<{ data: TenantUser[] }>(search === null ? null : "/api/v1/users", { search: search ?? undefined, limit: 10 });
  const { busy, error, run } = useAction();
  const [done, setDone] = useState<string | null>(null);
  const [erasing, setErasing] = useState<TenantUser | null>(null);
  const [confirm, setConfirm] = useState("");

  const exportFor = (u: TenantUser) =>
    run(async () => {
      setDone(null);
      await downloadFile(`/api/v1/privacy/users/${u.id}/export`, `personal-data-${u.id}.json`);
      setDone(`Exported the data held about ${u.email}.`);
    });

  const eraseFor = (u: TenantUser) =>
    run(async () => {
      setDone(null);
      await api.post(`/api/v1/privacy/users/${u.id}/erase`);
      setErasing(null);
      setConfirm("");
      setDone(`${u.email} has been erased and signed out everywhere.`);
      await results.reload();
    });

  return (
    <section className="space-y-5" aria-labelledby="dsar-h">
      <div>
        <h3 id="dsar-h" className="font-bold text-base text-white">Data-subject requests</h3>
        <p className="text-xs text-slate-400">
          Export or erase a person&apos;s data when they ask you to. Erasure anonymises the account and keeps grades; each action is audited.
        </p>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(query.trim());
        }}
      >
        <input className={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or e-mail" aria-label="Search people" maxLength={100} />
        <button type="submit" className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5">
          <Search className="h-3.5 w-3.5" /> Find
        </button>
      </form>

      {(results.error || error) && <Banner kind="error">{results.error || error}</Banner>}
      {done && <Banner kind="ok">{done}</Banner>}
      {results.isLoading && <p className="text-xs text-slate-500">Searching…</p>}
      {results.data && results.data.data.length === 0 && <p className="text-xs text-slate-500">Nobody matches that search.</p>}

      {results.data && results.data.data.length > 0 && (
        <ul className="divide-y divide-slate-800 border border-slate-800 rounded-2xl overflow-hidden">
          {results.data.data.map((u) => {
            const isSelf = u.id === me?.id;
            return (
              <li key={u.id} className="p-3 bg-slate-950 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-200 truncate">
                      {u.firstName} {u.lastName}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {u.email} · {u.role.replace(/_/g, " ").toLowerCase()} · {u.status.toLowerCase()}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button className={ghostBtn} disabled={busy} onClick={() => exportFor(u)}>
                      <Download className="h-3.5 w-3.5" /> Export
                    </button>
                    <button
                      className={`${ghostBtn} hover:text-rose-300 hover:border-rose-800`}
                      disabled={busy || isSelf}
                      title={isSelf ? "Use Privacy & data in the header to erase your own account" : undefined}
                      onClick={() => {
                        setErasing(erasing?.id === u.id ? null : u);
                        setConfirm("");
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Erase
                    </button>
                  </div>
                </div>

                {erasing?.id === u.id && (
                  <div className="p-3 rounded-xl border border-rose-900/60 bg-rose-950/20 space-y-2">
                    <p className="text-[11px] text-rose-300">
                      This permanently removes {u.email}&apos;s identity, sign-in details and anything they wrote. Type their e-mail to confirm.
                    </p>
                    <div className="flex gap-2">
                      <input className={input} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={u.email} aria-label={`Confirm erasure of ${u.email}`} />
                      <button
                        className="px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold shrink-0"
                        disabled={busy || confirm.trim().toLowerCase() !== u.email.toLowerCase()}
                        onClick={() => eraseFor(u)}
                      >
                        {busy ? "Erasing…" : "Erase"}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};
