'use client';

import React, { useState } from 'react';
import { X, Award, ShieldCheck, Printer, Link2, ExternalLink, AlertTriangle } from 'lucide-react';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useApiData } from '@/hooks/useApiData';
import { useAuth } from '@/context/AuthContext';
import { useT } from '@/lib/i18n';

interface CertificateVerificationProps {
  certificateNumber: string;
  onClose: () => void;
}

interface Verified {
  valid: boolean;
  certificateNumber: string;
  issuedAt: string;
  expiresAt: string | null;
  issuedTo: string;
  course: { title: string; code: string };
  institution: string;
}

// The viewer's own time zone (as before), in the chosen language.
const DAY: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric', timeZone: undefined };

/**
 * A learner's certificate, read from the same public endpoint anyone uses to verify it, so what is shown is
 * exactly what a verifier sees. "Print" uses the browser's print dialog (which can save a PDF).
 */
export const CertificateVerification: React.FC<CertificateVerificationProps> = ({ certificateNumber, onClose }) => {
  useEscapeKey(onClose);
  const t = useT();
  const day = (iso: string) => t.date(iso, DAY);
  const { user } = useAuth();
  const tenant = user?.tenantSlug ?? '';
  const { data, isLoading, error } = useApiData<Verified>(
    `/api/v1/certificates/verify/${encodeURIComponent(certificateNumber)}`,
    tenant ? { tenant } : undefined
  );
  const [copied, setCopied] = useState(false);

  const verifyUrl =
    typeof window === 'undefined'
      ? ''
      : `${window.location.origin}/verify?number=${encodeURIComponent(certificateNumber)}${tenant ? `&tenant=${encodeURIComponent(tenant)}` : ''}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(verifyUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt(t('work.cert.copyPrompt'), verifyUrl);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-canvas/85 backdrop-blur-md flex items-center justify-center p-4 print:static print:bg-white print:p-0"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cert-h"
    >
      <div className="bg-surface border border-line rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col print:border-0 print:shadow-none">
        <div className="bg-canvas border-b border-line px-6 py-4 flex items-center justify-between print:hidden">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-accent/20 border border-accent/40 flex items-center justify-center text-accent">
              <Award className="h-5 w-5" />
            </div>
            <h3 id="cert-h" className="font-bold text-sm text-ink">
              {t('work.cert.title')}
            </h3>
          </div>
          <button onClick={onClose} aria-label={t('common.close')} className="p-1 rounded-lg hover:bg-raised text-ink-muted hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-8 bg-gradient-to-b from-surface to-canvas flex flex-col items-center text-center space-y-6 print:bg-white">
          {isLoading && <p className="text-xs text-ink-muted">{t('work.cert.loading')}</p>}
          {error && (
            <p role="alert" className="text-xs text-danger">
              {t('work.cert.loadError', { error })}
            </p>
          )}
          {data && (
            <div id="certificate" className="w-full max-w-lg rounded-2xl border-2 border-accent/40 p-8 space-y-5 print:border-black">
              <div className="text-[11px] uppercase tracking-[0.3em] font-bold text-accent print:text-black">{data.institution}</div>
              <div className="text-xs text-ink-muted print:text-black">{t('work.cert.certifies')}</div>
              <div className="text-3xl font-extrabold text-ink tracking-tight print:text-black">{data.issuedTo}</div>
              <div className="text-xs text-ink-muted print:text-black">{t('work.cert.hasCompleted')}</div>
              <div className="text-lg font-bold text-ink print:text-black">
                {data.course.title} <span className="text-ink-muted font-semibold">({data.course.code})</span>
              </div>
              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-line text-left text-[11px] print:border-black">
                <div>
                  <div className="text-ink-subtle">{t('work.cert.issued')}</div>
                  <div className="font-semibold text-ink print:text-black">{day(data.issuedAt)}</div>
                </div>
                <div>
                  <div className="text-ink-subtle">{data.expiresAt ? t('work.cert.validUntil') : t('work.cert.expiry')}</div>
                  <div className="font-semibold text-ink print:text-black">
                    {data.expiresAt ? day(data.expiresAt) : t('work.cert.noExpiry')}
                  </div>
                </div>
                <div className="col-span-2">
                  <div className="text-ink-subtle">{t('work.cert.number')}</div>
                  <div className="font-mono font-semibold text-ink print:text-black">{data.certificateNumber}</div>
                </div>
                <div className="col-span-2 break-all">
                  <div className="text-ink-subtle">{t('work.cert.verifyAt')}</div>
                  <div className="font-mono text-ink print:text-black">{verifyUrl}</div>
                </div>
              </div>
              <div
                className={`flex items-center justify-center gap-1.5 text-xs font-semibold print:hidden ${data.valid ? 'text-success' : 'text-danger'}`}
              >
                {data.valid ? <ShieldCheck className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                <span>{data.valid ? t('work.cert.verified') : t('work.cert.expired')}</span>
              </div>
            </div>
          )}
        </div>

        {data && (
          <div className="bg-canvas border-t border-line px-6 py-3.5 flex flex-wrap items-center justify-end gap-2 print:hidden">
            <button
              onClick={copy}
              className="px-3.5 py-2 rounded-xl border border-line bg-surface hover:bg-raised text-xs font-semibold text-ink flex items-center gap-1.5"
            >
              <Link2 className="h-3.5 w-3.5" />
              {copied ? t('work.cert.copied') : t('work.cert.copy')}
            </button>
            <a
              href={verifyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3.5 py-2 rounded-xl border border-line bg-surface hover:bg-raised text-xs font-semibold text-ink flex items-center gap-1.5"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t('work.cert.open')}
            </a>
            <button
              onClick={() => window.print()}
              className="px-3.5 py-2 rounded-xl bg-brand hover:bg-brand-hover text-on-brand text-xs font-bold flex items-center gap-1.5"
            >
              <Printer className="h-3.5 w-3.5" />
              {t('work.cert.print')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
