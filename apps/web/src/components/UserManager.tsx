'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useApiData } from '@/hooks/useApiData';
import { useT } from '@/lib/i18n';
import { Button, Input, Modal, Select, cardClasses } from '@/components/ui';
import { Banner } from '@/components/admin/identity/Banner';
import { BulkImport } from '@/components/admin/BulkImport';
import { InviteUserForm } from '@/components/admin/users/InviteUserForm';
import { UserRow } from '@/components/admin/users/UserRow';
import { ROLES, STATUSES, formatEnumLabel, type Notice, type Person } from '@/components/admin/users/shared';

/** Everyone in the organisation: find people, fix names, change roles and suspend or restore accounts. */
export const UserManager: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const t = useT();
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [inviting, setInviting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  const list = useApiData<{ data: Person[]; pagination: { page: number; totalPages: number; total: number } }>('/api/v1/users', {
    page,
    limit: 15,
    search: search || undefined,
    role: role || undefined,
    status: status || undefined,
  });
  const people = list.data?.data ?? [];

  return (
    <Modal
      onClose={onClose}
      title={t('people.users.title')}
      subtitle={t('people.users.intro')}
      ariaLabel={t('people.users.title')}
      closeLabel={t('people.users.close')}
      size="4xl"
      panelClassName="h-[88vh]"
      headerActions={
        <>
          <Button
            type="button"
            onClick={() => {
              setNotice(null);
              setImporting(false);
              setInviting(true);
            }}
            aria-label={t('people.users.invite')}
          >
            {t('people.users.invitePlus')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setNotice(null);
              setInviting(false);
              setImporting(true);
            }}
          >
            {t('people.users.importCsv')}
          </Button>
        </>
      }
    >
      <div role="search" className="flex flex-wrap items-center gap-2 border-b border-line bg-canvas/60 px-6 py-3">
        <Input
          fullWidth={false}
          className="w-64"
          aria-label={t('people.users.searchLabel')}
          placeholder={t('people.users.searchPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select
          fullWidth={false}
          aria-label={t('people.users.filterRole')}
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('people.users.allRoles')}</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {t.dyn(`role.${r}`, formatEnumLabel(r))}
            </option>
          ))}
        </Select>
        <Select
          fullWidth={false}
          aria-label={t('people.users.filterStatus')}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('people.users.allStatuses')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t.dyn(`people.status.${s}`, formatEnumLabel(s))}
            </option>
          ))}
        </Select>
        {list.data && (
          <span className="ml-auto text-[11px] text-ink-subtle">
            {t.plural('people.users.total', list.data.pagination.total, { count: t.number(list.data.pagination.total) })}
          </span>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-6">
        {notice && <Banner kind={notice.kind}>{notice.text}</Banner>}
        {importing && (
          <BulkImport
            onCancel={() => setImporting(false)}
            onDone={(text) => {
              setNotice({ kind: 'ok', text });
              setImporting(false);
              setPage(1);
              list.reload();
            }}
          />
        )}
        {inviting && (
          <InviteUserForm
            actorIsSuper={user?.role === 'SUPER_ADMIN'}
            onCancel={() => setInviting(false)}
            onDone={(n) => {
              setNotice(n);
              setInviting(false);
              setSearch('');
              setQ('');
              setPage(1);
              list.reload();
            }}
          />
        )}
        {list.error && <Banner kind="error">{list.error}</Banner>}
        {list.isLoading && !list.data && <p className="text-xs text-ink-subtle">{t('people.users.loading')}</p>}
        {!list.isLoading && !list.error && people.length === 0 && (
          <p className={cardClasses({ className: 'text-center text-xs text-ink-muted' })}>{t('people.users.empty')}</p>
        )}
        <ul className="space-y-3">
          {people.map((p) => (
            <UserRow
              key={`${p.id}:${p.role}:${p.status}:${p.firstName}:${p.lastName}`}
              person={p}
              self={p.id === user?.id}
              actorIsSuper={user?.role === 'SUPER_ADMIN'}
              onSaved={list.reload}
              onNotice={setNotice}
            />
          ))}
        </ul>
        {list.data && list.data.pagination.totalPages > 1 && (
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span>
              {t('people.users.page', { page: t.number(list.data.pagination.page), pages: t.number(list.data.pagination.totalPages) })}
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>
                {t('people.users.previous')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={page >= list.data.pagination.totalPages}
                onClick={() => setPage((n) => n + 1)}
              >
                {t('people.users.next')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
