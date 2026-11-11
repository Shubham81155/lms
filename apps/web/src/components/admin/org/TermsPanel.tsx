'use client';

import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { useT } from '@/lib/i18n';
import { Button, Input, cardClasses } from '@/components/ui';
import { Banner } from '@/components/admin/identity/Banner';
import { isValidTermRange, isoDay, type Term } from './shared';

/** Terms courses run in ("Fall 2026"): courses are filed under one, and copying a course moves its dates between them. */
export const TermsPanel: React.FC = () => {
  const t = useT();
  const { data, isLoading, error, reload } = useApiData<{ data: Term[] }>('/api/v1/terms');
  const { busy, error: actionError, run } = useAction();
  const [name, setName] = useState('');
  const [starts, setStarts] = useState('');
  const [ends, setEnds] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string; starts: string; ends: string } | null>(null);

  const act = (fn: () => Promise<unknown>) =>
    run(async () => {
      await fn();
      await reload();
    });
  const terms = data?.data ?? [];

  return (
    <section className="space-y-4" aria-labelledby="terms-h">
      <div>
        <h3 id="terms-h" className="font-bold text-base text-ink">
          {t('orgadm.terms.title')}
        </h3>
        <p className="text-xs text-ink-muted">{t('orgadm.terms.intro')}</p>
      </div>
      {(error || actionError) && <Banner kind="error">{error || actionError}</Banner>}

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          act(async () => {
            await api.post('/api/v1/terms', { name: name.trim(), startsOn: starts, endsOn: ends });
            setName('');
            setStarts('');
            setEnds('');
          });
        }}
      >
        <Input
          fullWidth={false}
          className="flex-1 min-w-40"
          aria-label={t('orgadm.terms.nameAria')}
          placeholder={t('orgadm.terms.namePlaceholder')}
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <label className="text-[11px] text-ink-muted space-y-1">
          <span className="block">{t('orgadm.terms.starts')}</span>
          <Input
            fullWidth={false}
            className="w-40"
            type="date"
            aria-label={t('orgadm.terms.startsAria')}
            value={starts}
            onChange={(e) => setStarts(e.target.value)}
          />
        </label>
        <label className="text-[11px] text-ink-muted space-y-1">
          <span className="block">{t('orgadm.terms.ends')}</span>
          <Input
            fullWidth={false}
            className="w-40"
            type="date"
            aria-label={t('orgadm.terms.endsAria')}
            value={ends}
            onChange={(e) => setEnds(e.target.value)}
          />
        </label>
        <Button type="submit" disabled={busy || !isValidTermRange(name, starts, ends)}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          {t('orgadm.terms.add')}
        </Button>
      </form>
      {starts && ends && ends <= starts && <p className="text-[11px] text-danger">{t('orgadm.terms.endAfterStart')}</p>}

      {isLoading && <p className="text-xs text-ink-subtle">{t('common.loading')}</p>}
      {!isLoading && terms.length === 0 && <p className="text-xs text-ink-subtle">{t('orgadm.terms.empty')}</p>}
      <ul className="space-y-2">
        {terms.map((term) =>
          editing?.id === term.id ? (
            <li key={term.id} className={cardClasses({ padding: 'sm', className: 'rounded-xl' })}>
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  act(async () => {
                    await api.patch(`/api/v1/terms/${term.id}`, {
                      name: editing.name.trim(),
                      startsOn: editing.starts,
                      endsOn: editing.ends,
                    });
                    setEditing(null);
                  });
                }}
              >
                <Input
                  fullWidth={false}
                  className="flex-1 min-w-40"
                  aria-label={t('orgadm.terms.newNameAria', { name: term.name })}
                  maxLength={80}
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
                <Input
                  fullWidth={false}
                  className="w-40"
                  type="date"
                  aria-label={t('orgadm.terms.editStartsAria', { name: term.name })}
                  value={editing.starts}
                  onChange={(e) => setEditing({ ...editing, starts: e.target.value })}
                />
                <Input
                  fullWidth={false}
                  className="w-40"
                  type="date"
                  aria-label={t('orgadm.terms.editEndsAria', { name: term.name })}
                  value={editing.ends}
                  onChange={(e) => setEditing({ ...editing, ends: e.target.value })}
                />
                <Button type="submit" disabled={busy || !isValidTermRange(editing.name, editing.starts, editing.ends)}>
                  {t('orgadm.save')}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>
                  {t('orgadm.cancel')}
                </Button>
              </form>
            </li>
          ) : (
            <li
              key={term.id}
              className={cardClasses({
                padding: 'none',
                className: 'rounded-xl px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs',
              })}
            >
              <div>
                <strong className="text-ink">{term.name}</strong>
                <span className="text-ink-subtle ml-2">
                  {t('orgadm.terms.range', { start: isoDay(term.startsOn), end: isoDay(term.endsOn) })} ·{' '}
                  {t.plural('orgadm.terms.courses', term.courseCount)}
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => setEditing({ id: term.id, name: term.name, starts: isoDay(term.startsOn), ends: isoDay(term.endsOn) })}
                >
                  {t('orgadm.terms.edit')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy || term.courseCount > 0}
                  title={term.courseCount > 0 ? t('orgadm.terms.deleteTitle') : undefined}
                  aria-label={t('orgadm.terms.deleteAria', { name: term.name })}
                  onClick={() => act(() => api.delete(`/api/v1/terms/${term.id}`))}
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                </Button>
              </div>
            </li>
          )
        )}
      </ul>
    </section>
  );
};
