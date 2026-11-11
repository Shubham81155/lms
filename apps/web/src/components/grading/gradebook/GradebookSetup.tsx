'use client';

import React, { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { typedPut } from '@/lib/typed-api';
import { useAction, useApiData } from '@/hooks/useApiData';
import { Banner } from '@/components/admin/IdentityPanels';
import { useT } from '@/lib/i18n';
import { CURVE_OPTIONS, ghostBtnClass, inputClass, primaryBtnClass, round2, type Config, type CurveMethod } from './types';

export const GradebookSetup: React.FC<{ courseId: string; canEdit: boolean }> = ({ courseId, canEdit }) => {
  const t = useT();
  const { data, isLoading, error, reload } = useApiData<{ data: Config }>(`/api/v1/courses/${courseId}/gradebook/config`);
  const { busy, error: actionError, run, clearError } = useAction();
  const [cats, setCats] = useState<{ name: string; weight: string }[]>([]);
  const [assign, setAssign] = useState<Record<string, string>>({});
  const [method, setMethod] = useState<CurveMethod>('NONE');
  const [curveValue, setCurveValue] = useState('0');
  const [saved, setSaved] = useState<'categories' | 'items' | 'curve' | null>(null);

  const cfg = data?.data;
  useEffect(() => {
    if (!cfg) return;
    setCats(cfg.categories.map((c) => ({ name: c.name, weight: String(c.weightPercent) })));
    setAssign(Object.fromEntries(cfg.items.map((i) => [`${i.type}:${i.id}`, i.gradeCategoryId ?? ''])));
    setMethod(cfg.curve.method);
    setCurveValue(String(cfg.curve.value ?? 0));
  }, [cfg]);

  const total = round2(cats.reduce((s, c) => s + (Number(c.weight) || 0), 0));
  const totalOk = Math.abs(total - 100) < 0.005;
  const done = (what: 'categories' | 'items' | 'curve') => setSaved(what);

  const saveCategories = () =>
    run(async () => {
      await typedPut(
        '/api/v1/courses/{courseId}/gradebook/categories',
        {
          categories: cats.map((c) => ({ name: c.name.trim(), weightPercent: Number(c.weight) })),
        },
        { courseId }
      );
      await reload();
      done('categories');
    });

  const saveItems = () =>
    run(async () => {
      if (!cfg) return;
      const byName = new Map(cfg.categories.map((c) => [c.id, c.id]));
      await typedPut(
        '/api/v1/courses/{courseId}/gradebook/items',
        {
          items: cfg.items.map((i) => {
            const v = assign[`${i.type}:${i.id}`] ?? '';
            return { type: i.type, id: i.id, categoryId: v && byName.has(v) ? v : null };
          }),
        },
        { courseId }
      );
      await reload();
      done('items');
    });

  const saveCurve = () =>
    run(async () => {
      await typedPut(
        '/api/v1/courses/{courseId}/gradebook/curve',
        { method, value: method === 'NONE' ? 0 : Number(curveValue) },
        { courseId }
      );
      await reload();
      done('curve');
    });

  if (isLoading) return <div className="text-xs text-ink-subtle p-6">{t('grading.loading')}</div>;
  if (error) return <Banner kind="error">{error}</Banner>;
  if (!cfg) return null;

  return (
    <div
      className="space-y-8"
      onChange={() => {
        clearError();
        setSaved(null);
      }}
    >
      {actionError && <Banner kind="error">{actionError}</Banner>}
      {saved && <Banner kind="ok">{t('grading.gb.savedBanner', { saved: t(`grading.gb.saved.${saved}`) })}</Banner>}
      {!canEdit && <Banner kind="error">{t('grading.gb.taReadOnly')}</Banner>}

      <section className="space-y-3" aria-labelledby="cat-h">
        <div className="flex items-center justify-between">
          <h4 id="cat-h" className="text-xs font-bold uppercase tracking-wider text-ink">
            {t('grading.gb.categories')}
          </h4>
          <span className={`text-xs font-mono ${totalOk ? 'text-success' : 'text-danger'}`}>
            {t('grading.gb.total', { total: t.number(total) })} {totalOk ? '✓' : t('grading.gb.mustBe100')}
          </span>
        </div>
        {cats.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              className={`${inputClass} flex-1`}
              aria-label={t('grading.gb.catName', { n: i + 1 })}
              value={c.name}
              disabled={!canEdit}
              placeholder={t('grading.gb.catPlaceholder')}
              onChange={(e) => setCats((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
            />
            <input
              className={`${inputClass} w-24`}
              aria-label={t('grading.gb.catWeight', { n: i + 1 })}
              type="number"
              min={0.01}
              max={100}
              step="0.01"
              value={c.weight}
              disabled={!canEdit}
              onChange={(e) => setCats((p) => p.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)))}
            />
            <span className="text-xs text-ink-subtle">%</span>
            <button
              className={ghostBtnClass}
              disabled={!canEdit}
              aria-label={t('grading.gb.catRemove', { n: i + 1 })}
              onClick={() => setCats((p) => p.filter((_, j) => j !== i))}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
        <div className="flex gap-2">
          <button className={ghostBtnClass} disabled={!canEdit} onClick={() => setCats((p) => [...p, { name: '', weight: '' }])}>
            <Plus className="h-3 w-3 inline mr-1" />
            {t('grading.gb.addCategory')}
          </button>
          <button
            className={primaryBtnClass}
            disabled={!canEdit || busy || !totalOk || cats.some((c) => !c.name.trim())}
            onClick={saveCategories}
          >
            {t('grading.gb.saveCategories')}
          </button>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="items-h">
        <h4 id="items-h" className="text-xs font-bold uppercase tracking-wider text-ink">
          {t('grading.gb.whichWork')}
        </h4>
        {cfg.items.length === 0 && <p className="text-xs text-ink-subtle">{t('grading.gb.noItems')}</p>}
        {cfg.items.map((i) => (
          <div
            key={`${i.type}:${i.id}`}
            className="flex items-center justify-between gap-3 bg-canvas border border-line rounded-xl px-3 py-2"
          >
            <div className="text-xs text-ink">
              <span className="text-[10px] font-bold text-ink-subtle mr-2">{t.dyn(`grading.type.${i.type}`, i.type)}</span>
              {i.title}
            </div>
            <select
              className={inputClass}
              aria-label={t('grading.gb.categoryFor', { title: i.title })}
              disabled={!canEdit}
              value={assign[`${i.type}:${i.id}`] ?? ''}
              onChange={(e) => setAssign((p) => ({ ...p, [`${i.type}:${i.id}`]: e.target.value }))}
            >
              <option value="">{t('grading.gb.notGraded')}</option>
              {cfg.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        ))}
        {cfg.items.length > 0 && (
          <button className={primaryBtnClass} disabled={!canEdit || busy || cfg.categories.length === 0} onClick={saveItems}>
            {t('grading.gb.saveItems')}
          </button>
        )}
        {cfg.categories.length === 0 && cfg.items.length > 0 && (
          <p className="text-[11px] text-ink-subtle">{t('grading.gb.saveCategoriesFirst')}</p>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="curve-h">
        <h4 id="curve-h" className="text-xs font-bold uppercase tracking-wider text-ink">
          {t('grading.gb.curve')}
        </h4>
        <div className="flex items-center gap-2">
          <select
            className={inputClass}
            aria-label={t('grading.gb.curveMethod')}
            disabled={!canEdit}
            value={method}
            onChange={(e) => setMethod(e.target.value as CurveMethod)}
          >
            {CURVE_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {t(`grading.gb.curve.${m}`)}
              </option>
            ))}
          </select>
          {method === 'ADD_POINTS' && (
            <input
              className={`${inputClass} w-24`}
              aria-label={t('grading.gb.pointsToAdd')}
              type="number"
              min={0.5}
              max={50}
              step="0.5"
              value={curveValue}
              disabled={!canEdit}
              onChange={(e) => setCurveValue(e.target.value)}
            />
          )}
          <button
            className={primaryBtnClass}
            disabled={!canEdit || busy || (method === 'ADD_POINTS' && !(Number(curveValue) > 0))}
            onClick={saveCurve}
          >
            {t('grading.gb.saveCurve')}
          </button>
        </div>
      </section>
    </div>
  );
};
