'use client';

import React, { useState } from 'react';
import { api } from '@/lib/api';
import { useAction } from '@/hooks/useApiData';
import { useT } from '@/lib/i18n';
import { Button, Input, Select, cardClasses } from '@/components/ui';
import { Banner } from '@/components/admin/identity/Banner';
import { ROLES, formatEnumLabel, invitationNotice, type Notice, type Role } from './shared';

export const InviteUserForm: React.FC<{ actorIsSuper: boolean; onDone: (n: Notice) => void; onCancel: () => void }> = ({
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
    <form onSubmit={send} className={cardClasses({ variant: 'surface', className: 'space-y-3 border-brand/40' })}>
      <h4 className="text-sm font-bold text-ink">{t('people.invite.title')}</h4>
      {error && <Banner kind="error">{error}</Banner>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="space-y-1 text-xs font-semibold text-ink-muted md:col-span-2">
          {t('people.invite.email')}
          <Input
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
          <Input maxLength={100} value={first} onChange={(e) => setFirst(e.target.value)} />
        </label>
        <label className="space-y-1 text-xs font-semibold text-ink-muted">
          {t('people.row.lastName')}
          <Input maxLength={100} value={last} onChange={(e) => setLast(e.target.value)} />
        </label>
        <label className="space-y-1 text-xs font-semibold text-ink-muted">
          {t('people.row.role')}
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {t.dyn(`role.${r}`, formatEnumLabel(r))}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <p className="text-[11px] text-ink-subtle">{t('people.invite.note')}</p>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy || !ready}>
          {busy ? t('people.invite.sending') : t('people.invite.send')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t('people.invite.cancel')}
        </Button>
      </div>
    </form>
  );
};
