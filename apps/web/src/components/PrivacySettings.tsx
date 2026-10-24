'use client';

import React, { useState } from 'react';
import { X, ShieldCheck, Download, EyeOff, Trash2, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useApiData, downloadFile } from '@/hooks/useApiData';
import { useAuth } from '@/context/AuthContext';
import { Banner } from '@/components/admin/IdentityPanels';
import { MfaSettings } from '@/components/MfaSettings';
import { MyDataRequests } from '@/components/MyDataRequests';
import { ConsentsAndMinor } from '@/components/PrivacyConsents';
import { useT } from '@/lib/i18n';
import { useEscapeKey } from '@/hooks/useEscapeKey';

const card = 'bg-canvas border border-line rounded-2xl p-5 space-y-3';
const input =
  'w-full bg-surface border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand';

/**
 * The signed-in person's own data rights (GDPR Art. 15/17/20, FERPA directory opt-out),
 * backed by /api/v1/privacy/me/*. Every action is written to the audit trail by the API.
 */
export const PrivacySettings: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  useEscapeKey(onClose);
  const { user, logout } = useAuth();
  const t = useT();
  const directory = useApiData<{ data: { optOut: boolean } }>('/api/v1/privacy/me/directory');
  const exportAction = useAction();
  const directoryAction = useAction();
  const eraseAction = useAction();
  const [exported, setExported] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [password, setPassword] = useState('');

  const optOut = directory.data?.data.optOut ?? false;
  const emailMatches = !!user && confirmEmail.trim().toLowerCase() === user.email.toLowerCase();

  const downloadMyData = () =>
    exportAction.run(async () => {
      await downloadFile('/api/v1/privacy/me/export', `personal-data-${user?.id ?? 'me'}.json`);
      setExported(true);
    });

  const toggleDirectory = () =>
    directoryAction.run(async () => {
      await api.put('/api/v1/privacy/me/directory', { optOut: !optOut });
      await directory.reload();
    });

  const eraseAccount = () =>
    eraseAction.run(async () => {
      await api.post('/api/v1/privacy/me/erase', { confirmEmail: confirmEmail.trim(), password: password || undefined });
      // The API has already revoked every session; this clears local state and leaves the portal.
      await logout();
    });

  return (
    <div
      className="fixed inset-0 z-50 bg-canvas/85 backdrop-blur-md flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-h"
    >
      <div className="bg-surface border border-line rounded-3xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="border-b border-line px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-success/20 border border-success/30 flex items-center justify-center text-success">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h3 id="privacy-h" className="font-bold text-base text-ink">
                {t('privacy.title')}
              </h3>
              <p className="text-xs text-ink-muted">{t('privacy.subtitle')}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="p-1 rounded-xl hover:bg-raised text-ink-muted hover:text-ink transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <MfaSettings />

          {/* Access and portability */}
          <section className={card} aria-labelledby="export-h">
            <div className="flex items-center gap-2">
              <Download className="h-4 w-4 text-brand-fg" />
              <h4 id="export-h" className="text-sm font-bold text-ink">
                {t('privacy.export.title')}
              </h4>
            </div>
            <p className="text-xs text-ink-muted leading-relaxed">{t('privacy.export.body')}</p>
            {exportAction.error && <Banner kind="error">{exportAction.error}</Banner>}
            {exported && !exportAction.error && <Banner kind="ok">{t('privacy.export.done')}</Banner>}
            <button
              onClick={downloadMyData}
              disabled={exportAction.busy}
              className="px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold transition-all"
            >
              {exportAction.busy ? t('privacy.export.busy') : t('privacy.export.button')}
            </button>
          </section>

          <ConsentsAndMinor />

          <MyDataRequests />

          {/* FERPA directory opt-out */}
          <section className={card} aria-labelledby="dir-h">
            <div className="flex items-center gap-2">
              <EyeOff className="h-4 w-4 text-accent" />
              <h4 id="dir-h" className="text-sm font-bold text-ink">
                {t('privacy.directory.title')}
              </h4>
            </div>
            <p className="text-xs text-ink-muted leading-relaxed">{t('privacy.directory.body')}</p>
            {(directory.error || directoryAction.error) && <Banner kind="error">{directory.error || directoryAction.error}</Banner>}
            <label className="flex items-center justify-between p-3 rounded-xl bg-surface border border-line cursor-pointer">
              <span className="text-xs text-ink">{optOut ? t('privacy.directory.hidden') : t('privacy.directory.visible')}</span>
              <input
                type="checkbox"
                role="switch"
                checked={optOut}
                disabled={directory.isLoading || directoryAction.busy || !directory.data}
                onChange={toggleDirectory}
                className="h-4 w-4 accent-success"
              />
            </label>
          </section>

          {/* Erasure */}
          <section className="bg-canvas border border-danger/30 rounded-2xl p-5 space-y-3" aria-labelledby="erase-h">
            <div className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-danger" />
              <h4 id="erase-h" className="text-sm font-bold text-ink">
                {t('privacy.erase.title')}
              </h4>
            </div>
            <p className="text-xs text-ink-muted leading-relaxed">{t('privacy.erase.body')}</p>
            <div className="flex items-start gap-2 p-3 rounded-xl bg-danger/10 border border-danger/30 text-[11px] text-danger">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{t('privacy.erase.warning')}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-[11px] text-ink-muted">{t('privacy.erase.confirmEmail')}</span>
                <input
                  className={input}
                  type="email"
                  autoComplete="off"
                  value={confirmEmail}
                  onChange={(e) => setConfirmEmail(e.target.value)}
                  placeholder={user?.email}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-ink-muted">{t('privacy.erase.password')}</span>
                <input
                  className={input}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            </div>
            {eraseAction.error && <Banner kind="error">{eraseAction.error}</Banner>}
            <button
              onClick={eraseAccount}
              disabled={!emailMatches || eraseAction.busy}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-on-brand rounded-xl text-xs font-bold transition-all"
            >
              {eraseAction.busy ? t('privacy.erase.busy') : t('privacy.erase.title')}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
};
