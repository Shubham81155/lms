'use client';

import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { useT } from '@/lib/i18n';
import { isValidCode, normaliseCode } from '@/lib/forms';
import { Button, Input, cardClasses } from '@/components/ui';
import { Banner } from '@/components/admin/identity/Banner';
import type { Campus } from './shared';

const NameCode: React.FC<{
  placeholderName: string;
  submitLabel: string;
  onSubmit: (v: { name: string; code: string }) => Promise<unknown>;
  disabled: boolean;
}> = ({ placeholderName, submitLabel, onSubmit, disabled }) => {
  const t = useT();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const ok = name.trim().length >= 2 && isValidCode(code);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        await onSubmit({ name: name.trim(), code: normaliseCode(code) });
        setName('');
        setCode('');
      }}
    >
      <Input
        fullWidth={false}
        className="flex-1 min-w-40"
        aria-label={placeholderName}
        placeholder={placeholderName}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Input
        fullWidth={false}
        className="w-32"
        aria-label={t('orgadm.code.label')}
        placeholder={t('orgadm.code.placeholder')}
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      <Button type="submit" disabled={disabled || !ok}>
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        {submitLabel}
      </Button>
    </form>
  );
};

/** A name with a "Rename" button that turns into an input in place (no browser dialog). */
const InlineRename: React.FC<{
  name: string;
  what: 'campus' | 'department';
  busy: boolean;
  onSave: (name: string) => void;
  children: (rename: React.ReactNode) => React.ReactNode;
}> = ({ name, what, busy, onSave, children }) => {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const trimmed = value.trim();
  if (!editing) {
    return (
      <>
        {children(
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-label={t(what === 'campus' ? 'orgadm.campus.renameAria' : 'orgadm.dept.renameAria', { name })}
            onClick={() => {
              setValue(name);
              setEditing(true);
            }}
          >
            {t('orgadm.rename')}
          </Button>
        )}
      </>
    );
  }
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (trimmed && trimmed !== name) onSave(trimmed);
        setEditing(false);
      }}
    >
      <Input
        fullWidth={false}
        className="min-w-40"
        aria-label={t(what === 'campus' ? 'orgadm.campus.newNameAria' : 'orgadm.dept.newNameAria', { name })}
        maxLength={120}
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button type="submit" disabled={busy || !trimmed || trimmed === name}>
        {t('orgadm.save')}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
        {t('orgadm.cancel')}
      </Button>
    </form>
  );
};

export const CampusPanel: React.FC = () => {
  const t = useT();
  const { data, isLoading, error, reload } = useApiData<{ data: Campus[] }>('/api/v1/admin/campuses');
  const { busy, error: actionError, run } = useAction();

  const act = (fn: () => Promise<unknown>) =>
    run(async () => {
      await fn();
      await reload();
    });

  const campuses = data?.data ?? [];
  return (
    <section className="space-y-4" aria-labelledby="campus-h">
      <div>
        <h3 id="campus-h" className="font-bold text-base text-ink">
          {t('orgadm.campus.title')}
        </h3>
        <p className="text-xs text-ink-muted">{t('orgadm.campus.intro')}</p>
      </div>
      {(error || actionError) && <Banner kind="error">{error || actionError}</Banner>}

      <NameCode
        placeholderName={t('orgadm.campus.nameLabel')}
        submitLabel={t('orgadm.campus.add')}
        disabled={busy}
        onSubmit={(v) => act(() => api.post('/api/v1/admin/campuses', v))}
      />

      {isLoading && <p className="text-xs text-ink-subtle">{t('common.loading')}</p>}
      {!isLoading && campuses.length === 0 && (
        <p className={cardClasses({ className: 'text-xs text-ink-subtle text-center p-8' })}>{t('orgadm.campus.empty')}</p>
      )}

      <ul className="space-y-3">
        {campuses.map((c) => (
          <li key={c.id} className={cardClasses({ className: 'space-y-3' })}>
            <InlineRename
              name={c.name}
              what="campus"
              busy={busy}
              onSave={(name) => act(() => api.patch(`/api/v1/admin/campuses/${c.id}`, { name }))}
            >
              {(rename) => (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-bold text-ink">
                      {c.name} <span className="text-[10px] font-mono text-ink-subtle ml-1">{c.code}</span>
                    </h4>
                    <p className="text-[11px] text-ink-subtle">
                      {t.plural('orgadm.campus.departments', c.departments.length)} · {t.plural('orgadm.campus.courses', c.courseCount)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {rename}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      aria-label={t('orgadm.campus.deleteAria', { name: c.name })}
                      onClick={() =>
                        window.confirm(t('orgadm.campus.deleteConfirm', { name: c.name })) &&
                        act(() => api.delete(`/api/v1/admin/campuses/${c.id}`))
                      }
                    >
                      <Trash2 className="h-3 w-3" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              )}
            </InlineRename>

            <ul className="space-y-1.5">
              {c.departments.map((d) => (
                <li key={d.id} className="flex items-center justify-between bg-surface border border-line rounded-xl px-3 py-2 text-xs">
                  <InlineRename
                    name={d.name}
                    what="department"
                    busy={busy}
                    onSave={(name) => act(() => api.patch(`/api/v1/admin/departments/${d.id}`, { name }))}
                  >
                    {(rename) => (
                      <>
                        <span className="text-ink">
                          {d.name} <span className="font-mono text-[10px] text-ink-subtle ml-1">{d.code}</span>
                        </span>
                        <span className="flex items-center gap-3">
                          {rename}
                          <span className="text-[11px] text-ink-subtle">{t.plural('orgadm.campus.courses', d.courseCount)}</span>
                          <button
                            type="button"
                            className="text-ink-subtle hover:text-danger disabled:opacity-50"
                            disabled={busy}
                            aria-label={t('orgadm.dept.deleteAria', { name: d.name })}
                            onClick={() =>
                              window.confirm(t('orgadm.dept.deleteConfirm', { name: d.name })) &&
                              act(() => api.delete(`/api/v1/admin/departments/${d.id}`))
                            }
                          >
                            <Trash2 className="h-3 w-3" aria-hidden="true" />
                          </button>
                        </span>
                      </>
                    )}
                  </InlineRename>
                </li>
              ))}
            </ul>

            <NameCode
              placeholderName={t('orgadm.dept.nameLabel')}
              submitLabel={t('orgadm.dept.add')}
              disabled={busy}
              onSubmit={(v) => act(() => api.post(`/api/v1/admin/campuses/${c.id}/departments`, v))}
            />
          </li>
        ))}
      </ul>
    </section>
  );
};
