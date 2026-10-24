'use client';

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useAction, useApiData } from '@/hooks/useApiData';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { Banner } from '@/components/admin/IdentityPanels';
import { card, ghost, input, label, primary } from '@/components/assessments/ui';
import { useT, type Translator } from '@/lib/i18n';
import { BulkImport } from '@/components/admin/BulkImport';

const ROLES = ['SUPER_ADMIN', 'TENANT_ADMIN', 'INSTRUCTOR', 'TEACHING_ASSISTANT', 'STUDENT', 'PARENT_GUARDIAN', 'AUDITOR'] as const;
const STATUSES = ['ACTIVE', 'INVITED', 'LOCKED', 'SUSPENDED'] as const;
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
  ACTIVE: 'border-success/40 bg-success/10 text-success',
  INVITED: 'border-brand/40 bg-brand/15 text-brand-fg',
  LOCKED: 'border-accent/40 bg-accent/10 text-accent',
  SUSPENDED: 'border-danger/40 bg-danger/10 text-danger',
};

/** The browser's own short date (as before), in whatever time zone the administrator is in. */
const shortDate = (t: Translator, v: string) => t.date(v, { timeZone: undefined, day: 'numeric', month: 'short', year: 'numeric' });

const Enrollments: React.FC<{ userId: string }> = ({ userId }) => {
  const t = useT();
  const data = useApiData<{ data: PersonEnrollment[] }>(`/api/v1/users/${userId}/enrollments`);
  if (data.isLoading && !data.data) return <p className="text-[11px] text-ink-subtle">{t('people.row.loadingCourses')}</p>;
  if (data.error) return <p className="text-[11px] text-danger">{data.error}</p>;
  const rows = data.data?.data ?? [];
  if (rows.length === 0) return <p className="text-[11px] text-ink-subtle">{t('people.row.noCourses')}</p>;
  return (
    <ul className="space-y-1 text-[11px] text-ink-muted">
      {rows.map((e) => (
        <li key={e.id}>
          <span className="font-semibold text-ink">{e.course?.code ?? t('people.row.courseFallback')}</span> ·{' '}
          {t.dyn(`people.enrol.${e.status}`, label(e.status))} · {t.number(Math.round(e.progressPercent))}%
        </li>
      ))}
    </ul>
  );
};

type Notice = { kind: 'ok' | 'error'; text: string };

/** What to tell an administrator after an invitation was (or was not) emailed. */
const invitationNotice = (
  t: Translator,
  email: string,
  r: { invitationSent: boolean; emailConfigured: boolean },
  fresh: boolean
): Notice => {
  if (r.invitationSent) return { kind: 'ok', text: t(fresh ? 'people.invite.sentFresh' : 'people.invite.sentAgain', { email }) };
  if (!r.emailConfigured) return { kind: 'error', text: t(fresh ? 'people.invite.noEmailFresh' : 'people.invite.noEmailAgain', { email }) };
  return { kind: 'error', text: t(fresh ? 'people.invite.failFresh' : 'people.invite.failAgain', { email }) };
};

interface MinorStatus {
  isMinor: boolean;
  guardianEmail: string | null;
  guardianConsentAt: string | null;
  pendingRequestExpiresAt: string | null;
}

/**
 * Under-18 mark and guardian consent (DPDP Act s.9). The current state is loaded when the person is opened.
 */
