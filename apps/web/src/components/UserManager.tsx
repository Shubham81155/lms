"use client";

import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useAction, useApiData } from "@/hooks/useApiData";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { Banner } from "@/components/admin/IdentityPanels";
import { card, ghost, input, label, primary } from "@/components/assessments/ui";
import { BulkImport } from "@/components/admin/BulkImport";

const ROLES = ["SUPER_ADMIN", "TENANT_ADMIN", "INSTRUCTOR", "TEACHING_ASSISTANT", "STUDENT", "PARENT_GUARDIAN", "AUDITOR"] as const;
const STATUSES = ["ACTIVE", "INVITED", "LOCKED", "SUSPENDED"] as const;
type Role = (typeof ROLES)[number];
type Status = (typeof STATUSES)[number];

interface Person {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  status: Status;
  emailVerified: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  enrollmentCount: number;
  teachingCourseCount: number;
}

interface PersonEnrollment {
  id: string;
  status: string;
  progressPercent: number;
  course?: { code: string; title: string };
}

const STATUS_STYLE: Record<Status, string> = {
  ACTIVE: "border-success/40 bg-success/10 text-success",
  INVITED: "border-brand/40 bg-brand/15 text-brand-fg",
  LOCKED: "border-accent/40 bg-accent/10 text-accent",
  SUSPENDED: "border-danger/40 bg-danger/10 text-danger",
};

const Enrollments: React.FC<{ userId: string }> = ({ userId }) => {
  const data = useApiData<{ data: PersonEnrollment[] }>(`/api/v1/users/${userId}/enrollments`);
  if (data.isLoading && !data.data) return <p className="text-[11px] text-ink-subtle">Loading courses…</p>;
  if (data.error) return <p className="text-[11px] text-danger">{data.error}</p>;
  const rows = data.data?.data ?? [];
  if (rows.length === 0) return <p className="text-[11px] text-ink-subtle">Not enrolled in any course.</p>;
  return (
    <ul className="space-y-1 text-[11px] text-ink-muted">
      {rows.map((e) => (
        <li key={e.id}>
          <span className="font-semibold text-ink">{e.course?.code ?? "Course"}</span> · {label(e.status)} · {Math.round(e.progressPercent)}%
        </li>
      ))}
    </ul>
  );
};

type Notice = { kind: "ok" | "error"; text: string };

/** What to tell an administrator after an invitation was (or was not) emailed. */
const invitationNotice = (email: string, r: { invitationSent: boolean; emailConfigured: boolean }, fresh: boolean): Notice => {
  if (r.invitationSent) {
    return { kind: "ok", text: fresh ? `Invitation sent to ${email}. They choose a password from the link to activate their account.` : `A new invitation was sent to ${email}.` };
  }
  if (!r.emailConfigured) {
    return { kind: "error", text: `${fresh ? `${email} was added as invited, but ` : ""}no invitation was sent: email is not set up on this server (SMTP_URL). Once it is, use "Resend invitation".` };
  }
  return { kind: "error", text: `${fresh ? `${email} was added, but the` : "The"} invitation email ${fresh ? "" : `to ${email} `}could not be sent. Use "Resend invitation" to try again.` };
};

