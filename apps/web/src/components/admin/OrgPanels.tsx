"use client";

import React, { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAction, useApiData } from "@/hooks/useApiData";
import { Banner } from "@/components/admin/IdentityPanels";
import { expandHex, isHexColor, isHttpUrlOrEmpty, isValidCode, normaliseCode } from "@/lib/forms";

const input =
  "w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand";
const primary = "px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold transition-all";
const ghost =
  "px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50";

// ---------------------------------------------------------------------------
// Campuses and departments
// ---------------------------------------------------------------------------

interface Department { id: string; name: string; code: string; courseCount: number }
interface Campus { id: string; name: string; code: string; courseCount: number; departments: Department[] }

const NameCode: React.FC<{
  placeholderName: string;
  submitLabel: string;
  onSubmit: (v: { name: string; code: string }) => Promise<unknown>;
  disabled: boolean;
}> = ({ placeholderName, submitLabel, onSubmit, disabled }) => {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const ok = name.trim().length >= 2 && isValidCode(code);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        await onSubmit({ name: name.trim(), code: normaliseCode(code) });
        setName("");
        setCode("");
      }}
    >
      <input className={`${input} flex-1 min-w-40`} aria-label={placeholderName} placeholder={placeholderName} value={name} onChange={(e) => setName(e.target.value)} />
      <input className={`${input} w-32`} aria-label="Code" placeholder="CODE" value={code} onChange={(e) => setCode(e.target.value)} />
      <button className={primary} disabled={disabled || !ok}>
        <Plus className="h-3.5 w-3.5 inline mr-1" />
        {submitLabel}
      </button>
    </form>
  );
};

/** A name with a "Rename" button that turns into an input in place (no browser dialog). */
const InlineRename: React.FC<{ name: string; what: string; busy: boolean; onSave: (name: string) => void; children: (rename: React.ReactNode) => React.ReactNode }> = ({ name, what, busy, onSave, children }) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const trimmed = value.trim();
  if (!editing) {
    return (
      <>
        {children(
          <button className={ghost} disabled={busy} aria-label={`Rename ${what} ${name}`} onClick={() => { setValue(name); setEditing(true); }}>
            Rename
          </button>
        )}
      </>
    );
  }
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (trimmed && trimmed !== name) onSave(trimmed);
        setEditing(false);
      }}
    >
      <input className={`${input} min-w-40`} aria-label={`New name for ${what} ${name}`} maxLength={120} autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
      <button className={primary} disabled={busy || !trimmed || trimmed === name}>Save</button>
      <button type="button" className={ghost} onClick={() => setEditing(false)}>Cancel</button>
    </form>
  );
};

export const CampusPanel: React.FC = () => {
  const { data, isLoading, error, reload } = useApiData<{ data: Campus[] }>("/api/v1/admin/campuses");
  const { busy, error: actionError, run } = useAction();

  const act = (fn: () => Promise<unknown>) =>
    run(async () => {
      await fn();
      await reload();
    });

  const campuses = data?.data ?? [];
  return (
    <section className="space-y-4" aria-labelledby="campus-h">
      <div>
        <h3 id="campus-h" className="font-bold text-base text-ink">Campuses and departments</h3>
        <p className="text-xs text-ink-muted">Courses are filed under a department. Codes are upper-case and unique.</p>
      </div>
      {(error || actionError) && <Banner kind="error">{error || actionError}</Banner>}

      <NameCode
        placeholderName="New campus name"
        submitLabel="Add campus"
        disabled={busy}
        onSubmit={(v) => act(() => api.post("/api/v1/admin/campuses", v))}
      />

      {isLoading && <p className="text-xs text-ink-subtle">Loading…</p>}
      {!isLoading && campuses.length === 0 && (
        <p className="text-xs text-ink-subtle text-center p-8 bg-canvas border border-line rounded-2xl">No campuses yet. Add your first one above.</p>
      )}

      <ul className="space-y-3">
        {campuses.map((c) => (
          <li key={c.id} className="bg-canvas border border-line rounded-2xl p-4 space-y-3">
            <InlineRename name={c.name} what="campus" busy={busy} onSave={(name) => act(() => api.patch(`/api/v1/admin/campuses/${c.id}`, { name }))}>
              {(rename) => (
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-bold text-ink">{c.name} <span className="text-[10px] font-mono text-ink-subtle ml-1">{c.code}</span></h4>
                <p className="text-[11px] text-ink-subtle">{c.departments.length} department(s) · {c.courseCount} course(s)</p>
              </div>
              <div className="flex gap-2">
                {rename}
                <button
                  className={ghost}
                  disabled={busy}
                  aria-label={`Delete campus ${c.name}`}
                  onClick={() => window.confirm(`Delete the campus "${c.name}"?`) && act(() => api.delete(`/api/v1/admin/campuses/${c.id}`))}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
              )}
            </InlineRename>

            <ul className="space-y-1.5">
              {c.departments.map((d) => (
                <li key={d.id} className="flex items-center justify-between bg-surface border border-line rounded-xl px-3 py-2 text-xs">
                  <InlineRename name={d.name} what="department" busy={busy} onSave={(name) => act(() => api.patch(`/api/v1/admin/departments/${d.id}`, { name }))}>
                    {(rename) => (
                      <>
                        <span className="text-ink">{d.name} <span className="font-mono text-[10px] text-ink-subtle ml-1">{d.code}</span></span>
                        <span className="flex items-center gap-3">
                    {rename}
                    <span className="text-[11px] text-ink-subtle">{d.courseCount} course(s)</span>
                    <button
                      className="text-ink-subtle hover:text-danger disabled:opacity-50"
                      disabled={busy}
                      aria-label={`Delete department ${d.name}`}
                      onClick={() => window.confirm(`Delete the department "${d.name}"?`) && act(() => api.delete(`/api/v1/admin/departments/${d.id}`))}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </span>
                      </>
                    )}
                  </InlineRename>
                </li>
              ))}
            </ul>

            <NameCode
              placeholderName="New department name"
              submitLabel="Add department"
              disabled={busy}
              onSubmit={(v) => act(() => api.post(`/api/v1/admin/campuses/${c.id}/departments`, v))}
            />
          </li>
        ))}
      </ul>
    </section>
  );
};

