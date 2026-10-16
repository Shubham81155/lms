"use client";

import React, { useState } from "react";
import { Upload, Download } from "lucide-react";
import { api } from "@/lib/api";
import { errorMessage } from "@/hooks/useApiData";
import { downloadCsv } from "@/lib/download";
import { toCsv } from "@/lib/csv";
import { Banner } from "@/components/admin/IdentityPanels";
import { card, ghost, primary } from "@/components/assessments/ui";

interface ImportResult {
  dryRun: boolean;
  summary: { rows: number; toCreate: number; created: number; existing: number; enrolled: number; errors: number };
  rows: { line: number; email: string; status: "CREATE" | "CREATED" | "EXISTS" | "ERROR"; message: string | null; enrol: string | null }[];
}

const STATUS_TEXT: Record<ImportResult["rows"][number]["status"], { text: string; tone: string }> = {
  CREATE: { text: "Will invite", tone: "text-brand-fg" },
  CREATED: { text: "Invited", tone: "text-success" },
  EXISTS: { text: "Has an account", tone: "text-ink-muted" },
  ERROR: { text: "Problem", tone: "text-danger" },
};

const TEMPLATE = [
  ["email", "first_name", "last_name", "role", "course_code"],
  ["ada@university.edu", "Ada", "Lovelace", "STUDENT", "CS-101"],
  ["alan@university.edu", "Alan", "Turing", "INSTRUCTOR", ""],
];

/**
 * Invite many people from a CSV file. The file is checked first (nothing changes), the administrator sees
 * every row's outcome, and only then confirms the import.
 */
export const BulkImport: React.FC<{ onDone: (text: string) => void; onCancel: () => void }> = ({ onDone, onCancel }) => {
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [sendInvitations, setSendInvitations] = useState(true);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (text: string, dryRun: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ data: ImportResult }>("/api/v1/users/import", { csv: text, dryRun, sendInvitations });
      if (dryRun) setPreview(res.data);
      else {
        const s = res.data.summary;
        onDone(
          `Imported: ${s.created} invited, ${s.enrolled} enrolled in a course${s.existing ? `, ${s.existing} already had accounts` : ""}${s.errors ? `, ${s.errors} rows skipped` : ""}.`
        );
      }
    } catch (e) {
      setError(errorMessage(e, "The file could not be imported."));
      if (dryRun) setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2_000_000) return setError("The file is larger than 2 MB. Split it into smaller files.");
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
        <h4 className="text-sm font-bold text-ink">Import people from a CSV file</h4>
        <button type="button" className={ghost} onClick={() => downloadCsv("people-template.csv", toCsv(TEMPLATE))}>
          <Download className="h-3 w-3 inline mr-1" />
          Template
        </button>
      </div>
      <p className="text-[11px] text-ink-muted">
        Columns: <code>email</code>, <code>first_name</code>, <code>last_name</code>, and optionally <code>role</code> (default student) and <code>course_code</code> to enrol
        them. Up to 2,000 people per file. The file is checked first; nothing changes until you confirm.
      </p>

      <label className="flex items-center gap-2 w-fit cursor-pointer rounded-xl border border-dashed border-line px-4 py-3 text-xs text-ink hover:border-brand/50">
        <Upload className="h-4 w-4 text-brand-fg" />
        <span>{fileName || "Choose a CSV file"}</span>
        <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
      </label>

      {error && <Banner kind="error">{error}</Banner>}
      {busy && !preview && <p className="text-xs text-ink-muted">Checking the file…</p>}

      {preview && s && (
        <>
          <p className="text-xs text-ink">
            {s.rows} rows: <strong>{s.toCreate} to invite</strong>, {s.existing} already have accounts, <span className={s.errors ? "text-danger font-semibold" : ""}>{s.errors} with problems</span>.
          </p>
          <div className="max-h-64 overflow-y-auto rounded-xl border border-line">
            <table className="w-full text-xs">
              <thead className="bg-surface text-left text-ink-subtle sticky top-0">
                <tr>
                  <th className="px-3 py-1.5 font-semibold">Line</th>
                  <th className="px-3 py-1.5 font-semibold">E-mail</th>
                  <th className="px-3 py-1.5 font-semibold">Outcome</th>
                  <th className="px-3 py-1.5 font-semibold">Course</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.line} className="border-t border-line">
                    <td className="px-3 py-1.5 text-ink-subtle">{r.line}</td>
                    <td className="px-3 py-1.5 text-ink">{r.email || "–"}</td>
                    <td className={`px-3 py-1.5 ${STATUS_TEXT[r.status].tone}`}>
                      {STATUS_TEXT[r.status].text}
                      {r.message && r.status !== "CREATE" ? <span className="block text-[10px] text-ink-muted">{r.message}</span> : null}
                    </td>
                    <td className="px-3 py-1.5 text-ink-muted">{r.enrol ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="flex items-center gap-2 text-xs text-ink cursor-pointer w-fit">
            <input type="checkbox" checked={sendInvitations} onChange={(e) => setSendInvitations(e.target.checked)} className="rounded border-line" />
            E-mail invitations now (otherwise send them later from each person's row)
          </label>
        </>
      )}

      <div className="flex gap-2">
        <button type="button" className={primary} disabled={busy || !csv || !preview || actionable === 0} onClick={() => csv && run(csv, false)}>
          {busy && preview ? "Importing…" : s ? `Import ${s.toCreate} ${s.toCreate === 1 ? "person" : "people"}${s.existing ? ` and enrol ${s.existing} existing` : ""}` : "Import"}
        </button>
        <button type="button" className={ghost} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
};
