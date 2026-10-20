"use client";

import React, { useState } from "react";
import { Check, ChevronLeft, ChevronRight, Clock, Globe, Mail, Phone, X } from "lucide-react";
import { api } from "@/lib/api";
import { useAction, useApiData } from "@/hooks/useApiData";
import { Banner } from "@/components/admin/IdentityPanels";
import { TrialDaysField, parseTrialDays } from "@/components/platform/TrialControls";
import { TIERS, holdText, invitationMessage, tierLabel, type InvitationResult, type Org, type OrgRequest, type Pagination, type RequestStatus, type Tier } from "@/lib/platform";

const input = "w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand";
const primary = "inline-flex items-center gap-1 px-3 py-1.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-lg text-[11px] font-bold transition-all";
const ghost = "inline-flex items-center gap-1 px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50";
const danger = "inline-flex items-center gap-1 px-3 py-1.5 bg-danger hover:opacity-90 disabled:opacity-50 text-white rounded-lg text-[11px] font-bold";

const STATUS_TABS: { key: RequestStatus; label: string }[] = [
  { key: "PENDING", label: "Pending" },
  { key: "APPROVED", label: "Approved" },
  { key: "REJECTED", label: "Rejected" },
];

const PAGE_SIZE = 25;

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");

/** Organisations that asked to join the platform: the operator approves (creating the organisation) or rejects them. */
export const RequestsPanel: React.FC<{ onChanged?: () => void; onShowOrganisation?: (tenantId: string) => void }> = ({ onChanged, onShowOrganisation }) => {
  const [status, setStatus] = useState<RequestStatus>("PENDING");
  const [page, setPage] = useState(1);
  const list = useApiData<{ data: OrgRequest[]; pagination?: Pagination }>("/api/v1/operator/requests", { status, page, limit: PAGE_SIZE });
  const [done, setDone] = useState<string | null>(null);
  const rows = list.data?.data ?? [];
  const paging = list.data?.pagination;

  return (
    <section className="bg-surface border border-line rounded-3xl p-6 shadow-xl space-y-4" aria-labelledby="requests-h">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="requests-h" className="font-bold text-base text-ink">Registration requests</h2>
          <p className="text-xs text-ink-muted">
            Organisations that asked to use the platform and confirmed their e-mail address. Approving creates the organisation and e-mails its first administrator an activation link.
          </p>
        </div>
        <div role="tablist" aria-label="Request status" className="flex gap-1 rounded-xl border border-line bg-canvas p-1">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={status === t.key}
              onClick={() => {
                setDone(null);
                setStatus(t.key);
                setPage(1);
              }}
              className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors ${status === t.key ? "bg-brand text-on-brand" : "text-ink-muted hover:text-ink"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {done && <Banner kind="ok">{done}</Banner>}
      {list.error && <Banner kind="error">{list.error}</Banner>}
      {list.isLoading && rows.length === 0 && <p className="text-xs text-ink-subtle">Loading requests…</p>}
      {!list.isLoading && !list.error && rows.length === 0 && (
        <p className="rounded-2xl border border-dashed border-line p-8 text-center text-xs text-ink-muted">
          {page > 1 ? "Nothing on this page." : status === "PENDING" ? "No requests waiting. New ones also arrive as notifications." : `No ${status.toLowerCase()} requests.`}
        </p>
      )}

      <ul className="space-y-3">
        {rows.map((r) => (
          <RequestCard
            key={r.id}
            request={r}
            onShowOrganisation={onShowOrganisation}
            onDecided={async (text) => {
              setDone(text);
              await list.reload();
              onChanged?.();
            }}
          />
        ))}
      </ul>

      {paging && paging.totalPages > 1 && (
        <nav aria-label="Request pages" className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-muted">
          <span>
            Page {paging.page} of {paging.totalPages} · {paging.total} requests
          </span>
          <div className="flex gap-2">
            <button type="button" className={ghost} disabled={page <= 1 || list.isLoading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> Newer
            </button>
            <button type="button" className={ghost} disabled={page >= paging.totalPages || list.isLoading} onClick={() => setPage((p) => p + 1)}>
              Older <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </nav>
      )}
    </section>
  );
};

const Detail: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="min-w-0">
    <dt className="text-[10px] uppercase tracking-wider text-ink-subtle">{label}</dt>
    <dd className="text-xs text-ink break-words">{children}</dd>
  </div>
);

const RequestCard: React.FC<{ request: OrgRequest; onDecided: (text: string) => void; onShowOrganisation?: (tenantId: string) => void }> = ({ request: r, onDecided, onShowOrganisation }) => {
  const { busy, error, run, clearError } = useAction();
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [tier, setTier] = useState<Tier>("STARTER");
  const [seats, setSeats] = useState("100");
  const [note, setNote] = useState("");
  const [trialDays, setTrialDays] = useState("0");
  const [reason, setReason] = useState("");

  const seatsValue = seats.trim() === "" ? null : Number(seats);
  const seatsOk = seatsValue === null || (Number.isInteger(seatsValue) && seatsValue >= 1);
  const trialDaysValue = parseTrialDays(trialDays);

  const approve = () =>
    run(async () => {
      const res = await api.post<{ data: { organization: Org; invitation: InvitationResult } }>(`/api/v1/operator/requests/${r.id}/approve`, {
        tier,
        seatQuota: seatsValue,
        trialDays: trialDaysValue ?? 0,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onDecided(`"${r.organizationName}" is approved and created. ${invitationMessage(res.data.invitation, r.contactEmail)}`);
    });
  const reject = () =>
    run(async () => {
      await api.post(`/api/v1/operator/requests/${r.id}/reject`, { reason: reason.trim() });
      onDecided(`"${r.organizationName}" is rejected. ${r.contactEmail} was told why.`);
    });

  return (
    <li className="rounded-2xl border border-line bg-canvas/40 p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-bold text-sm text-ink">{r.organizationName}</h3>
          <p className="text-[11px] text-ink-muted">
            Address <span className="font-mono text-ink">{r.slug}</span> · requested {when(r.createdAt)}
          </p>
        </div>
        {r.status === "PENDING" && r.expired && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-accent/10 text-accent border-accent/30">
            <Clock className="h-3 w-3" aria-hidden="true" /> expired
          </span>
        )}
        {r.status !== "PENDING" && (
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${r.status === "APPROVED" ? "bg-success/10 text-success border-success/30" : "bg-danger/10 text-danger border-danger/30"}`}>
            {r.status.toLowerCase()} {r.decidedAt ? `· ${when(r.decidedAt)}` : ""}
          </span>
        )}
      </div>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Detail label="Contact">
          {r.contactFirstName} {r.contactLastName}
        </Detail>
        <Detail label="E-mail">
          <a className="inline-flex items-center gap-1 underline" href={`mailto:${r.contactEmail}`}>
            <Mail className="h-3 w-3" aria-hidden="true" />
            {r.contactEmail}
          </a>
        </Detail>
        {r.contactPhone && (
          <Detail label="Phone">
            <span className="inline-flex items-center gap-1">
              <Phone className="h-3 w-3" aria-hidden="true" />
              {r.contactPhone}
            </span>
          </Detail>
        )}
        {r.institutionType && <Detail label="Type">{r.institutionType.charAt(0) + r.institutionType.slice(1).toLowerCase()}</Detail>}
        {r.country && <Detail label="Country">{r.country}</Detail>}
        {r.website && (
          <Detail label="Website">
            <a className="inline-flex items-center gap-1 underline" href={r.website} target="_blank" rel="noopener noreferrer">
              <Globe className="h-3 w-3" aria-hidden="true" />
              {r.website.replace(/^https?:\/\//, "")}
            </a>
          </Detail>
        )}
        {r.expectedLearners != null && <Detail label="Expected learners">{r.expectedLearners.toLocaleString()}</Detail>}
      </dl>
      {r.message && <p className="rounded-xl border border-line bg-surface p-3 text-xs text-ink whitespace-pre-wrap">{r.message}</p>}
      {holdText(r) && <p className={`text-[11px] ${r.expired ? "text-accent" : "text-ink-subtle"}`}>{holdText(r)}</p>}

      {r.status === "APPROVED" && (
        <p className="text-[11px] text-ink-muted">
          Approved{r.decidedByEmail ? ` by ${r.decidedByEmail}` : ""}.{r.decisionNote ? ` Note: ${r.decisionNote}` : ""}{" "}
          {r.createdTenantId && onShowOrganisation && (
            <button type="button" className="underline text-brand-fg" onClick={() => onShowOrganisation(r.createdTenantId!)}>
              Show the organisation
            </button>
          )}
        </p>
      )}
      {r.status === "REJECTED" && (
        <p className="text-[11px] text-ink-muted">
          Rejected{r.decidedByEmail ? ` by ${r.decidedByEmail}` : ""}. Reason given: <span className="text-ink">{r.decisionNote || "—"}</span>
        </p>
      )}

      {r.status === "PENDING" && mode === null && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={primary} onClick={() => { clearError(); setMode("approve"); }}>
            <Check className="h-3.5 w-3.5" /> Approve…
          </button>
          <button type="button" className={ghost} onClick={() => { clearError(); setMode("reject"); }}>
            <X className="h-3.5 w-3.5" /> Reject…
          </button>
        </div>
      )}

      {r.status === "PENDING" && mode === "approve" && (
        <div className="rounded-xl border border-brand/40 bg-brand/5 p-3 space-y-3" role="group" aria-label={`Approve ${r.organizationName}`}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
              Plan
              <select className={input} value={tier} onChange={(e) => setTier(e.target.value as Tier)}>
                {TIERS.map((t) => (
                  <option key={t} value={t}>{tierLabel(t)}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
              Seats (blank for no limit)
              <input className={input} type="number" min={1} value={seats} onChange={(e) => setSeats(e.target.value)} />
            </label>
            <label className="space-y-1 text-[11px] font-semibold text-ink-muted">
              Note (optional, internal)
              <input className={input} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <TrialDaysField value={trialDays} onChange={setTrialDays} className={input} />
          </div>
          <p className="text-[11px] text-ink-muted">
            Creates <span className="font-semibold text-ink">{r.organizationName}</span> at <span className="font-mono text-ink">{r.slug}</span> and e-mails {r.contactEmail} a link to set a password.
          </p>
          {!seatsOk && <Banner kind="error">Seats must be a whole number of at least 1, or blank.</Banner>}
          {error && <Banner kind="error">{error}</Banner>}
          <div className="flex gap-2">
            <button type="button" className={primary} disabled={busy || !seatsOk || trialDaysValue === null} onClick={approve}>
              {busy ? "Approving…" : "Approve and create"}
            </button>
            <button type="button" className={ghost} disabled={busy} onClick={() => setMode(null)}>Cancel</button>
          </div>
        </div>
      )}

      {r.status === "PENDING" && mode === "reject" && (
        <div className="rounded-xl border border-danger/40 bg-danger/5 p-3 space-y-3" role="group" aria-label={`Reject ${r.organizationName}`}>
          <label className="block space-y-1 text-[11px] font-semibold text-ink-muted">
            Reason (sent to {r.contactEmail})
            <textarea className={input} rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: we could not verify the institution. Reply to this e-mail with its website." />
          </label>
          {error && <Banner kind="error">{error}</Banner>}
          <div className="flex gap-2">
            <button type="button" className={danger} disabled={busy || reason.trim().length < 5} onClick={reject}>
              {busy ? "Rejecting…" : "Reject request"}
            </button>
            <button type="button" className={ghost} disabled={busy} onClick={() => setMode(null)}>Cancel</button>
          </div>
          {reason.trim().length > 0 && reason.trim().length < 5 && <p className="text-[11px] text-ink-subtle">Give a reason of at least 5 characters.</p>}
        </div>
      )}
    </li>
  );
};