const MinorControls: React.FC<{ person: Person; onNotice: (n: Notice) => void }> = ({ person, onNotice }) => {
  const t = useT();
  const { busy, error, run, clearError } = useAction();
  const [status, setStatus] = useState<MinorStatus | null>(null);
  const [email, setEmail] = useState('');
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const name = `${person.firstName} ${person.lastName}`;

  useEffect(() => {
    let live = true;
    api.get<{ data: MinorStatus }>(`/api/v1/privacy/users/${person.id}/minor`).then(
      (r) => live && setStatus(r.data),
      () => {}
    );
    return () => {
      live = false;
    };
  }, [person.id]);

  const setMinor = (isMinor: boolean) =>
    run(async () => {
      const r = await api.put<{ data: MinorStatus }>(`/api/v1/privacy/users/${person.id}/minor`, { isMinor });
      setStatus(r.data);
      onNotice({
        kind: 'ok',
        text: t(isMinor ? 'people.minor.markedNotice' : 'people.minor.clearedNotice', { name }),
      });
    });

  const ask = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await api.post<{ data: MinorStatus }>(`/api/v1/privacy/users/${person.id}/guardian-consent`, {
        guardianEmail: email.trim(),
      });
      setStatus(r.data);
      setEmail('');
      onNotice({ kind: 'ok', text: t('people.minor.consentSent', { name }) });
    });
  };

  return (
    <div className="space-y-2 border-t border-line pt-3" role="group" aria-label={t('people.minor.group', { name })}>
      <p className="text-xs font-bold text-ink">{t('people.minor.title')}</p>
      {error && <Banner kind="error">{error}</Banner>}
      {status && (
        <p className="text-[11px] text-ink-muted" role="status">
          {status.isMinor
            ? status.guardianConsentAt
              ? t('people.minor.consented', { date: shortDate(t, status.guardianConsentAt) })
              : status.guardianEmail
                ? status.pendingRequestExpiresAt
                  ? t('people.minor.outstandingAskedUntil', {
                      email: status.guardianEmail,
                      date: shortDate(t, status.pendingRequestExpiresAt),
                    })
                  : t('people.minor.outstandingAsked', { email: status.guardianEmail })
                : t('people.minor.outstanding')
            : t('people.minor.not')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          className={ghost}
          disabled={busy || status?.isMinor === true}
          onClick={() => {
            clearError();
            setMinor(true);
          }}
        >
          {t('people.minor.mark')}
        </button>
        <button
          className={ghost}
          disabled={busy || status?.isMinor === false}
          onClick={() => {
            clearError();
            setMinor(false);
          }}
        >
          {t('people.minor.clear')}
        </button>
      </div>
      {status?.isMinor && !status.guardianConsentAt && (
        <form onSubmit={ask} className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-xs font-semibold text-ink-muted">
            {t('people.minor.guardianEmail')}
            <input
              className={`${input} block w-64`}
              type="email"
              maxLength={320}
              value={email}
              onChange={(e) => {
                clearError();
                setEmail(e.target.value);
              }}
            />
          </label>
          <button className={primary} disabled={busy || !emailOk}>
            {busy ? t('people.minor.sending') : t('people.minor.ask')}
          </button>
        </form>
      )}
      <p className="text-[11px] text-ink-subtle">{t('people.minor.clearNote')}</p>
    </div>
  );
};

const PersonRow: React.FC<{ person: Person; self: boolean; actorIsSuper: boolean; onSaved: () => void; onNotice: (n: Notice) => void }> = ({
  person,
  self,
  actorIsSuper,
  onSaved,
  onNotice,
}) => {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [first, setFirst] = useState(person.firstName);
  const [last, setLast] = useState(person.lastName);
  const [role, setRole] = useState<Role>(person.role);
  const [status, setStatus] = useState<Status>(person.status);
  const [confirm, setConfirm] = useState(false);
  const { busy, error, run, clearError } = useAction();

  const lockedBySuper = person.role === 'SUPER_ADMIN' && !actorIsSuper;
  const roles = ROLES.filter((r) => r !== 'SUPER_ADMIN' || actorIsSuper || person.role === 'SUPER_ADMIN');
  const identityDirty = first.trim() !== person.firstName || last.trim() !== person.lastName;
  const accessDirty = role !== person.role || status !== person.status;
  const dirty = identityDirty || accessDirty;
  const cutsAccess = status !== person.status && (status === 'SUSPENDED' || status === 'LOCKED');
  const invalid = !first.trim() || !last.trim();
  const fullName = `${person.firstName} ${person.lastName}`;
  const roleName = (r: string) => t.dyn(`role.${r}`, label(r));
  const statusName = (s: string) => t.dyn(`people.status.${s}`, label(s));

  const resend = () =>
    run(async () => {
      const r = await api.post<{ data: { invitationSent: boolean; emailConfigured: boolean } }>(`/api/v1/users/${person.id}/invite`, {});
      onNotice(invitationNotice(t, person.email, r.data, false));
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
            {self && <span className="text-[10px] font-bold text-ink-subtle">{t('people.row.you')}</span>}
            <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[10px] font-bold text-ink">
              {roleName(person.role)}
            </span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[person.status]}`}>
              {statusName(person.status)}
            </span>
            {person.mfaEnabled && <span className="text-[10px] font-semibold text-success">{t('people.row.twoFactor')}</span>}
          </div>
          <p className="text-[11px] text-ink-muted">
            {person.email} · {t.plural('people.row.enrolments', person.enrollmentCount, { count: t.number(person.enrollmentCount) })}
            {person.teachingCourseCount > 0 ? ` · ${t('people.row.teaches', { count: t.number(person.teachingCourseCount) })}` : ''} ·{' '}
            {person.lastLoginAt ? t('people.row.lastSignedIn', { date: shortDate(t, person.lastLoginAt) }) : t('people.row.neverSignedIn')}
          </p>
        </div>
        <div className="flex gap-2">
          {person.status === 'INVITED' && (
            <button className={ghost} disabled={busy} onClick={resend} aria-label={t('people.row.resendAria', { name: fullName })}>
              {t('people.row.resend')}
            </button>
          )}
          <button
            className={ghost}
            onClick={() => {
              clearError();
              setOpen((o) => !o);
            }}
            aria-expanded={open}
            aria-label={t(open ? 'people.row.closeAria' : 'people.row.editAria', { name: fullName })}
          >
            {open ? t('people.row.close') : t('people.row.edit')}
          </button>
        </div>
      </div>
      {!open && error && (
        <div className="mt-3">
          <Banner kind="error">{error}</Banner>
        </div>
      )}

      {open && (
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          {error && <Banner kind="error">{error}</Banner>}
          {lockedBySuper ? (
            <p className="text-xs text-ink-muted">{t('people.row.superOnly')}</p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="space-y-1 text-xs font-semibold text-ink-muted">
                  {t('people.row.firstName')}
                  <input className={`${input} w-full`} maxLength={100} value={first} onChange={(e) => setFirst(e.target.value)} />
                </label>
                <label className="space-y-1 text-xs font-semibold text-ink-muted">
                  {t('people.row.lastName')}
                  <input className={`${input} w-full`} maxLength={100} value={last} onChange={(e) => setLast(e.target.value)} />
                </label>
                <label className="space-y-1 text-xs font-semibold text-ink-muted">
                  {t('people.row.role')}
                  <select className={`${input} w-full`} value={role} disabled={self} onChange={(e) => setRole(e.target.value as Role)}>
                    {roles.map((r) => (
                      <option key={r} value={r}>
                        {roleName(r)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-xs font-semibold text-ink-muted">
                  {t('people.row.accountStatus')}
                  <select
                    className={`${input} w-full`}
                    value={status}
                    disabled={self}
                    onChange={(e) => {
                      setStatus(e.target.value as Status);
                      setConfirm(false);
                    }}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {statusName(s)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {self && <p className="text-[11px] text-ink-subtle">{t('people.row.selfNote')}</p>}
              {accessDirty && !cutsAccess && <p className="text-[11px] text-ink-subtle">{t('people.row.nextSignIn')}</p>}

              {cutsAccess && confirm ? (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2.5 text-xs">
                  <span className="text-ink">{t('people.row.confirmCut', { status: statusName(status), name: person.firstName })}</span>
                  <button
                    className="rounded-lg bg-danger px-3 py-1.5 text-[11px] font-bold text-on-brand disabled:opacity-50"
                    disabled={busy}
                    onClick={save}
                  >
                    {busy ? t('people.row.saving') : t('people.row.confirmButton', { status: statusName(status) })}
                  </button>
                  <button className={ghost} onClick={() => setConfirm(false)}>
                    {t('people.row.cancel')}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <button className={primary} disabled={busy || !dirty || invalid} onClick={() => (cutsAccess ? setConfirm(true) : save())}>
                    {busy ? t('people.row.saving') : t('people.row.save')}
                  </button>
                  {invalid && <span className="text-[11px] text-accent">{t('people.row.namesRequired')}</span>}
                </div>
              )}
            </>
          )}

          {!lockedBySuper && !self && <MinorControls person={person} onNotice={onNotice} />}

          <div className="space-y-1">
            <p className="text-xs font-bold text-ink">{t('people.row.courses')}</p>
            <Enrollments userId={person.id} />
          </div>
        </div>
      )}
    </li>
  );
};

const InviteForm: React.FC<{ actorIsSuper: boolean; onDone: (n: Notice) => void; onCancel: () => void }> = ({
  actorIsSuper,
  onDone,
  onCancel,
}) => {
  const t = useT();
  const [email, setEmail] = useState('');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [role, setRole] = useState<Role>('STUDENT');
  const { busy, error, run, clearError } = useAction();
  const roles = ROLES.filter((r) => r !== 'SUPER_ADMIN' || actorIsSuper);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const ready = emailOk && first.trim() && last.trim();

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await api.post<{ invitationSent: boolean; emailConfigured: boolean }>('/api/v1/users', {
        email: email.trim(),
        firstName: first.trim(),
        lastName: last.trim(),
        role,
      });
      onDone(invitationNotice(t, email.trim().toLowerCase(), r, true));
    });
  };

  return (
    <form onSubmit={send} className="space-y-3 rounded-2xl border border-brand/40 bg-surface p-4">
      <h4 className="text-sm font-bold text-ink">{t('people.invite.title')}</h4>
      {error && <Banner kind="error">{error}</Banner>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="space-y-1 text-xs font-semibold text-ink-muted md:col-span-2">
          {t('people.invite.email')}
          <input
            className={`${input} w-full`}
            type="email"
            maxLength={254}
            value={email}
            onChange={(e) => {
              clearError();
              setEmail(e.target.value);
            }}
          />
        </label>
        <label className="space-y-1 text-xs font-semibold text-ink-muted">
          {t('people.row.firstName')}
          <input className={`${input} w-full`} maxLength={100} value={first} onChange={(e) => setFirst(e.target.value)} />
        </label>
        <label className="space-y-1 text-xs font-semibold text-ink-muted">
          {t('people.row.lastName')}
          <input className={`${input} w-full`} maxLength={100} value={last} onChange={(e) => setLast(e.target.value)} />
        </label>
        <label className="space-y-1 text-xs font-semibold text-ink-muted">
          {t('people.row.role')}
          <select className={`${input} w-full`} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {t.dyn(`role.${r}`, label(r))}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-[11px] text-ink-subtle">{t('people.invite.note')}</p>
      <div className="flex items-center gap-3">
        <button className={primary} disabled={busy || !ready}>
          {busy ? t('people.invite.sending') : t('people.invite.send')}
        </button>
        <button type="button" className={ghost} onClick={onCancel}>
          {t('people.invite.cancel')}
        </button>
      </div>
    </form>
  );
};

/** Everyone in the organisation: find people, fix names, change roles and suspend or restore accounts. */
export const UserManager: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  useEscapeKey(onClose);
  const t = useT();
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [inviting, setInviting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  const list = useApiData<{ data: Person[]; pagination: { page: number; totalPages: number; total: number } }>('/api/v1/users', {
    page,
    limit: 15,
    search: search || undefined,
    role: role || undefined,
    status: status || undefined,
  });
  const people = list.data?.data ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/85 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={t('people.users.title')}
    >
      <div className="flex h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-line bg-canvas px-6 py-4">
          <div>
            <h3 className="text-base font-bold text-ink">{t('people.users.title')}</h3>
            <p className="text-xs text-ink-muted">{t('people.users.intro')}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => {
                setNotice(null);
                setImporting(false);
                setInviting(true);
              }}
              className={primary}
              aria-label={t('people.users.invite')}
            >
              {t('people.users.invitePlus')}
            </button>
            <button
              onClick={() => {
                setNotice(null);
                setInviting(false);
                setImporting(true);
              }}
              className={ghost}
            >
              {t('people.users.importCsv')}
            </button>
          </div>
          <button
            onClick={onClose}
            aria-label={t('people.users.close')}
            className="rounded-xl p-1 text-ink-muted transition-colors hover:bg-raised hover:text-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div role="search" className="flex flex-wrap items-center gap-2 border-b border-line bg-canvas/60 px-6 py-3">
          <input
            className={`${input} w-64`}
            aria-label={t('people.users.searchLabel')}
            placeholder={t('people.users.searchPlaceholder')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            className={input}
            aria-label={t('people.users.filterRole')}
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('people.users.allRoles')}</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t.dyn(`role.${r}`, label(r))}
              </option>
            ))}
          </select>
          <select
            className={input}
            aria-label={t('people.users.filterStatus')}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('people.users.allStatuses')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t.dyn(`people.status.${s}`, label(s))}
              </option>
            ))}
          </select>
          {list.data && (
            <span className="ml-auto text-[11px] text-ink-subtle">
              {t.plural('people.users.total', list.data.pagination.total, { count: t.number(list.data.pagination.total) })}
            </span>
          )}
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-6">
          {notice && <Banner kind={notice.kind}>{notice.text}</Banner>}
          {importing && (
            <BulkImport
              onCancel={() => setImporting(false)}
              onDone={(text) => {
                setNotice({ kind: 'ok', text });
                setImporting(false);
                setPage(1);
                list.reload();
              }}
            />
          )}
          {inviting && (
            <InviteForm
              actorIsSuper={user?.role === 'SUPER_ADMIN'}
              onCancel={() => setInviting(false)}
              onDone={(n) => {
                setNotice(n);
                setInviting(false);
                setSearch('');
                setQ('');
                setPage(1);
                list.reload();
              }}
            />
          )}
          {list.error && <Banner kind="error">{list.error}</Banner>}
          {list.isLoading && !list.data && <p className="text-xs text-ink-subtle">{t('people.users.loading')}</p>}
          {!list.isLoading && !list.error && people.length === 0 && (
            <p className={`${card} text-center text-xs text-ink-muted`}>{t('people.users.empty')}</p>
          )}
          <ul className="space-y-3">
            {people.map((p) => (
              <PersonRow
                key={`${p.id}:${p.role}:${p.status}:${p.firstName}:${p.lastName}`}
                person={p}
                self={p.id === user?.id}
                actorIsSuper={user?.role === 'SUPER_ADMIN'}
                onSaved={list.reload}
                onNotice={setNotice}
              />
            ))}
          </ul>
          {list.data && list.data.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between text-xs text-ink-muted">
              <span>
                {t('people.users.page', { page: t.number(list.data.pagination.page), pages: t.number(list.data.pagination.totalPages) })}
              </span>
              <div className="flex gap-2">
                <button className={ghost} disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>
                  {t('people.users.previous')}
                </button>
                <button className={ghost} disabled={page >= list.data.pagination.totalPages} onClick={() => setPage((n) => n + 1)}>
                  {t('people.users.next')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
