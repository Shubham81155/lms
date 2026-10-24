'use client';

import React from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { AuditLogPanel } from '@/components/AuditLogPanel';
import { useAuth } from '@/context/AuthContext';
import { useT } from '@/lib/i18n';

/** Auditors: a read-only view of the organisation's audit trail. */
export default function AuditPage() {
  const { user } = useAuth();
  const t = useT();
  return (
    <AppShell area="audit" activeKey="log" onNavigate={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8 space-y-6">
        <div className="space-y-1">
          <p className="text-xs text-ink-muted">{user?.tenantName}</p>
          <h1 className="text-3xl font-extrabold text-ink tracking-tight">{t('people.audit.title')}</h1>
          <p className="text-sm text-ink-muted">{t('people.audit.subtitle')}</p>
        </div>
        <div className="bg-surface border border-line rounded-3xl p-6">
          <AuditLogPanel />
        </div>
      </main>
    </AppShell>
  );
}