const PersonRow: React.FC<{ person: Person; self: boolean; actorIsSuper: boolean; onSaved: () => void; onNotice: (n: Notice) => void }> = ({ person, self, actorIsSuper, onSaved, onNotice }) => {
  const [open, setOpen] = useState(false);
  const [first, setFirst] = useState(person.firstName);
  const [last, setLast] = useState(person.lastName);
  const [role, setRole] = useState<Role>(person.role);
  const [status, setStatus] = useState<Status>(person.status);
  const [confirm, setConfirm] = useState(false);
  const { busy, error, run, clearError } = useAction();

  const lockedBySuper = person.role === "SUPER_ADMIN" && !actorIsSuper;
  const roles = ROLES.filter((r) => r !== "SUPER_ADMIN" || actorIsSuper || person.role === "SUPER_ADMIN");
  const identityDirty = first.trim() !== person.firstName || last.trim() !== person.lastName;
  const accessDirty = role !== person.role || status !== person.status;
  const dirty = identityDirty || accessDirty;
  const cutsAccess = status !== person.status && (status === "SUSPENDED" || status === "LOCKED");
  const invalid = !first.trim() || !last.trim();

  const resend = () =>
    run(async () => {
      const r = await api.post<{ data: { invitationSent: boolean; emailConfigured: boolean } }>(`/api/v1/users/${person.id}/invite`, {});
      onNotice(invitationNotice(person.email, r.data, false));
    });

  const save = () =>
    run(async () => {
      await api.patch(`/api/v1/users/${person.id}`, {
        ...(identityDirty ? { firstName: first.trim(), lastName: last.trim() } : {}),
        ...(role !== person.role ? { role } : {}),
        ...(status !== person.status ? { status } : {}),
      });
      setConfirm(false);
      setOpen(false);
      onSaved();
    });

  return (
    <li className={card}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-sm text-ink">
              {person.firstName} {person.lastName}
            </strong>
            {self && <span className="text-[10px] font-bold text-ink-subtle">(you)</span>}
            <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[10px] font-bold text-ink">{label(person.role)}</span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[person.status]}`}>{label(person.status)}</span>
            {person.mfaEnabled && <span className="text-[10px] font-semibold text-success">two-factor</span>}
          </div>
          <p className="text-[11px] text-ink-muted">
            {person.email} · {person.enrollmentCount} enrolment{person.enrollmentCount === 1 ? "" : "s"}
            {person.teachingCourseCount > 0 ? ` · teaches ${person.teachingCourseCount}` : ""} · {person.lastLoginAt ? `last signed in ${new Date(person.lastLoginAt).toLocaleDateString()}` : "never signed in"}
          </p>
        </div>
        <div className="flex gap-2">
          {person.status === "INVITED" && (
            <button className={ghost} disabled={busy} onClick={resend} aria-label={`Resend invitation to ${person.firstName} ${person.lastName}`}>
              Resend invitation
            </button>
          )}
          <button className={ghost} onClick={() => { clearError(); setOpen((o) => !o); }} aria-expanded={open} aria-label={`${open ? "Close" : "Edit"} ${person.firstName} ${person.lastName}`}>
            {open ? "Close" : "Edit"}
          </button>
        </div>
      </div>
      {!open && error && <div className="mt-3"><Banner kind="error">{error}</Banner></div>}

      {open && (
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          {error && <Banner kind="error">{error}</Banner>}
          {lockedBySuper ? (
            <p className="text-xs text-ink-muted">Only a super administrator can change this account.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="space-y-1 text-xs font-semibold text-ink-muted">
                  First name
                  <input className={`${input} w-full`} maxLength={100} value={first} onChange={(e) => setFirst(e.target.value)} />
                </label>
                <label className="space-y-1 text-xs font-semibold text-ink-muted">
                  Last name
                  <input className={`${input} w-full`} maxLength={100} value={last} onChange={(e) => setLast(e.target.value)} />
                </label>
                <label className="space-y-1 text-xs font-semibold text-ink-muted">
                  Role
                  <select className={`${input} w-full`} value={role} disabled={self} onChange={(e) => setRole(e.target.value as Role)}>
                    {roles.map((r) => (
                      <option key={r} value={r}>
                        {label(r)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-xs font-semibold text-ink-muted">
                  Account status
                  <select className={`${input} w-full`} value={status} disabled={self} onChange={(e) => { setStatus(e.target.value as Status); setConfirm(false); }}>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {label(s)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {self && <p className="text-[11px] text-ink-subtle">You cannot change your own role or status, so you can never lock yourself out.</p>}
              {accessDirty && !cutsAccess && <p className="text-[11px] text-ink-subtle">Role and status changes apply the next time they sign in or make a request.</p>}

              {cutsAccess && confirm ? (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2.5 text-xs">
                  <span className="text-ink">
                    {label(status)} signs {person.firstName} out everywhere and blocks sign-in until you set the account back to active.
                  </span>
                  <button className="rounded-lg bg-danger px-3 py-1.5 text-[11px] font-bold text-on-brand disabled:opacity-50" disabled={busy} onClick={save}>
                    {busy ? "Saving…" : `Confirm ${label(status)}`}
                  </button>
                  <button className={ghost} onClick={() => setConfirm(false)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <button className={primary} disabled={busy || !dirty || invalid} onClick={() => (cutsAccess ? setConfirm(true) : save())}>
                    {busy ? "Saving…" : "Save changes"}
                  </button>
                  {invalid && <span className="text-[11px] text-accent">Both names are required.</span>}
                </div>
              )}
            </>
          )}

          <div className="space-y-1">
            <p className="text-xs font-bold text-ink">Courses</p>
            <Enrollments userId={person.id} />
          </div>
        </div>
      )}
    </li>
  );
};

const InviteForm: React.FC<{ actorIsSuper: boolean; onDone: (n: Notice) => void; onCancel: () => void }> = ({ actorIsSuper, onDone, onCancel }) => {
  const [email, setEmail] = useState("");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [role, setRole] = useState<Role>("STUDENT");
  const { busy, error, run, clearError } = useAction();
  const roles = ROLES.filter((r) => r !== "SUPER_ADMIN" || actorIsSuper);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const ready = emailOk && first.trim() && last.trim();

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await api.post<{ invitationSent: boolean; emailConfigured: boolean }>("/api/v1/users", { email: email.trim(), firstName: first.trim(), lastName: last.trim(), role });
      onDone(invitationNotice(email.trim().toLowerCase(), r, true));
    });
  };

  return (
    <form onSubmit={send} className="space-y-3 rounded-2xl border border-brand/40 bg-surface p-4">
      <h4 className="text-sm font-bold text-ink">Invite a person</h4>
      {error && <Banner kind="error">{error}</Banner>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="space-y-1 text-xs font-semibold text-ink-muted md:col-span-2">
          Email address
          <input className={`${input} w-full`} type="email" maxLength={254} value={email} onChange={(e) => { clearError(); setEmail(e.target.value); }} />
        </label>
        <label className="space-y-1 text-xs font-semibold text-ink-muted">
          First name
          <input className={`${input} w-full`} maxLength={100} value={first} onChange={(e) => setFirst(e.target.value)} />
        </label>
        <label className="space-y-1 text-xs font-semibold text-ink-muted">
          Last name
          <input className={`${input} w-full`} maxLength={100} value={last} onChange={(e) => setLast(e.target.value)} />
        </label>
        <label className="space-y-1 text-xs font-semibold text-ink-muted">
          Role
          <select className={`${input} w-full`} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {label(r)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-[11px] text-ink-subtle">They get an email with a link, valid for 7 days, to choose a password. Invited people count toward your seat limit until they join or you remove them.</p>
      <div className="flex items-center gap-3">
        <button className={primary} disabled={busy || !ready}>
          {busy ? "Sending…" : "Send invitation"}
        </button>
        <button type="button" className={ghost} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
};

/** Everyone in the organisation: find people, fix names, change roles and suspend or restore accounts. */
export const UserManager: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  useEscapeKey(onClose);
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [inviting, setInviting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const list = useApiData<{ data: Person[]; pagination: { page: number; totalPages: number; total: number } }>("/api/v1/users", {
    page,
    limit: 15,
    search: search || undefined,
    role: role || undefined,
    status: status || undefined,
  });
  const people = list.data?.data ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/85 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-label="People">
      <div className="flex h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-line bg-canvas px-6 py-4">
          <div>
            <h3 className="text-base font-bold text-ink">People</h3>
            <p className="text-xs text-ink-muted">Invite people by email, or let single sign-on and directory sync create accounts. Here you also correct names, change roles and suspend or restore access.</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button onClick={() => { setNotice(null); setImporting(false); setInviting(true); }} className={primary} aria-label="Invite a person">
              + Invite person
            </button>
            <button onClick={() => { setNotice(null); setInviting(false); setImporting(true); }} className={ghost}>
              Import CSV
            </button>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-xl p-1 text-ink-muted transition-colors hover:bg-raised hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div role="search" className="flex flex-wrap items-center gap-2 border-b border-line bg-canvas/60 px-6 py-3">
          <input className={`${input} w-64`} aria-label="Search people" placeholder="Search name or email…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className={input} aria-label="Filter by role" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}>
            <option value="">All roles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {label(r)}
              </option>
            ))}
          </select>
          <select className={input} aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
          {list.data && <span className="ml-auto text-[11px] text-ink-subtle">{list.data.pagination.total} people</span>}
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-6">
          {notice && <Banner kind={notice.kind}>{notice.text}</Banner>}
          {importing && (
            <BulkImport
              onCancel={() => setImporting(false)}
              onDone={(text) => {
                setNotice({ kind: "ok", text });
                setImporting(false);
                setPage(1);
                list.reload();
              }}
            />
          )}
          {inviting && (
            <InviteForm
              actorIsSuper={user?.role === "SUPER_ADMIN"}
              onCancel={() => setInviting(false)}
              onDone={(n) => {
                setNotice(n);
                setInviting(false);
                setSearch("");
                setQ("");
                setPage(1);
                list.reload();
              }}
            />
          )}
          {list.error && <Banner kind="error">{list.error}</Banner>}
          {list.isLoading && !list.data && <p className="text-xs text-ink-subtle">Loading people…</p>}
          {!list.isLoading && !list.error && people.length === 0 && <p className={`${card} text-center text-xs text-ink-muted`}>Nobody matches those filters.</p>}
          <ul className="space-y-3">
            {people.map((p) => (
              <PersonRow key={`${p.id}:${p.role}:${p.status}:${p.firstName}:${p.lastName}`} person={p} self={p.id === user?.id} actorIsSuper={user?.role === "SUPER_ADMIN"} onSaved={list.reload} onNotice={setNotice} />
            ))}
          </ul>
          {list.data && list.data.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between text-xs text-ink-muted">
              <span>
                Page {list.data.pagination.page} of {list.data.pagination.totalPages}
              </span>
              <div className="flex gap-2">
                <button className={ghost} disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>
                  Previous
                </button>
                <button className={ghost} disabled={page >= list.data.pagination.totalPages} onClick={() => setPage((n) => n + 1)}>
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
