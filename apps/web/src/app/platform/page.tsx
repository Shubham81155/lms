'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Clock, Inbox, Users } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { useAuth } from '@/context/AuthContext';
import { useT } from '@/lib/i18n';
import { useApiData } from '@/hooks/useApiData';
import { RequestsPanel } from '@/components/platform/RequestsPanel';
import { OrganisationsPanel } from '@/components/platform/OrganisationsPanel';
import { PlansPanel } from '@/components/platform/PlansPanel';
import { SupportPassesPanel } from '@/components/platform/SupportPassesPanel';
import { OperatorsPanel } from '@/components/platform/OperatorsPanel';
import { AuditLogPanel } from '@/components/AuditLogPanel';
import { summarise, trialsEndingWithin, type Org, type OrgRequest } from '@/lib/platform';

const TABS = ['overview', 'requests', 'organisations', 'plans', 'operators', 'audit'] as const;
type Tab = (typeof TABS)[number];
const isTab = (v: string): v is Tab => (TABS as readonly string[]).includes(v);

/**
 * The platform operator's page: organisations asking to join, and every organisation on the platform.
 * Only for super administrators of the operator organisation; the API enforces the same.
 */
export default function PlatformPage() {
  const t = useT();
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('overview');
  const [focusOrg, setFocusOrg] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const allowed = !!user?.platformOperator;

  useEffect(() => {
    if (!isLoading && user && !user.platformOperator) router.replace(user.targetRoute === '/platform' ? '/admin' : user.targetRoute);
  }, [isLoading, user, router]);

  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.replace('#', '');
      setTab(isTab(h) ? h : 'overview');
    };
    onHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (next: Tab) => {
    setTab(next);
    const hash = next === 'overview' ? '' : `#${next}`;
    if (window.location.hash !== hash) window.history.replaceState(null, '', `/platform${hash}`);
  };

  const orgs = useApiData<{ data: Org[] }>(allowed ? '/api/v1/operator/tenants' : null);
  const pending = useApiData<{ data: OrgRequest[]; pagination?: { total: number } }>(allowed ? '/api/v1/operator/requests' : null, {
    status: 'PENDING',
    v: version,
  });
  // The list is one page; the count of everything waiting comes from its pagination.
  const s = summarise(orgs.data?.data ?? [], pending.data?.data ?? [], pending.data?.pagination?.total);
  const endingSoon = trialsEndingWithin(orgs.data?.data ?? []);

  if (!allowed) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas text-xs text-ink-muted" role="status">
        {isLoading ? t('common.loading') : t('operator.page.redirecting')}
      </main>
    );
  }

  const stats = [
    {
      label: t('operator.stat.waiting'),
      value: pending.data ? String(s.pending) : '…',
      sub: t('operator.stat.waitingSub'),
      icon: Inbox,
      color: 'text-accent',
      onClick: () => go('requests'),
    },
    {
      label: t('operator.stat.orgs'),
      value: orgs.data ? String(s.organisations) : '…',
      sub: orgs.data
        ? t('operator.stat.orgsSub', {
            active: t.number(s.byStatus.ACTIVE),
            trial: t.number(s.byStatus.TRIAL),
            suspended: t.number(s.byStatus.SUSPENDED),
          })
        : '',
      icon: Building2,
      color: 'text-brand-fg',
      onClick: () => go('organisations'),
    },
    {
      label: t('operator.stat.trials'),
      value: orgs.data ? String(endingSoon.length) : '…',
      sub: orgs.data
        ? endingSoon.length
          ? endingSoon
              .slice(0, 3)
              .map((o) => o.name)
              .join(', ') + (endingSoon.length > 3 ? ', …' : '')
          : t('operator.stat.trialsNone')
        : '',
      icon: Clock,
      color: 'text-accent',
      onClick: () => go('organisations'),
    },
    {
      label: t('operator.stat.seats'),
      value: orgs.data ? t.number(s.seatsUsed) : '…',
      sub: t('operator.stat.seatsSub'),
      icon: Users,
      color: 'text-success',
    },
  ];

  return (
    <AppShell area="platform" activeKey={tab} onNavigate={(k) => isTab(k) && go(k)}>
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-8 p-6 md:p-8">
        <div className="space-y-1">
          <span className="text-xs px-2.5 py-0.5 rounded-full bg-orchid/10 text-orchid border border-orchid/50 font-semibold">
            {t('operator.page.badge')}
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight text-ink">{t('operator.page.title')}</h1>
          <p className="text-sm text-ink-muted">{t('operator.page.intro')}</p>
        </div>

        {tab === 'overview' && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((st) => {
              const Icon = st.icon;
              const body = (
                <>
                  <div className="flex items-center justify-between text-ink-muted">
                    <span className="text-xs font-semibold">{st.label}</span>
                    <Icon className={`h-5 w-5 ${st.color}`} />
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-ink">{st.value}</div>
                    <div className="mt-0.5 text-[11px] text-ink-subtle">{st.sub}</div>
                  </div>
                </>
              );
              return st.onClick ? (
                <button
                  key={st.label}
                  type="button"
                  onClick={st.onClick}
                  className="space-y-3 rounded-2xl border border-line bg-surface p-5 text-left shadow-lg transition-colors hover:border-brand/40"
                >
                  {body}
                </button>
              ) : (
                <div key={st.label} className="space-y-3 rounded-2xl border border-line bg-surface p-5 shadow-lg">
                  {body}
                </div>
              );
            })}
          </div>
        )}

        {tab === 'overview' && (
          <section className="space-y-3 rounded-3xl border border-line bg-surface p-6 shadow-xl" aria-labelledby="newest-h">
            <div className="flex items-center justify-between gap-3">
              <h2 id="newest-h" className="font-bold text-base text-ink">
                {t('operator.newest.title')}
              </h2>
              <button type="button" className="text-xs font-semibold text-brand-fg underline" onClick={() => go('requests')}>
                {t('operator.newest.all')}
              </button>
            </div>
            {pending.error && (
              <p role="alert" className="text-xs text-danger">
                {pending.error}
              </p>
            )}
            {pending.data && pending.data.data.length === 0 && <p className="text-xs text-ink-muted">{t('operator.newest.empty')}</p>}
            <ul className="divide-y divide-line">
              {(pending.data?.data ?? []).slice(0, 5).map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-xs">
                  <div className="min-w-0">
                    <div className="font-semibold text-ink">{r.organizationName}</div>
                    <div className="text-[11px] text-ink-muted">
                      {r.contactFirstName} {r.contactLastName} · {r.contactEmail} ·{' '}
                      {t.date(r.createdAt, { dateStyle: 'short', timeZone: undefined })}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="rounded-lg border border-line px-2.5 py-1 text-[11px] font-semibold text-ink hover:bg-raised"
                    onClick={() => go('requests')}
                  >
                    {t('operator.newest.review')}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === 'overview' && <SupportPassesPanel />}

        {tab === 'requests' && (
          <RequestsPanel
            onChanged={() => {
              setVersion((v) => v + 1);
              orgs.reload();
            }}
            onShowOrganisation={(id) => {
              setFocusOrg(id);
              go('organisations');
            }}
          />
        )}

        {tab === 'plans' && <PlansPanel onChanged={orgs.reload} />}

        {tab === 'organisations' && (
          <OrganisationsPanel ownTenantId={user?.tenantId} focusId={focusOrg} refreshKey={version} onChanged={orgs.reload} />
        )}

        {tab === 'operators' && <OperatorsPanel />}

        {tab === 'audit' && (
          <section className="space-y-4" aria-labelledby="platform-audit-title">
            <div>
              <h2 id="platform-audit-title" className="text-xl font-bold text-ink">
                {t('nav.item.platform.audit')}
              </h2>
              <p className="text-xs text-ink-muted">
                Audit trail and activity log across platform operator actions, settings, and decisions.
              </p>
            </div>
            <div className="rounded-3xl border border-line bg-surface p-6 shadow-xl">
              <AuditLogPanel />
            </div>
          </section>
        )}
      </main>
    </AppShell>
  );
}
