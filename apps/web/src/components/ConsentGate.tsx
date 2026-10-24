'use client';

import React, { useEffect, useRef } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Banner } from '@/components/admin/IdentityPanels';
import { ConsentList, GuardianForm, needsAnswer, useMinorStatus, useMyConsents } from '@/components/PrivacyConsents';

/**
 * Blocks the app after sign-in until every required, active consent purpose has a current answer. Optional purposes
 * are offered in the same dialog and can be skipped. A person under 18 without guardian consent is asked for a
 * guardian's e-mail instead of getting grant buttons. If the lists cannot be loaded the app stays usable (the
 * API still refuses anything that truly needs consent). Mount it only for ordinary sessions.
 */
export const ConsentGate: React.FC = () => {
  const { logout } = useAuth();
  const consents = useMyConsents();
  const minor = useMinorStatus();
  const panel = useRef<HTMLDivElement>(null);

  const rows = consents.data?.data ?? [];
  const m = minor.data?.data ?? null;
  const pending = rows.some(needsAnswer);

  useEffect(() => {
    if (pending) panel.current?.focus();
  }, [pending]);

  // Keep the page behind the dialog out of reach of the keyboard while it is open.
  useEffect(() => {
    if (!pending) return;
    const main = document.getElementById('main-content');
    const had = main?.hasAttribute('inert');
    main?.setAttribute('inert', '');
    return () => {
      if (!had) main?.removeAttribute('inert');
    };
  }, [pending]);

  if (!pending) return null;

  const needsGuardian = !!m?.isMinor && !m.guardianConsentAt;
  const reloadAll = async () => {
    await Promise.all([consents.reload(), minor.reload()]);
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-canvas/90 backdrop-blur-md flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-gate-h"
    >
      <div
        ref={panel}
        tabIndex={-1}
        className="bg-surface border border-line rounded-3xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl outline-none"
      >
        <div className="border-b border-line px-6 py-4 flex items-center gap-3">
          <div className="h-9 w-9 rounded-2xl bg-success/20 border border-success/30 flex items-center justify-center text-success">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 id="consent-gate-h" className="font-bold text-base text-ink">
              Before you continue
            </h2>
            <p className="text-xs text-ink-muted">Your organisation needs your consent to use your data in these ways.</p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {needsGuardian ? (
            <>
              <GuardianForm minor={m} onChanged={reloadAll} idPrefix="gate" />
              {m?.guardianEmail && (
                <button
                  type="button"
                  onClick={reloadAll}
                  className="px-4 py-2 bg-surface hover:bg-raised border border-line text-ink rounded-xl text-xs font-bold"
                >
                  My guardian has confirmed: check again
                </button>
              )}
            </>
          ) : (
            <>
              <ConsentList consents={rows.filter((c) => c.status === 'NONE' || c.outdated)} onChanged={reloadAll} grantOnly />
              <p className="text-[11px] text-ink-subtle">
                Optional items can be left unanswered. You can change any answer later under Account security and privacy.
              </p>
            </>
          )}
          {(consents.error || minor.error) && <Banner kind="error">{consents.error || minor.error}</Banner>}
        </div>
        <div className="border-t border-line px-6 py-3 flex justify-end">
          <button type="button" onClick={() => logout()} className="text-xs text-ink-muted hover:text-ink underline underline-offset-2">
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
};
