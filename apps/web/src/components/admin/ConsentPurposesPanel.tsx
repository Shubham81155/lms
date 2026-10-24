'use client';

import React, { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { Banner } from '@/components/admin/IdentityPanels';
import { useT, type Translator } from '@/lib/i18n';

const input =
  'w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand';
const ghostBtn =
  'px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50 inline-flex items-center gap-1.5';
const primaryBtn = 'px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold transition-all';

interface Purpose {
  key: string;
  title: string;
  description: string;
  required: boolean;
  active: boolean;
  lawfulBasis: string | null;
  version?: number;
}
interface Draft extends Purpose {
  isNew: boolean;
}
interface ReportRow {
  key: string;
  title: string;
  required: boolean;
  active: boolean;
  currentVersion: number;
  granted: number;
  withdrawn: number;
  noAnswer: number;
  byVersion: { version: number; granted: number; withdrawn: number }[];
}

const KEY_RE = /^[a-z][a-z0-9_-]{1,39}$/;

const problem = (t: Translator, d: Draft, all: Draft[]): string | null => {
  if (!KEY_RE.test(d.key)) return t('comply.cp.problem.key');
  if (all.filter((x) => x.key === d.key).length > 1) return t('comply.cp.problem.dup');
  if (d.title.trim().length < 2) return t('comply.cp.problem.title');
  if (d.description.trim().length < 10) return t('comply.cp.problem.desc');
  return null;
};

const ConsentReport: React.FC<{ rows: ReportRow[] }> = ({ rows }) => {
  const t = useT();
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-bold text-ink">{t('comply.cp.report')}</h4>
      {rows.length === 0 ? (
        <p className="text-xs text-ink-subtle">{t('comply.cp.reportEmpty')}</p>
      ) : (
        <div className="overflow-x-auto border border-line rounded-2xl">
          <table className="w-full text-xs">
            <caption className="sr-only">{t('comply.cp.reportCaption')}</caption>
            <thead className="bg-raised text-ink-muted text-[11px]">
              <tr>
                <th scope="col" className="text-left font-semibold px-3 py-2">
                  {t('comply.cp.colPurpose')}
                </th>
                <th scope="col" className="text-left font-semibold px-3 py-2">
                  {t('comply.cp.colVersion')}
                </th>
                <th scope="col" className="text-right font-semibold px-3 py-2">
                  {t('comply.cp.colGranted')}
                </th>
                <th scope="col" className="text-right font-semibold px-3 py-2">
                  {t('comply.cp.colWithdrawn')}
                </th>
                <th scope="col" className="text-right font-semibold px-3 py-2">
                  {t('comply.cp.colNoAnswer')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.flatMap((r) => {
                const versions = r.byVersion.length ? r.byVersion : [{ version: r.currentVersion, granted: 0, withdrawn: 0 }];
                return versions.map((v, i) => (
                  <tr key={`${r.key}-${v.version}`} className="bg-canvas">
                    <th scope="row" className="text-left font-normal px-3 py-2 text-ink">
                      {i === 0 ? (
                        <>
                          <span className="font-semibold">{r.title}</span>
                          <span className="text-ink-subtle">
                            {' '}
                            · {r.key}
                            {r.required ? t('comply.cp.tagRequired') : ''}
                            {r.active ? '' : t('comply.cp.tagInactive')}
                          </span>
                        </>
                      ) : (
                        <span className="sr-only">{r.title}</span>
                      )}
                    </th>
                    <td className="px-3 py-2 text-ink-muted">
                      v{v.version}
                      {v.version === r.currentVersion ? t('comply.cp.current') : ''}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-success">{v.granted}</td>
                    <td className="px-3 py-2 text-right font-mono text-ink">{v.withdrawn}</td>
                    <td className="px-3 py-2 text-right font-mono text-ink-muted">{i === 0 ? r.noAnswer : ''}</td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-ink-subtle">{t('comply.cp.reportNote')}</p>
    </div>
  );
};

/**
 * What the organisation asks people to consent to (DPDP Act s.6): the purposes, their wording and lawful-basis
 * note, and who has answered. Backed by /api/v1/privacy/consent-purposes and /consents/report. Changing the
 * wording or "required" raises the purpose's version, so earlier answers stay tied to what was shown.
 */
export const ConsentPurposesPanel: React.FC = () => {
  const t = useT();
  const list = useApiData<{ data: Purpose[] }>('/api/v1/privacy/consent-purposes');
  const report = useApiData<{ data: ReportRow[] }>('/api/v1/privacy/consents/report');
  const { busy, error, run, clearError } = useAction();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [dirty, setDirty] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (list.data) {
      setDrafts(list.data.data.map((p) => ({ ...p, lawfulBasis: p.lawfulBasis ?? null, isNew: false })));
      setDirty(false);
    }
  }, [list.data]);

  const edit = (i: number, patch: Partial<Draft>) => {
    setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));
    setDirty(true);
    setDone(false);
    clearError();
  };
  const add = () => {
    setDrafts((ds) => [...ds, { key: '', title: '', description: '', required: false, active: true, lawfulBasis: null, isNew: true }]);
    setDirty(true);
  };
  const problems = drafts.map((d) => problem(t, d, drafts));
  const invalid = problems.some(Boolean);

  const save = () =>
    run(async () => {
      setDone(false);
      await api.put('/api/v1/privacy/consent-purposes', {
        purposes: drafts.map((d) => ({
          key: d.key,
          title: d.title.trim(),
          description: d.description.trim(),
          lawfulBasis: d.lawfulBasis?.trim() || null,
          required: d.required,
          active: d.active,
        })),
      });
      setDone(true);
      await Promise.all([list.reload(), report.reload()]);
    });

  return (
    <section className="space-y-5" aria-labelledby="consent-h">
      <div>
        <h3 id="consent-h" className="font-bold text-base text-ink">
          {t('comply.cp.title')}
        </h3>
        <p className="text-xs text-ink-muted">{t('comply.cp.intro')}</p>
      </div>

      {(list.error || error) && <Banner kind="error">{list.error || error}</Banner>}
      {done && <Banner kind="ok">{t('comply.cp.saved')}</Banner>}
      {list.isLoading && !list.data && <p className="text-xs text-ink-subtle">{t('privacy.requests.loading')}</p>}
      {list.data && drafts.length === 0 && <p className="text-xs text-ink-subtle">{t('comply.cp.empty')}</p>}

      {drafts.length > 0 && (
        <ul className="space-y-3" aria-label={t('comply.cp.title')}>
          {drafts.map((d, i) => (
            <li key={d.isNew ? `new-${i}` : d.key} className="p-3 rounded-2xl border border-line bg-canvas space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="space-y-1 text-[11px] text-ink-muted">
                  {d.isNew ? t('comply.cp.keyLabel') : t('comply.cp.keyFixed')}
                  <input
                    className={input}
                    value={d.key}
                    maxLength={40}
                    readOnly={!d.isNew}
                    onChange={(e) => edit(i, { key: e.target.value.toLowerCase() })}
                    placeholder={t('comply.cp.keyPlaceholder')}
                  />
                </label>
                <label className="space-y-1 text-[11px] text-ink-muted">
                  {t('comply.cp.titleLabel')}
                  <input className={input} value={d.title} maxLength={120} onChange={(e) => edit(i, { title: e.target.value })} />
                </label>
                <label className="space-y-1 text-[11px] text-ink-muted md:col-span-2">
                  {t('comply.cp.descLabel')}
                  <textarea
                    className={input}
                    rows={2}
                    maxLength={2000}
                    value={d.description}
                    onChange={(e) => edit(i, { description: e.target.value })}
                  />
                </label>
                <label className="space-y-1 text-[11px] text-ink-muted md:col-span-2">
                  {t('comply.cp.basisLabel')}
                  <textarea
                    className={input}
                    rows={2}
                    maxLength={1000}
                    value={d.lawfulBasis ?? ''}
                    onChange={(e) => edit(i, { lawfulBasis: e.target.value })}
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <label className="flex items-center gap-2 text-xs text-ink">
                  <input type="checkbox" checked={d.required} onChange={(e) => edit(i, { required: e.target.checked })} />{' '}
                  {t('comply.cp.required')}
                </label>
                <label className="flex items-center gap-2 text-xs text-ink">
                  <input type="checkbox" checked={d.active} onChange={(e) => edit(i, { active: e.target.checked })} />{' '}
                  {t('comply.cp.active')}
                </label>
                {!d.isNew && d.version !== undefined && (
                  <span className="text-[11px] text-ink-subtle">{t('comply.cp.version', { version: d.version })}</span>
                )}
                {d.isNew && (
                  <button
                    className={ghostBtn}
                    onClick={() => {
                      setDrafts((ds) => ds.filter((_, j) => j !== i));
                      setDirty(true);
                    }}
                  >
                    {t('comply.cp.remove')}
                  </button>
                )}
              </div>
              {problems[i] && dirty && (
                <p className="text-[11px] text-accent" role="status">
                  {problems[i]}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button className={ghostBtn} onClick={add} disabled={drafts.length >= 30}>
          <Plus className="h-3.5 w-3.5" /> {t('comply.cp.add')}
        </button>
        <button className={primaryBtn} disabled={busy || !dirty || invalid || drafts.length === 0} onClick={save}>
          {busy ? t('comply.cp.saving') : t('comply.cp.save')}
        </button>
      </div>

      {report.error && <Banner kind="error">{report.error}</Banner>}
      {report.data && <ConsentReport rows={report.data.data} />}
    </section>
  );
};