// ---------------------------------------------------------------------------
// White-label branding
// ---------------------------------------------------------------------------

interface TenantSettings {
  name: string;
  slug: string;
  customDomain: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  ferpaCompliant: boolean;
  coppaCompliant: boolean;
  dataRegion: string;
}

const Color: React.FC<{ label: string; value: string; onChange: (v: string) => void }> = ({ label, value, onChange }) => (
  <div className="space-y-1">
    <label className="text-xs text-ink-muted font-semibold block">{label}</label>
    <div className="flex items-center gap-2">
      <input type="color" aria-label={`${label} picker`} value={isHexColor(value) ? expandHex(value) : "#000000"} onChange={(e) => onChange(e.target.value)} className="h-9 w-10 rounded-lg bg-canvas border border-line p-0.5" />
      <input className={`${input} font-mono ${value && !isHexColor(value) ? "border-danger" : ""}`} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Academic terms
// ---------------------------------------------------------------------------

interface Term { id: string; name: string; startsOn: string; endsOn: string; courseCount: number }

const day = (iso: string) => iso.slice(0, 10);

/** Terms courses run in ("Fall 2026"): courses are filed under one, and copying a course moves its dates between them. */
export const TermsPanel: React.FC = () => {
  const { data, isLoading, error, reload } = useApiData<{ data: Term[] }>("/api/v1/terms");
  const { busy, error: actionError, run } = useAction();
  const [name, setName] = useState("");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string; starts: string; ends: string } | null>(null);

  const act = (fn: () => Promise<unknown>) =>
    run(async () => {
      await fn();
      await reload();
    });
  const valid = (n: string, s: string, e: string) => n.trim().length >= 2 && !!s && !!e && e > s;
  const terms = data?.data ?? [];

  return (
    <section className="space-y-4" aria-labelledby="terms-h">
      <div>
        <h3 id="terms-h" className="font-bold text-base text-ink">Terms</h3>
        <p className="text-xs text-ink-muted">Semesters or cohorts courses run in. Copying a course into a new term moves its due dates by the gap between the terms.</p>
      </div>
      {(error || actionError) && <Banner kind="error">{error || actionError}</Banner>}

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          act(async () => {
            await api.post("/api/v1/terms", { name: name.trim(), startsOn: starts, endsOn: ends });
            setName("");
            setStarts("");
            setEnds("");
          });
        }}
      >
        <input className={`${input} flex-1 min-w-40`} aria-label="New term name" placeholder="e.g. Fall 2026" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        <label className="text-[11px] text-ink-muted space-y-1">
          <span className="block">Starts</span>
          <input className={`${input} w-40`} type="date" aria-label="Term starts on" value={starts} onChange={(e) => setStarts(e.target.value)} />
        </label>
        <label className="text-[11px] text-ink-muted space-y-1">
          <span className="block">Ends</span>
          <input className={`${input} w-40`} type="date" aria-label="Term ends on" value={ends} onChange={(e) => setEnds(e.target.value)} />
        </label>
        <button className={primary} disabled={busy || !valid(name, starts, ends)}>
          <Plus className="h-3.5 w-3.5 inline mr-1" />
          Add term
        </button>
      </form>
      {starts && ends && ends <= starts && <p className="text-[11px] text-danger">The term must end after it starts.</p>}

      {isLoading && <p className="text-xs text-ink-subtle">Loading…</p>}
      {!isLoading && terms.length === 0 && <p className="text-xs text-ink-subtle">No terms yet.</p>}
      <ul className="space-y-2">
        {terms.map((t) =>
          editing?.id === t.id ? (
            <li key={t.id} className="bg-canvas border border-line rounded-xl p-3">
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  act(async () => {
                    await api.patch(`/api/v1/terms/${t.id}`, { name: editing.name.trim(), startsOn: editing.starts, endsOn: editing.ends });
                    setEditing(null);
                  });
                }}
              >
                <input className={`${input} flex-1 min-w-40`} aria-label={`New name for ${t.name}`} maxLength={80} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                <input className={`${input} w-40`} type="date" aria-label={`${t.name} starts on`} value={editing.starts} onChange={(e) => setEditing({ ...editing, starts: e.target.value })} />
                <input className={`${input} w-40`} type="date" aria-label={`${t.name} ends on`} value={editing.ends} onChange={(e) => setEditing({ ...editing, ends: e.target.value })} />
                <button className={primary} disabled={busy || !valid(editing.name, editing.starts, editing.ends)}>Save</button>
                <button type="button" className={ghost} onClick={() => setEditing(null)}>Cancel</button>
              </form>
            </li>
          ) : (
            <li key={t.id} className="bg-canvas border border-line rounded-xl px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div>
                <strong className="text-ink">{t.name}</strong>
                <span className="text-ink-subtle ml-2">
                  {day(t.startsOn)} to {day(t.endsOn)} · {t.courseCount} course{t.courseCount === 1 ? "" : "s"}
                </span>
              </div>
              <div className="flex gap-2">
                <button className={ghost} disabled={busy} onClick={() => setEditing({ id: t.id, name: t.name, starts: day(t.startsOn), ends: day(t.endsOn) })}>Edit</button>
                <button
                  className={ghost}
                  disabled={busy || t.courseCount > 0}
                  title={t.courseCount > 0 ? "Move its courses to another term first" : undefined}
                  aria-label={`Delete term ${t.name}`}
                  onClick={() => act(() => api.delete(`/api/v1/terms/${t.id}`))}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </li>
          )
        )}
      </ul>
    </section>
  );
};

