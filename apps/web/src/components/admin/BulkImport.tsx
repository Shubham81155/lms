'use client';

import React, { useState } from 'react';
import { Upload, Download } from 'lucide-react';
import { api } from '@/lib/api';
import { errorMessage } from '@/hooks/useApiData';
import { downloadCsv } from '@/lib/download';
import { toCsv } from '@/lib/csv';
import { Banner } from '@/components/admin/IdentityPanels';
import { card, ghost, primary } from '@/components/assessments/ui';
import { useT } from '@/lib/i18n';

interface ImportResult {
  dryRun: boolean;
  summary: { rows: number; toCreate: number; created: number; existing: number; enrolled: number; errors: number };
  rows: { line: number; email: string; status: 'CREATE' | 'CREATED' | 'EXISTS' | 'ERROR'; message: string | null; enrol: string | null }[];
}

const STATUS_TONE: Record<ImportResult['rows'][number]['status'], string> = {
  CREATE: 'text-brand-fg',
  CREATED: 'text-success',
  EXISTS: 'text-ink-muted',
  ERROR: 'text-danger',
};

const TEMPLATE = [
  ['email', 'first_name', 'last_name', 'role', 'course_code'],
  ['ada@university.edu', 'Ada', 'Lovelace', 'STUDENT', 'CS-101'],
  ['alan@university.edu', 'Alan', 'Turing', 'INSTRUCTOR', ''],
];

/**
 * Invite many people from a CSV file. The file is checked first (nothing changes), the administrator sees
 * every row's outcome, and only then confirms the import.
 */
export const BulkImport: React.FC<{ onDone: (text: string) => void; onCancel: () => void }> = ({ onDone, onCancel }) => {
  const t = useT();
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [sendInvitations, setSendInvitations] = useState(true);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (text: string, dryRun: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ data: ImportResult }>('/api/v1/users/import', { csv: text, dryRun, sendInvitations });
      if (dryRun) setPreview(res.data);
      else {
        const s = res.data.summary;
        onDone(
          t('people.bulk.doneLead', { created: t.number(s.created), enrolled: t.number(s.enrolled) }) +
            (s.existing ? t('people.bulk.doneExisting', { count: t.number(s.existing) }) : '') +
            (s.errors ? t('people.bulk.doneErrors', { count: t.number(s.errors) }) : '') +
            t('people.bulk.end')
        );
      }
    } catch (e) {
      setError(errorMessage(e, t('people.bulk.failed')));
      if (dryRun) setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2_000_000) return setError(t('people.bulk.tooBig'));
    const text = await file.text();
    setFileName(file.name);
    setCsv(text);
    run(text, true);
  };

  const s = preview?.summary;
  const actionable = s ? s.toCreate + s.existing : 0;

  return (
    <div className={`${card} space-y-3`}>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-bold text-ink">{t('people.bulk.title')}</h4>
        <button type="button" className={ghost} onClick={() => downloadCsv('people-template.csv', toCsv(TEMPLATE))}>
          <Download className="h-3 w-3 inline mr-1" />
          {t('people.bulk.template')}
        </button>
      </div>
      <p className="text-[11px] text-ink-muted">
        {t('people.bulk.helpLead')} <code>email</code>, <code>first_name</code>, <code>last_name</code>, {t('people.bulk.helpOptional')}{' '}
        <code>role</code> {t('people.bulk.helpRole')} <code>course_code</code> {t('people.bulk.helpCourse')} {t('people.bulk.helpTail')}
      </p>

      <label className="flex items-center gap-2 w-fit cursor-pointer rounded-xl border border-dashed border-line px-4 py-3 text-xs text-ink hover:border-brand/50">
        <Upload className="h-4 w-4 text-brand-fg" />
        <span>{fileName || t('people.bulk.choose')}</span>
        <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
      </label>

      {error && <Banner kind="error">{error}</Banner>}
      {busy && !preview && <p className="text-xs text-ink-muted">{t('people.bulk.checking')}</p>}

      {preview && s && (
        <>
          <p className="text-xs text-ink">
            {t('people.bulk.sumRows', { count: t.number(s.rows) })}{' '}
            <strong>{t('people.bulk.sumInvite', { count: t.number(s.toCreate) })}</strong>,{' '}
            {t('people.bulk.sumExisting', { count: t.number(s.existing) })},{' '}
            <span className={s.errors ? 'text-danger font-semibold' : ''}>
              {t('people.bulk.sumProblems', { count: t.number(s.errors) })}
            </span>
            {t('people.bulk.end')}
          </p>
          <div className="max-h-64 overflow-y-auto rounded-xl border border-line">
            <table className="w-full text-xs">
              <thead className="bg-surface text-left text-ink-subtle sticky top-0">
                <tr>
                  <th className="px-3 py-1.5 font-semibold">{t('people.bulk.colLine')}</th>
                  <th className="px-3 py-1.5 font-semibold">{t('people.bulk.colEmail')}</th>
                  <th className="px-3 py-1.5 font-semibold">{t('people.bulk.colOutcome')}</th>
                  <th className="px-3 py-1.5 font-semibold">{t('people.bulk.colCourse')}</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.line} className="border-t border-line">
                    <td className="px-3 py-1.5 text-ink-subtle">{r.line}</td>
                    <td className="px-3 py-1.5 text-ink">{r.email || '–'}</td>
                    <td className={`px-3 py-1.5 ${STATUS_TONE[r.status]}`}>
                      {t.dyn(`people.bulk.row.${r.status}`, r.status)}
                      {r.message && r.status !== 'CREATE' ? <span className="block text-[10px] text-ink-muted">{r.message}</span> : null}
                    </td>
                    <td className="px-3 py-1.5 text-ink-muted">{r.enrol ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="flex items-center gap-2 text-xs text-ink cursor-pointer w-fit">
            <input
              type="checkbox"
              checked={sendInvitations}
              onChange={(e) => setSendInvitations(e.target.checked)}
              className="rounded border-line"
            />
            {t('people.bulk.sendNow')}
          </label>
        </>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          className={primary}
          disabled={busy || !csv || !preview || actionable === 0}
          onClick={() => csv && run(csv, false)}
        >
          {busy && preview
            ? t('people.bulk.importing')
            : s
              ? s.existing
                ? t.plural('people.bulk.importEnrol', s.toCreate, { count: t.number(s.toCreate), existing: t.number(s.existing) })
                : t.plural('people.bulk.import', s.toCreate, { count: t.number(s.toCreate) })
              : t('people.bulk.importPlain')}
        </button>
        <button type="button" className={ghost} onClick={onCancel}>
          {t('people.bulk.cancel')}
        </button>
      </div>
    </div>
  );
};
