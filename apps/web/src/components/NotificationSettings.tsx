"use client";

import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAction, useApiData } from "@/hooks/useApiData";
import { Banner } from "@/components/admin/IdentityPanels";

interface Prefs {
  inAppEnabled: boolean;
  emailEnabled: boolean;
  mutedCategories: string[];
  quietStartHour: number | null;
  quietEndHour: number | null;
  timezone: string;
  emailedCategories: string[];
}

const CATEGORY_LABELS: Record<string, string> = {
  GRADE: "Grades",
  EXAM: "Exams",
  COURSE: "Courses",
  SYSTEM: "System",
  LIVE: "Live classes",
  FORUM: "Discussions",
};

const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

const select = "bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-blue-500";

/** The browser's own time zone, falling back to UTC where it cannot be determined. */
const localZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

export const NotificationSettings: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const { data, isLoading, error } = useApiData<{ data: Prefs }>("/api/v1/notifications/preferences");
  const { busy, error: saveError, run, clearError } = useAction();
  const [inApp, setInApp] = useState(true);
  const [email, setEmail] = useState(true);
  const [muted, setMuted] = useState<string[]>([]);
  const [quiet, setQuiet] = useState(false);
  const [start, setStart] = useState(22);
  const [end, setEnd] = useState(7);
  const [zone, setZone] = useState("UTC");
  const [saved, setSaved] = useState(false);

  const p = data?.data;
  useEffect(() => {
    if (!p) return;
    setInApp(p.inAppEnabled);
    setEmail(p.emailEnabled);
    setMuted(p.mutedCategories);
    const hasQuiet = p.quietStartHour !== null && p.quietEndHour !== null;
    setQuiet(hasQuiet);
    if (hasQuiet) {
      setStart(p.quietStartHour as number);
      setEnd(p.quietEndHour as number);
    }
    // A user who never set a zone gets the server default (UTC); offer their own instead.
    setZone(p.timezone === "UTC" && !hasQuiet ? localZone() : p.timezone);
  }, [p]);

  const save = () =>
    run(async () => {
      await api.put("/api/v1/notifications/preferences", {
        inAppEnabled: inApp,
        emailEnabled: email,
        mutedCategories: muted,
        quietStartHour: quiet ? start : null,
        quietEndHour: quiet ? end : null,
        timezone: zone,
      });
      setSaved(true);
    });

  const touch = () => {
    setSaved(false);
    clearError();
  };
  const emailed = (p?.emailedCategories ?? []).map((c) => CATEGORY_LABELS[c] ?? c).join(", ").toLowerCase();

  if (isLoading) return <div className="p-6 text-xs text-slate-500">Loading…</div>;

  return (
    <div className="p-4 space-y-4 text-xs max-h-96 overflow-y-auto" onChange={touch}>
      {(error || saveError) && <Banner kind="error">{error || saveError}</Banner>}
      {saved && <Banner kind="ok">Settings saved.</Banner>}

      <label className="flex items-center justify-between gap-3 text-slate-200">
        <span>Show notifications in the app</span>
        <input type="checkbox" checked={inApp} onChange={(e) => setInApp(e.target.checked)} />
      </label>
      <label className="flex items-center justify-between gap-3 text-slate-200">
        <span>
          Send me e-mail
          {emailed && <span className="block text-[10px] text-slate-500">For {emailed}. Discussion replies stay in the app.</span>}
        </span>
        <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} />
      </label>

      <fieldset className="space-y-2">
        <legend className="text-slate-400 font-semibold">Mute categories</legend>
        <div className="grid grid-cols-2 gap-1.5">
          {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
            <label key={key} className="flex items-center gap-1.5 text-slate-300">
              <input type="checkbox" checked={muted.includes(key)} onChange={(e) => setMuted((m) => (e.target.checked ? [...m, key] : m.filter((x) => x !== key)))} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <label className="flex items-center gap-2 text-slate-200">
          <input type="checkbox" checked={quiet} onChange={(e) => setQuiet(e.target.checked)} />
          Quiet hours (e-mail waits until they end)
        </label>
        {quiet && (
          <div className="flex flex-wrap items-center gap-2 text-slate-400">
            <select className={select} aria-label="Quiet hours start" value={start} onChange={(e) => setStart(Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
            <span>to</span>
            <select className={select} aria-label="Quiet hours end" value={end} onChange={(e) => setEnd(Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
            <input className={`${select} w-40`} aria-label="Time zone" value={zone} onChange={(e) => setZone(e.target.value)} />
          </div>
        )}
        {quiet && start === end && <p className="text-[10px] text-amber-400">Start and end are the same, so no quiet period applies.</p>}
      </fieldset>

      <div className="flex gap-2">
        <button onClick={save} disabled={busy} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg font-bold">
          {busy ? "Saving…" : "Save"}
        </button>
        <button onClick={onDone} className="px-3 py-1.5 bg-slate-900 border border-slate-800 text-slate-300 rounded-lg font-semibold">Back</button>
      </div>
    </div>
  );
};