export const BrandingPanel: React.FC = () => {
  const { data, isLoading, error, reload } = useApiData<{ data: TenantSettings }>("/api/v1/admin/tenant");
  const { busy, error: actionError, run, clearError } = useAction();
  const [name, setName] = useState("");
  const [primaryC, setPrimaryC] = useState("");
  const [secondaryC, setSecondaryC] = useState("");
  const [logo, setLogo] = useState("");
  const [favicon, setFavicon] = useState("");
  const [saved, setSaved] = useState(false);

  const t = data?.data;
  useEffect(() => {
    if (!t) return;
    setName(t.name);
    setPrimaryC(t.primaryColor ?? "");
    setSecondaryC(t.secondaryColor ?? "");
    setLogo(t.logoUrl ?? "");
    setFavicon(t.faviconUrl ?? "");
  }, [t]);

  const valid = name.trim().length >= 2 && isHexColor(primaryC) && isHexColor(secondaryC) && isHttpUrlOrEmpty(logo) && isHttpUrlOrEmpty(favicon);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(false);
    run(async () => {
      await api.patch("/api/v1/admin/tenant", {
        name: name.trim(),
        primaryColor: primaryC.trim(),
        secondaryColor: secondaryC.trim(),
        logoUrl: logo.trim(),
        faviconUrl: favicon.trim(),
      });
      setSaved(true);
      await reload();
    });
  };

  return (
    <section className="space-y-4" aria-labelledby="brand-h">
      <div>
        <h3 id="brand-h" className="font-bold text-base text-ink">White-label branding</h3>
        <p className="text-xs text-ink-muted">Shown on your sign-in page. Domain: <span className="font-mono text-ink">{t?.customDomain ?? `${t?.slug ?? "…"} (subdomain)`}</span></p>
      </div>
      {(error || actionError) && <Banner kind="error">{error || actionError}</Banner>}
      {saved && <Banner kind="ok">Branding saved.</Banner>}

      <form onSubmit={save} className="space-y-3" onChange={() => { setSaved(false); clearError(); }}>
        <label className="block space-y-1 text-xs text-ink-muted font-semibold">Organisation name
          <input className={input} required minLength={2} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Color label="Primary colour" value={primaryC} onChange={setPrimaryC} />
          <Color label="Secondary colour" value={secondaryC} onChange={setSecondaryC} />
        </div>
        <label className="block space-y-1 text-xs text-ink-muted font-semibold">Logo URL (https)
          <input className={`${input} ${!isHttpUrlOrEmpty(logo) ? "border-danger" : ""}`} placeholder="https://…/logo.png" value={logo} onChange={(e) => setLogo(e.target.value)} />
        </label>
        <label className="block space-y-1 text-xs text-ink-muted font-semibold">Favicon URL (https)
          <input className={`${input} ${!isHttpUrlOrEmpty(favicon) ? "border-danger" : ""}`} placeholder="https://…/favicon.ico" value={favicon} onChange={(e) => setFavicon(e.target.value)} />
        </label>

        <div className="flex items-center gap-3 p-3 rounded-xl border border-line bg-canvas" aria-label="Preview">
          <span className="h-8 w-8 rounded-lg" style={{ background: isHexColor(primaryC) ? primaryC : "#334155" }} />
          <span className="h-8 w-8 rounded-lg" style={{ background: isHexColor(secondaryC) ? secondaryC : "#334155" }} />
          <span className="text-xs font-bold text-ink">{name || "Your organisation"}</span>
        </div>

        <button className={primary} disabled={busy || isLoading || !valid}>{busy ? "Saving…" : "Save branding"}</button>
      </form>
    </section>
  );
};

