"use client";

import React, { useEffect, useState } from "react";
import {
  X,
  Activity,
  Terminal,
  Search,
  Filter,
  CheckCircle2,
  Copy,
  Download,
  Clock,
  Sparkles,
} from "lucide-react";
import { useXApiStream, XApiStatementItem } from "@/hooks/useAnalytics";
import { plural } from "@/lib/plural";

interface LrsAnalyticsViewerProps {
  onClose: () => void;
}

export const LrsAnalyticsViewer: React.FC<LrsAnalyticsViewerProps> = ({ onClose }) => {
  const [selectedVerb, setSelectedVerb] = useState<string>("ALL");
  const [selectedStatement, setSelectedStatement] = useState<XApiStatementItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { statements, total, isLoading, refetch } = useXApiStream(30);

  const filteredStatements = statements.filter((s) => {
    if (selectedVerb === "ALL") return true;
    return s.verb.display?.["en-US"]?.toLowerCase() === selectedVerb.toLowerCase();
  });

  const activeStatement = selectedStatement || filteredStatements[0];

  const handleCopyJson = (stmt: XApiStatementItem) => {
    navigator.clipboard.writeText(JSON.stringify(stmt, null, 2));
    setCopiedId(stmt.id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-canvas/85 backdrop-blur-md flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="lrs-h">
      <div className="bg-surface border border-line rounded-3xl w-full max-w-6xl h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="bg-canvas border-b border-line px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-cyan-600/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 id="lrs-h" className="font-bold text-base text-ink">Learning Record Store (LRS) Telemetry Stream</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800">
                  IEEE / ADL xAPI 2.0 Spec
                </span>
              </div>
              <p className="text-xs text-ink-muted">
                Immutable event stream tracking learner interactions, simulations, and assessment telemetry.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => refetch()}
              className="px-3.5 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <span>Refresh Stream</span>
            </button>
            <button
              onClick={onClose}
              aria-label="Close"
              className="p-1 rounded-xl hover:bg-raised text-ink-muted hover:text-ink transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Verb Filter Toolbar */}
        <div className="bg-canvas/60 border-b border-line px-6 py-2.5 flex items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-2 overflow-x-auto">
            <span className="text-ink-subtle uppercase font-bold text-[11px] shrink-0">Filter Verbs:</span>
            {["ALL", "experienced", "passed", "answered", "completed"].map((verb) => (
              <button
                key={verb}
                onClick={() => setSelectedVerb(verb)}
                className={`px-3 py-1 rounded-xl font-semibold capitalize whitespace-nowrap transition-colors ${
                  selectedVerb === verb
                    ? "bg-cyan-600 text-ink"
                    : "text-ink-muted hover:text-ink bg-surface border border-line"
                }`}
              >
                {verb}
              </button>
            ))}
          </div>

          <span className="text-ink-muted text-xs font-mono hidden sm:inline">
            Total Captured: {plural(total || statements.length, "Statement")}
          </span>
        </div>

        {/* Main Split Grid */}
        <div className="flex-1 flex overflow-hidden">
          {/* Statement Feed Left */}
          <div className="w-full md:w-1/2 border-r border-line overflow-y-auto p-4 space-y-3 bg-canvas/30">
            {filteredStatements.length === 0 ? (
              <div className="p-8 text-center text-ink-subtle text-xs">
                No statements match this filter criteria.
              </div>
            ) : (
              filteredStatements.map((stmt) => {
                const isSelected = activeStatement?.id === stmt.id;
                const verbDisplay = stmt.verb.display?.["en-US"] || stmt.verb.id.split("/").pop() || "interacted";

                return (
                  <div
                    key={stmt.id}
                    onClick={() => setSelectedStatement(stmt)}
                    className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
                      isSelected
                        ? "bg-cyan-950/30 border-cyan-600/60 shadow-md"
                        : "bg-canvas border-line/80 hover:border-line"
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-bold text-ink">{stmt.actor.name || stmt.actor.mbox?.replace("mailto:", "")}</span>
                      <span className="text-ink-subtle font-mono text-[10px]">
                        {new Date(stmt.timestamp).toLocaleTimeString()}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-surface text-cyan-400 border border-line">
                        {verbDisplay}
                      </span>
                      <span className="text-xs text-ink font-medium truncate">
                        {stmt.object.definition?.name?.["en-US"] || stmt.object.id}
                      </span>
                    </div>

                    {stmt.result && (
                      <div className="mt-2 text-[10px] text-success font-mono">
                        {stmt.result.score?.raw !== undefined && `Score: ${stmt.result.score.raw}% `}
                        {stmt.result.duration && `Duration: ${stmt.result.duration}`}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Statement Raw JSON Inspector Right */}
          {activeStatement && (
            <div className="hidden md:flex flex-1 flex-col overflow-hidden bg-canvas/80">
              <div className="p-4 border-b border-line flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-mono text-cyan-400">
                  <Terminal className="h-4 w-4" />
                  <span>Statement Inspector: {activeStatement.id}</span>
                </div>
                <button
                  onClick={() => handleCopyJson(activeStatement)}
                  className="px-2.5 py-1 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  {copiedId === activeStatement.id ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                      <span className="text-success">Copied JSON</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copy JSON</span>
                    </>
                  )}
                </button>
              </div>

              <div className="flex-1 p-5 overflow-y-auto font-mono text-xs text-ink bg-canvas">
                <pre className="whitespace-pre-wrap leading-relaxed">
                  {JSON.stringify(activeStatement, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
