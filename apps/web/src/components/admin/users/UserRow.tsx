'use client';

import React, { useState } from 'react';
import { api } from '@/lib/api';
import { useAction } from '@/hooks/useApiData';
import { useT } from '@/lib/i18n';
import { Badge, Button, Input, Select, cardClasses } from '@/components/ui';
import { Banner } from '@/components/admin/identity/Banner';
import { MinorControls } from './MinorControls';
import { UserEnrollments } from './UserEnrollments';
import {
  ROLES,
  STATUSES,
  STATUS_TONE,
  formatEnumLabel,
  invitationNotice,
  shortDate,
  type Notice,
  type Person,
  type Role,
  type Status,
} from './shared';

export const UserRow: React.FC<{
  person: Person;
  self: boolean;
  actorIsSuper: boolean;
  onSaved: () => void;
  onNotice: (n: Notice) => void;
}> = ({ person, self, actorIsSuper, onSaved, onNotice }) => {
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
  const roleName = (r: string) => t.dyn(`role.${r}`, formatEnumLabel(r));
  const statusName = (s: string) => t.dyn(`people.status.${s}`, formatEnumLabel(s));

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
    <li className={cardClasses()}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-sm text-ink">
              {person.firstName} {person.lastName}
            </strong>
            {self && <span className="text-[10px] font-bold text-ink-subtle">{t('people.row.you')}</span>}
            <Badge tone="surface">{roleName(person.role)}</Badge>
            <Badge tone={STATUS_TONE[person.status]}>{statusName(person.status)}</Badge>
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
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={resend}
              aria-label={t('people.row.resendAria', { name: fullName })}
            >
              {t('people.row.resend')}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              clearError();
              setOpen((o) => !o);
            }}
            aria-expanded={open}
            aria-label={t(open ? 'people.row.closeAria' : 'people.row.editAria', { name: fullName })}
          >
            {open ? t('people.row.close') : t('people.row.edit')}
          </Button>
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
                  <Input maxLength={100} value={first} onChange={(e) => setFirst(e.target.value)} />
                </label>
                <label className="space-y-1 text-xs font-semibold text-ink-muted">
                  {t('people.row.lastName')}
                  <Input maxLength={100} value={last} onChange={(e) => setLast(e.target.value)} />
                </label>
                <label className="space-y-1 text-xs font-semibold text-ink-muted">
                  {t('people.row.role')}
                  <Select value={role} disabled={self} onChange={(e) => setRole(e.target.value as Role)}>
                    {roles.map((r) => (
                      <option key={r} value={r}>
                        {roleName(r)}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="space-y-1 text-xs font-semibold text-ink-muted">
                  {t('people.row.accountStatus')}
                  <Select
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
                  </Select>
                </label>
              </div>
              {self && <p className="text-[11px] text-ink-subtle">{t('people.row.selfNote')}</p>}
              {accessDirty && !cutsAccess && <p className="text-[11px] text-ink-subtle">{t('people.row.nextSignIn')}</p>}

              {cutsAccess && confirm ? (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2.5 text-xs">
                  <span className="text-ink">{t('people.row.confirmCut', { status: statusName(status), name: person.firstName })}</span>
                  <Button type="button" variant="danger" size="sm" disabled={busy} onClick={save}>
                    {busy ? t('people.row.saving') : t('people.row.confirmButton', { status: statusName(status) })}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setConfirm(false)}>
                    {t('people.row.cancel')}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <Button type="button" disabled={busy || !dirty || invalid} onClick={() => (cutsAccess ? setConfirm(true) : save())}>
                    {busy ? t('people.row.saving') : t('people.row.save')}
                  </Button>
                  {invalid && <span className="text-[11px] text-accent">{t('people.row.namesRequired')}</span>}
                </div>
              )}
            </>
          )}

          {!lockedBySuper && !self && <MinorControls person={person} onNotice={onNotice} />}

          <div className="space-y-1">
            <p className="text-xs font-bold text-ink">{t('people.row.courses')}</p>
            <UserEnrollments userId={person.id} />
          </div>
        </div>
      )}
    </li>
  );
};
