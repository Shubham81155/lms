'use client';

import React from 'react';
import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { useT } from '@/lib/i18n';
import { Badge, Card, cardClasses, type BadgeTone } from '@/components/ui';
import { Banner } from '@/components/admin/identity/Banner';
import type { Compliance, ComplianceCheck } from './shared';

const STATUS_META: Record<ComplianceCheck['status'], { tone: BadgeTone; Icon: React.ElementType }> = {
  PASS: { tone: 'success', Icon: CheckCircle2 },
  WARN: { tone: 'warning', Icon: AlertTriangle },
  FAIL: { tone: 'danger', Icon: ShieldAlert },
  INFO: { tone: 'neutral', Icon: Info },
};

export const CompliancePanel: React.FC = () => {
  const t = useT();
  const { data, isLoading, error, reload } = useApiData<{ data: Compliance }>('/api/v1/admin/compliance');
  const { busy, error: actionError, run } = useAction();
  const d = data?.data;

  const declare = (key: 'ferpaCompliant' | 'coppaCompliant', value: boolean) =>
    run(async () => {
      await api.patch('/api/v1/admin/tenant', { [key]: value });
      await reload();
    });

  const counts = (d?.checks ?? []).reduce<Record<string, number>>((m, c) => ({ ...m, [c.status]: (m[c.status] ?? 0) + 1 }), {});

  return (
    <section className="space-y-5" aria-labelledby="comp-h">
      <div>
        <h3 id="comp-h" className="font-bold text-base text-ink">
          {t('orgadm.compliance.title')}
        </h3>
        <p className="text-xs text-ink-muted">{d?.note ?? t('orgadm.compliance.noteDefault')}</p>
      </div>
      {(error || actionError) && <Banner kind="error">{error || actionError}</Banner>}
      {isLoading && <p className="text-xs text-ink-subtle">{t('orgadm.compliance.checking')}</p>}

      {d && (
        <>
          <div className="flex flex-wrap gap-2 text-[11px]" aria-label={t('orgadm.compliance.summary')}>
            {(['PASS', 'WARN', 'FAIL', 'INFO'] as const).map((s) => (
              <Badge key={s} tone={STATUS_META[s].tone} size="md">
                {t(`orgadm.compliance.count.${s}` as const, { count: counts[s] ?? 0 })}
              </Badge>
            ))}
          </div>

          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {d.checks.map((c) => {
              const { Icon, tone } = STATUS_META[c.status];
              const label = t.dyn(`orgadm.compliance.status.${c.status}`, c.status);
              return (
                <li key={c.id} className={cardClasses({ className: 'space-y-2' })}>
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-sm text-ink">{c.name}</strong>
                    <Badge tone={tone} size="sm">
                      <Icon className="h-3 w-3" aria-hidden="true" />
                      {label}
                    </Badge>
                  </div>
                  <p className="text-xs text-ink-muted">{c.detail}</p>
                </li>
              );
            })}
          </ul>

          <Card className="space-y-3">
            <h4 className="text-sm font-bold text-ink">{t('orgadm.compliance.declTitle')}</h4>
            <p className="text-[11px] text-ink-subtle">{t('orgadm.compliance.declHelp')}</p>
            {(
              [
                ['ferpaCompliant', t('orgadm.compliance.ferpa'), d.declarations.ferpa],
                ['coppaCompliant', t('orgadm.compliance.coppa'), d.declarations.coppa],
              ] as const
            ).map(([key, label, on]) => (
              <label key={key} className="flex items-center justify-between text-xs text-ink">
                <span>{label}</span>
                <input type="checkbox" checked={on} disabled={busy} onChange={(e) => declare(key, e.target.checked)} />
              </label>
            ))}
            <p className="text-[11px] text-ink-subtle">
              {t('orgadm.compliance.region')}{' '}
              <span className="font-mono text-ink">{d.declarations.dataRegion ?? t('orgadm.compliance.regionNotSet')}</span>
            </p>
          </Card>
        </>
      )}
    </section>
  );
};
