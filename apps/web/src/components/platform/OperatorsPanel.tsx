'use client';

import React, { useState } from 'react';
import { UserPlus, Mail, Calendar } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useApiData, useAction } from '@/hooks/useApiData';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Banner } from '@/components/admin/IdentityPanels';

interface OperatorUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export const OperatorsPanel: React.FC = () => {
  const t = useT();
  const { user } = useAuth();
  const list = useApiData<{ data: OperatorUser[] }>('/api/v1/users', { role: 'SUPER_ADMIN' });
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const { busy, error, run, clearError } = useAction();

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setNotice(null);

    await run(async () => {
      await api.post('/api/v1/users/invite', {
        email: email.trim().toLowerCase(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        role: 'SUPER_ADMIN',
      });
      setNotice({ kind: 'ok', text: `Invitation sent to ${email.trim()}` });
      setEmail('');
      setFirstName('');
      setLastName('');
      setInviting(false);
      list.reload();
    });
  };

  const operators = list.data?.data ?? [];

  return (
    <section className="space-y-6" aria-labelledby="operators-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="operators-title" className="text-xl font-bold text-ink">
            {t('nav.item.platform.operators')}
          </h2>
          <p className="text-xs text-ink-muted">
            Platform administrators with super administrator privileges across the platform operator organisation.
          </p>
        </div>
        {!inviting && (
          <button
            type="button"
            onClick={() => {
              setNotice(null);
              setInviting(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-3.5 py-2 text-xs font-bold text-on-brand shadow-sm hover:bg-brand-hover transition-colors"
          >
            <UserPlus className="h-4 w-4" />
            <span>Invite operator</span>
          </button>
        )}
      </div>

      {notice && <Banner kind={notice.kind}>{notice.text}</Banner>}
      {error && <Banner kind="error">{error}</Banner>}

      {inviting && (
        <form onSubmit={handleInvite} className="rounded-2xl border border-line bg-surface p-6 space-y-4 shadow-lg">
          <div className="flex items-center justify-between border-b border-line pb-3">
            <h3 className="font-bold text-sm text-ink">Invite platform operator</h3>
            <span className="text-[11px] font-semibold text-brand-fg bg-brand/10 px-2 py-0.5 rounded-md border border-brand/20">
              Super Administrator
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="op-first-name" className="text-xs font-semibold text-ink">First name</label>
              <input
                id="op-first-name"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name"
                className="w-full rounded-xl border border-line bg-canvas px-3 py-2 text-xs text-ink focus:border-brand focus:outline-none"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="op-last-name" className="text-xs font-semibold text-ink">Last name</label>
              <input
                id="op-last-name"
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Last name"
                className="w-full rounded-xl border border-line bg-canvas px-3 py-2 text-xs text-ink focus:border-brand focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="op-email" className="text-xs font-semibold text-ink">Institutional / Operator Email</label>
            <input
              id="op-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operator@platform.com"
              className="w-full rounded-xl border border-line bg-canvas px-3 py-2 text-xs text-ink focus:border-brand focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setInviting(false)}
              className="rounded-xl border border-line bg-canvas px-3.5 py-2 text-xs font-semibold text-ink hover:bg-raised transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-xl bg-brand px-4 py-2 text-xs font-bold text-on-brand hover:bg-brand-hover transition-colors disabled:opacity-50"
            >
              {busy ? 'Sending invite…' : 'Send invitation'}
            </button>
          </div>
        </form>
      )}

      <div className="rounded-3xl border border-line bg-surface overflow-hidden shadow-xl">
        <div className="border-b border-line bg-canvas/60 px-6 py-3 flex items-center justify-between text-xs text-ink-muted">
          <span className="font-semibold">Active team members</span>
          <span>{operators.length} operators</span>
        </div>

        {list.isLoading && !list.data && (
          <div className="p-8 text-center text-xs text-ink-subtle">Loading operator team…</div>
        )}

        {!list.isLoading && operators.length === 0 && (
          <div className="p-8 text-center text-xs text-ink-muted">No operators found.</div>
        )}

        <ul className="divide-y divide-line">
          {operators.map((op) => (
            <li key={op.id} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-canvas/40 transition-colors">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-10 w-10 shrink-0 rounded-2xl bg-orchid/15 border border-orchid/40 text-orchid font-bold flex items-center justify-center text-xs">
                  {op.firstName[0]?.toUpperCase()}{op.lastName[0]?.toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-ink truncate">
                      {op.firstName} {op.lastName}
                    </span>
                    {op.id === user?.id && (
                      <span className="text-[10px] bg-brand/10 text-brand-fg border border-brand/20 px-1.5 py-0.5 rounded-full font-semibold">
                        You
                      </span>
                    )}
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-orchid/10 text-orchid border border-orchid/30">
                      Super Admin
                    </span>
                  </div>
                  <div className="text-xs text-ink-muted flex items-center gap-1.5 mt-0.5">
                    <Mail className="h-3.5 w-3.5 text-ink-subtle shrink-0" />
                    <span className="truncate">{op.email}</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs text-ink-muted">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      op.status === 'ACTIVE' ? 'bg-success' : 'bg-accent'
                    }`}
                  />
                  <span className="font-medium text-ink capitalize">{op.status.toLowerCase()}</span>
                </div>

                {op.lastLoginAt && (
                  <div className="text-[11px] text-ink-subtle flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    <span>Last active: {new Date(op.lastLoginAt).toLocaleDateString()}</span>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};