// ---------------------------------------------------------------------------
// Compliance posture
// ---------------------------------------------------------------------------

interface Check { id: string; name: string; status: "PASS" | "WARN" | "FAIL" | "INFO"; detail: string }
interface Compliance { checks: Check[]; declarations: { ferpa: boolean; coppa: boolean; dataRegion: string | null }; note: string }

const STATUS: Record<Check["status"], { label: string; cls: string; Icon: React.ElementType }> = {
  PASS: { label: "Pass", cls: "bg-success/10 text-success border-success/30", Icon: CheckCircle2 },
  WARN: { label: "Needs attention", cls: "bg-accent/10 text-accent border-accent/30", Icon: AlertTriangle },
  FAIL: { label: "Fail", cls: "bg-danger/10 text-danger border-danger/30", Icon: ShieldAlert },
  INFO: { label: "Info", cls: "bg-raised text-ink border-line", Icon: Info },
};

export const CompliancePanel: React.FC = () => {
  const { data, isLoading, error, reload } = useApiData<{ data: Compliance }>("/api/v1/admin/compliance");
  const { busy, error: actionError, run } = useAction();
  const d = data?.data;

  const declare = (key: "ferpaCompliant" | "coppaCompliant", value: boolean) =>
    run(async () => {
      await api.patch("/api/v1/admin/tenant", { [key]: value });
      await reload();
    });

  const counts = (d?.checks ?? []).reduce<Record<string, number>>((m, c) => ({ ...m, [c.status]: (m[c.status] ?? 0) + 1 }), {});

  return (
    <section className="space-y-5" aria-labelledby="comp-h">
      <div>
        <h3 id="comp-h" className="font-bold text-base text-ink">Security and compliance posture</h3>
        <p className="text-xs text-ink-muted">{d?.note ?? "Measured facts about this deployment."}</p>
      </div>
      {(error || actionError) && <Banner kind="error">{error || actionError}</Banner>}
      {isLoading && <p className="text-xs text-ink-subtle">Checking…</p>}

      {d && (
        <>
          <div className="flex flex-wrap gap-2 text-[11px]" aria-label="Summary">
            {(["PASS", "WARN", "FAIL", "INFO"] as const).map((s) => (
              <span key={s} className={`px-2.5 py-1 rounded-full border font-semibold ${STATUS[s].cls}`}>{counts[s] ?? 0} {STATUS[s].label.toLowerCase()}</span>
            ))}
          </div>

          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {d.checks.map((c) => {
              const { Icon, cls, label } = STATUS[c.status];
              return (
                <li key={c.id} className="bg-canvas border border-line rounded-2xl p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-sm text-ink">{c.name}</strong>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 ${cls}`}><Icon className="h-3 w-3" />{label}</span>
                  </div>
                  <p className="text-xs text-ink-muted">{c.detail}</p>
                </li>
              );
            })}
          </ul>

          <div className="bg-canvas border border-line rounded-2xl p-4 space-y-3">
            <h4 className="text-sm font-bold text-ink">Regulatory declarations</h4>
            <p className="text-[11px] text-ink-subtle">What your institution states about itself. These do not change how the platform behaves.</p>
            {([["ferpaCompliant", "FERPA (US education records)", d.declarations.ferpa], ["coppaCompliant", "COPPA (children under 13)", d.declarations.coppa]] as const).map(([key, label, on]) => (
              <label key={key} className="flex items-center justify-between text-xs text-ink">
                <span>{label}</span>
                <input type="checkbox" checked={on} disabled={busy} onChange={(e) => declare(key, e.target.checked)} />
              </label>
            ))}
            <p className="text-[11px] text-ink-subtle">Data region: <span className="font-mono text-ink">{d.declarations.dataRegion ?? "not set"}</span></p>
          </div>
        </>
      )}
    </section>
  );
};
