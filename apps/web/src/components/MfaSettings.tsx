'use client';

import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { KeyRound, ShieldCheck, Copy } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { Banner } from '@/components/admin/IdentityPanels';
import { useT } from '@/lib/i18n';

const card = 'bg-canvas border border-line rounded-2xl p-5 space-y-3';
const input =
  'w-full bg-surface border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand';
const primaryBtn = 'px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold';
const ghostBtn =
  'px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold disabled:opacity-50';

interface Status {
  enabled: boolean;
  recoveryCodesRemaining: number;
  hasPassword: boolean;
}

/**
 * Two-step sign-in with an authenticator app (TOTP), on /api/v1/auth/mfa. Setup is two steps, so a wrongly
 * scanned code can never lock anyone out: scan, then prove the app works. Recovery codes are shown once.
 */
export const MfaSettings: React.FC = () => {
  const t = useT();
  const { data, reload } = useApiData<{ data: Status }>('/api/v1/auth/mfa/status');
  const { busy, error, run, clearError } = useAction();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [password, setPassword] = useState('');
  const status = data?.data;

  useEffect(() => {
    if (!setup) return setQr(null);
    QRCode.toDataURL(setup.otpauthUrl, { margin: 1, width: 176 }).then(setQr, () => setQr(null));
  }, [setup]);

  const start = () =>
    run(async () => {
      const r = await api.post<{ data: { secret: string; otpauthUrl: string } }>('/api/v1/auth/mfa/setup', {});
      setSetup(r.data);
      setCode('');
    });

  const confirm = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await api.post<{ data: { recoveryCodes: string[] } }>('/api/v1/auth/mfa/enable', { code: code.trim() });
      setRecoveryCodes(r.data.recoveryCodes);
      setSetup(null);
      setCode('');
      await reload();
    });
  };

  const disable = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api.post('/api/v1/auth/mfa/disable', { password, code: code.trim() });
      setDisabling(false);
      setPassword('');
      setCode('');
      setRecoveryCodes(null);
      await reload();
    });
  };

  if (!status) return null;

  return (
    <div className={card}>
      <div className="flex items-center gap-2 text-sm font-bold text-ink">
        <KeyRound className="h-4 w-4 text-brand-fg" />
        {t('privacy.mfa.title')}
      </div>

      {!status.hasPassword ? (
        <p className="text-xs text-ink-muted">{t('privacy.mfa.sso')}</p>
      ) : (
        <>
          <p className="text-xs text-ink-muted">
            {status.enabled
              ? `${t('privacy.mfa.on')} ${t.plural('privacy.mfa.recoveryLeft', status.recoveryCodesRemaining)}`
              : t('privacy.mfa.off')}
          </p>
          {error && <Banner kind="error">{error}</Banner>}

          {recoveryCodes && (
            <div className="rounded-xl border border-accent/40 bg-accent/10 p-3 space-y-2">
              <p className="text-xs font-semibold text-ink">{t('privacy.mfa.saveCodes')}</p>
              <ul className="grid grid-cols-2 gap-1 font-mono text-xs text-ink">
                {recoveryCodes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <button type="button" className={ghostBtn} onClick={() => navigator.clipboard?.writeText(recoveryCodes.join('\n'))}>
                <Copy className="h-3 w-3 inline mr-1" />
                {t('privacy.mfa.copyCodes')}
              </button>
            </div>
          )}

          {!status.enabled && !setup && (
            <button className={primaryBtn} onClick={start} disabled={busy}>
              {t('privacy.mfa.turnOn')}
            </button>
          )}

          {setup && (
            <form onSubmit={confirm} className="space-y-3">
              <ol className="list-decimal list-inside space-y-1 text-xs text-ink">
                <li>{t('privacy.mfa.step1')}</li>
                <li>{t('privacy.mfa.step2')}</li>
              </ol>
              <div className="flex flex-wrap items-center gap-4">
                {qr && <img src={qr} alt={t('privacy.mfa.qrAlt')} width={176} height={176} className="rounded-lg bg-white p-1" />}
                <div className="space-y-1">
                  <div className="text-[11px] text-ink-subtle">{t('privacy.mfa.key')}</div>
                  <code className="block break-all font-mono text-xs text-ink">{setup.secret}</code>
                </div>
              </div>
              <div className="flex items-end gap-2 max-w-xs">
                <input
                  className={input}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  value={code}
                  onChange={(e) => {
                    clearError();
                    setCode(e.target.value.replace(/\D/g, ''));
                  }}
                  placeholder="123456"
                  aria-label={t('privacy.mfa.codeLabel')}
                />
                <button className={primaryBtn} disabled={busy || code.length !== 6}>
                  {t('privacy.mfa.confirm')}
                </button>
              </div>
              <button type="button" className={ghostBtn} onClick={() => setSetup(null)}>
                {t('privacy.mfa.cancel')}
              </button>
            </form>
          )}

          {status.enabled && !disabling && (
            <button className={ghostBtn} onClick={() => setDisabling(true)}>
              {t('privacy.mfa.turnOff')}
            </button>
          )}
          {status.enabled && disabling && (
            <form onSubmit={disable} className="space-y-2 max-w-sm">
              <p className="text-xs text-ink-muted">{t('privacy.mfa.disableHelp')}</p>
              <input
                className={input}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('privacy.mfa.password')}
                aria-label={t('privacy.mfa.password')}
              />
              <input
                className={input}
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.trim())}
                placeholder={t('privacy.mfa.codePlaceholder')}
                aria-label={t('privacy.mfa.disableCodeLabel')}
                maxLength={32}
              />
              <div className="flex gap-2">
                <button className={primaryBtn} disabled={busy || !password || code.length < 6}>
                  {t('privacy.mfa.turnOffAction')}
                </button>
                <button type="button" className={ghostBtn} onClick={() => setDisabling(false)}>
                  {t('privacy.mfa.cancel')}
                </button>
              </div>
            </form>
          )}
          {status.enabled && !recoveryCodes && (
            <p className="flex items-center gap-1.5 text-[11px] text-success">
              <ShieldCheck className="h-3.5 w-3.5" />
              {t('privacy.mfa.protected')}
            </p>
          )}
        </>
      )}
    </div>
  );
};
