'use client';

import React, { useState } from 'react';
import { Download, Search, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useApiData, downloadFile } from '@/hooks/useApiData';
import { useAuth } from '@/context/AuthContext';
import { Banner } from '@/components/admin/IdentityPanels';
import { useT } from '@/lib/i18n';

const input =
  'w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand';
const ghostBtn =
  'px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50 inline-flex items-center gap-1.5';

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
 * themselves from "Security & privacy" in the sidebar.
 */
export const PrivacyPanel: React.FC = () => {
  const t = useT();
  const { user: me } = useAuth();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<string | null>(null);
  const results = useApiData<{ data: TenantUser[] }>(search === null ? null : '/api/v1/users', { search: search ?? undefined, limit: 10 });
  const { busy, error, run } = useAction();
  const [done, setDone] = useState<{ kind: 'export' | 'erase'; email: string } | null>(null);
  const [erasing, setErasing] = useState<TenantUser | null>(null);
  const [confirm, setConfirm] = useState('');

  const exportFor = (u: TenantUser) =>
    run(async () => {
      setDone(null);
      await downloadFile(`/api/v1/privacy/users/${u.id}/export`, `personal-data-${u.id}.json`);
      setDone({ kind: 'export', email: u.email });
    });

  const eraseFor = (u: TenantUser) =>
    run(async () => {
      setDone(null);
      await api.post(`/api/v1/privacy/users/${u.id}/erase`);
      setErasing(null);
      setConfirm('');
      setDone({ kind: 'erase', email: u.email });
      await results.reload();
    });

  return (
    <section className="space-y-5" aria-labelledby="dsar-h">
      <div>
        <h3 id="dsar-h" className="font-bold text-base text-ink">
          {t('comply.priv.title')}
        </h3>
        <p className="text-xs text-ink-muted">{t('comply.priv.intro')}</p>
      </div>

      <form
        role="search"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(query.trim());
        }}
      >
        <input
          className={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('comply.priv.searchPlaceholder')}
          aria-label={t('comply.priv.searchLabel')}
          maxLength={100}
        />
        <button
          type="submit"
          className="px-4 py-2 bg-brand hover:bg-brand-hover text-on-brand rounded-xl text-xs font-bold inline-flex items-center gap-1.5"
        >
          <Search className="h-3.5 w-3.5" /> {t('comply.priv.find')}
        </button>
      </form>

      {(results.error || error) && <Banner kind="error">{results.error || error}</Banner>}
      {done && (
        <Banner kind="ok">{t(done.kind === 'export' ? 'comply.priv.exported' : 'comply.priv.erased', { email: done.email })}</Banner>
      )}
      {results.isLoading && <p className="text-xs text-ink-subtle">{t('comply.priv.searching')}</p>}
      {results.data && results.data.data.length === 0 && <p className="text-xs text-ink-subtle">{t('comply.priv.nobody')}</p>}

      {results.data && results.data.data.length > 0 && (
        <ul className="divide-y divide-line border border-line rounded-2xl overflow-hidden">
          {results.data.data.map((u) => {
            const isSelf = u.id === me?.id;
            return (
              <li key={u.id} className="p-3 bg-canvas space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-ink truncate">
                      {u.firstName} {u.lastName}
                    </div>
                    <div className="text-[11px] text-ink-subtle truncate">
                      {u.email} · {t.dyn(`comply.priv.role.${u.role}`, u.role.replace(/_/g, ' ').toLowerCase())} ·{' '}
                      {t.dyn(`comply.priv.status.${u.status}`, u.status.toLowerCase())}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button className={ghostBtn} disabled={busy} onClick={() => exportFor(u)}>
                      <Download className="h-3.5 w-3.5" /> {t('comply.priv.export')}
                    </button>
                    <button
                      className={`${ghostBtn} hover:text-danger hover:border-danger/30`}
                      disabled={busy || isSelf}
                      title={isSelf ? t('comply.priv.selfTitle') : undefined}
                      onClick={() => {
                        setErasing(erasing?.id === u.id ? null : u);
                        setConfirm('');
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> {t('comply.priv.erase')}
                    </button>
                  </div>
                </div>

                {erasing?.id === u.id && (
                  <div className="p-3 rounded-xl border border-danger/30 bg-danger/10 space-y-2">
                    <p className="text-[11px] text-danger">{t('comply.priv.eraseWarn', { email: u.email })}</p>
                    <div className="flex gap-2">
                      <input
                        className={input}
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        placeholder={u.email}
                        aria-label={t('comply.priv.confirmLabel', { email: u.email })}
                      />
                      <button
                        className="px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-on-brand rounded-xl text-xs font-bold shrink-0"
                        disabled={busy || confirm.trim().toLowerCase() !== u.email.toLowerCase()}
                        onClick={() => eraseFor(u)}
                      >
                        {busy ? t('comply.priv.erasing') : t('comply.priv.erase')}
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
