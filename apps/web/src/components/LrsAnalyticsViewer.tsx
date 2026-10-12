"use client";

import React, { useState } from "react";
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
    return s.verb.display["en-US"]?.toLowerCase() === selectedVerb.toLowerCase();
  });

  const activeStatement = selectedStatement || filteredStatements[0];

  const handleCopyJson = (stmt: XApiStatementItem) => {
    navigator.clipboard.writeText(JSON.stringify(stmt, null, 2));
    setCopiedId(stmt.id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-6xl h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="bg-slate-950 border-b border-slate-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-cyan-600/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-white">Learning Record Store (LRS) Telemetry Stream</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800">
                  IEEE / ADL xAPI 2.0 Spec
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Immutable event stream tracking learner interactions, simulations, and assessment telemetry.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => refetch()}
              className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <span>Refresh Stream</span>
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Verb Filter Toolbar */}
        <div className="bg-slate-950/60 border-b border-slate-800 px-6 py-2.5 flex items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-2 overflow-x-auto">
            <span className="text-slate-500 uppercase font-bold text-[11px] shrink-0">Filter Verbs:</span>
            {["ALL", "experienced", "passed", "answered", "completed"].map((verb) => (
              <button
                key={verb}
                onClick={() => setSelectedVerb(verb)}
                className={`px-3 py-1 rounded-xl font-semibold capitalize whitespace-nowrap transition-colors ${
                  selectedVerb === verb
                    ? "bg-cyan-600 text-white"
                    : "text-slate-400 hover:text-slate-200 bg-slate-900 border border-slate-800"
                }`}
              >
                {verb}
              </button>
            ))}
          </div>

          <span className="text-slate-400 text-xs font-mono hidden sm:inline">
            Total Captured: {total || statements.length} Statements
          </span>
        </div>

        {/* Main Split Grid */}
        <div className="flex-1 flex overflow-hidden">
          {/* Statement Feed Left */}
          <div className="w-full md:w-1/2 border-r border-slate-800 overflow-y-auto p-4 space-y-3 bg-slate-950/30">
            {filteredStatements.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs">
                No statements match this filter criteria.
              </div>
            ) : (
              filteredStatements.map((stmt) => {
                const isSelected = activeStatement?.id === stmt.id;
                const verbDisplay = stmt.verb.display["en-US"] || "interacted";

                return (
                  <div
                    key={stmt.id}
                    onClick={() => setSelectedStatement(stmt)}
                    className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
                      isSelected
                        ? "bg-cyan-950/30 border-cyan-600/60 shadow-md"
                        : "bg-slate-950 border-slate-800/80 hover:border-slate-700"
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-bold text-slate-200">{stmt.actor.name}</span>
                      <span className="text-slate-500 font-mono text-[10px]">
                        {new Date(stmt.timestamp).toLocaleTimeString()}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-slate-900 text-cyan-400 border border-slate-800">
                        {verbDisplay}
                      </span>
                      <span className="text-xs text-slate-300 font-medium truncate">
                        {stmt.object.definition.name["en-US"]}
                      </span>
                    </div>

                    {stmt.result && (
                      <div className="mt-2 text-[10px] text-emerald-400 font-mono">
                        {stmt.result.score && `Score: ${stmt.result.score.raw}% `}
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
            <div className="hidden md:flex flex-1 flex-col overflow-hidden bg-slate-950/80">
              <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-mono text-cyan-400">
                  <Terminal className="h-4 w-4" />
                  <span>Statement Inspector: {activeStatement.id}</span>
                </div>
                <button
                  onClick={() => handleCopyJson(activeStatement)}
                  className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  {copiedId === activeStatement.id ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copied JSON</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copy JSON</span>
                    </>
                  )}
                </button>
              </div>

              <div className="flex-1 p-5 overflow-y-auto font-mono text-xs text-slate-300 bg-slate-950">
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
