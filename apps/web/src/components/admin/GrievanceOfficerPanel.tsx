"use client";

import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAction, useApiData } from "@/hooks/useApiData";
import { Banner } from "@/components/admin/IdentityPanels";

const input =
  "w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand disabled:opacity-60";
const ghostBtn =
  "px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50";
const primaryBtn = "px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold transition-all";

interface Officer {
  organisation: string;
  officer: { name: string; email: string; phone: string | null; address: string | null } | null;
  responseDays: number | null;
}

/**
 * The grievance officer shown on the public privacy notice (DPDP Act s.8(10)), with the number of days the
 * organisation commits to answer. Backed by /api/v1/privacy/grievance-officer. Clearing name and e-mail removes
 * the officer from the notice.
 */
export const GrievanceOfficerPanel: React.FC = () => {
  const cur = useApiData<{ data: Officer }>("/api/v1/privacy/grievance-officer");
  const { busy, error, run, clearError } = useAction();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [days, setDays] = useState("");
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    const d = cur.data?.data;
    if (!d) return;
    setName(d.officer?.name ?? "");
    setEmail(d.officer?.email ?? "");
    setPhone(d.officer?.phone ?? "");
    setAddress(d.officer?.address ?? "");
    setDays(d.responseDays != null ? String(d.responseDays) : "");
  }, [cur.data]);

  const touch = (set: (v: string) => void) => (v: string) => {
    set(v);
    setDone(null);
    clearError();
  };

  const n = name.trim();
  const e = email.trim();
  const daysNum = days.trim() === "" ? null : Number(days);
  const daysOk = daysNum === null || (Number.isInteger(daysNum) && daysNum >= 1 && daysNum <= 90);
  const pairOk = (n === "") === (e === "");
  const emailOk = e === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const nameOk = n === "" || n.length >= 2;
  const valid = daysOk && pairOk && emailOk && nameOk;

  const save = (ev: React.FormEvent) => {
    ev.preventDefault();
    run(async () => {
      setDone(null);
      await api.put("/api/v1/privacy/grievance-officer", {
        name: n || null,
        email: e || null,
        phone: n ? phone.trim() || null : null,
        address: n ? address.trim() || null : null,
        responseDays: daysNum,
      });
      setDone(n ? "Saved. The privacy notice now names this officer." : "Saved. The privacy notice shows no grievance officer.");
      await cur.reload();
    });
  };

  return (
    <section className="space-y-5" aria-labelledby="grievance-h">
      <div>
        <h3 id="grievance-h" className="font-bold text-base text-ink">Grievance officer</h3>
        <p className="text-xs text-ink-muted">
          Whom people complain to about their data. Shown on your public privacy notice. Leave name and e-mail empty to remove the officer.
        </p>
      </div>

      {(cur.error || error) && <Banner kind="error">{cur.error || error}</Banner>}
      {done && <Banner kind="ok">{done}</Banner>}

      <form onSubmit={save} className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="space-y-1 text-[11px] text-ink-muted">
            Name
            <input className={input} value={name} maxLength={120} onChange={(ev) => touch(setName)(ev.target.value)} />
          </label>
          <label className="space-y-1 text-[11px] text-ink-muted">
            E-mail
            <input className={input} type="email" value={email} maxLength={320} onChange={(ev) => touch(setEmail)(ev.target.value)} />
          </label>
          <label className="space-y-1 text-[11px] text-ink-muted">
            Phone (optional)
            <input className={input} value={phone} maxLength={40} disabled={!n} onChange={(ev) => touch(setPhone)(ev.target.value)} />
          </label>
          <label className="space-y-1 text-[11px] text-ink-muted">
            We answer within (days, 1-90)
            <input className={input} inputMode="numeric" value={days} maxLength={2} onChange={(ev) => touch(setDays)(ev.target.value.replace(/\D/g, ""))} />
          </label>
          <label className="space-y-1 text-[11px] text-ink-muted md:col-span-2">
            Postal address (optional)
            <textarea className={input} rows={2} maxLength={500} value={address} disabled={!n} onChange={(ev) => touch(setAddress)(ev.target.value)} />
          </label>
        </div>
        {!pairOk && <p className="text-[11px] text-accent" role="status">Give both a name and an e-mail address, or neither.</p>}
        {!emailOk && <p className="text-[11px] text-accent" role="status">That e-mail address does not look right.</p>}
        {!daysOk && <p className="text-[11px] text-accent" role="status">Response time must be a whole number from 1 to 90.</p>}
        <div className="flex gap-2">
          <button className={primaryBtn} disabled={busy || !valid}>{busy ? "Saving…" : "Save"}</button>
          <button type="button" className={ghostBtn} disabled={busy} onClick={() => cur.reload()}>Reset</button>
        </div>
      </form>
    </section>
  );
}
