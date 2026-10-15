"use client";

import React, { useEffect, useRef, useState } from "react";
import { Code, X, Play, RotateCcw, Terminal, AlertCircle } from "lucide-react";
import { useEscapeKey } from "@/hooks/useEscapeKey";

interface CodeSandboxProps {
  /** Shown in the header. */
  title: string;
  /** The lesson's own text; it becomes the comment block at the top of the editor. */
  instructions?: string;
  onClose: () => void;
}

const TIME_LIMIT_MS = 3000;

// Runs in a worker so a learner's code cannot touch the page, and so a runaway loop can be stopped.
const WORKER_SOURCE = `
const fmt = (a) => a.map((x) => { try { return typeof x === "object" ? JSON.stringify(x) : String(x); } catch { return String(x); } }).join(" ");
self.onmessage = (e) => {
  const lines = [];
  const sandboxConsole = { log: (...a) => lines.push(fmt(a)), info: (...a) => lines.push(fmt(a)), warn: (...a) => lines.push("[warn] " + fmt(a)), error: (...a) => lines.push("[error] " + fmt(a)) };
  try {
    new Function("console", e.data)(sandboxConsole);
    self.postMessage({ lines });
  } catch (err) {
    self.postMessage({ lines, error: String(err && err.message ? err.message : err) });
  }
};`;

const starterFor = (instructions?: string) => {
  const header = (instructions ?? "")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => `// ${l}`)
    .join("\n");
  return `${header ? `${header}\n\n` : ""}// Write your code below, then press Run.\n`;
};

export const CodeSandbox: React.FC<CodeSandboxProps> = ({ title, instructions, onClose }) => {
  useEscapeKey(onClose);
  const starter = starterFor(instructions);
  const [code, setCode] = useState(starter);
  const [output, setOutput] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const worker = useRef<Worker | null>(null);

  useEffect(() => () => worker.current?.terminate(), []);

  const run = () => {
    worker.current?.terminate();
    setIsRunning(true);
    setOutput(null);
    setError(null);

    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
    const w = new Worker(url);
    worker.current = w;

    const finish = (lines: string[], err: string | null) => {
      clearTimeout(timer);
      w.terminate();
      URL.revokeObjectURL(url);
      setOutput(lines);
      setError(err);
      setIsRunning(false);
    };
    const timer = setTimeout(() => finish([], `Stopped: the code ran for more than ${TIME_LIMIT_MS / 1000} seconds.`), TIME_LIMIT_MS);

    w.onmessage = (e: MessageEvent<{ lines: string[]; error?: string }>) => finish(e.data.lines, e.data.error ?? null);
    w.onerror = (e) => finish([], e.message || "The code could not be run.");
    w.postMessage(code);
  };

  return (
    <div className="fixed inset-0 z-50 bg-canvas/85 backdrop-blur-md flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Code sandbox">
      <div className="bg-surface border border-line rounded-3xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="bg-canvas border-b border-line px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-success/20 border border-success/40 text-success flex items-center justify-center">
              <Code className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-ink">{title}</h3>
              <p className="text-[11px] text-ink-muted">Practice sandbox · JavaScript · runs in your browser, nothing is graded or saved</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded-lg hover:bg-raised text-ink-muted hover:text-ink transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 overflow-hidden">
          <div className="flex flex-col border-b md:border-b-0 md:border-r border-line bg-canvas">
            <div className="px-4 py-2.5 bg-surface/60 border-b border-line/80 flex items-center justify-between text-xs text-ink-muted">
              <span className="font-mono text-[11px] text-ink">solution.js</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setCode(starter)} className="p-1 hover:text-ink text-ink-muted transition-colors" title="Reset code" aria-label="Reset code">
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={run}
                  disabled={isRunning}
                  className="px-3 py-1 bg-brand hover:bg-brand-hover disabled:opacity-60 text-on-brand rounded-lg text-xs font-bold flex items-center gap-1 shadow-md transition-all"
                >
                  <Play className="h-3 w-3 fill-current" />
                  <span>{isRunning ? "Running…" : "Run"}</span>
                </button>
              </div>
            </div>
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              spellCheck={false}
              aria-label="Code editor"
              className="flex-1 w-full bg-canvas p-4 font-mono text-xs text-success focus:outline-none resize-none selection:bg-brand/40"
            />
          </div>

          <div className="flex flex-col bg-surface/40 overflow-hidden">
            <div className="px-4 py-2.5 bg-surface/80 border-b border-line/80 text-xs font-bold text-ink flex items-center gap-2">
              <Terminal className="h-3.5 w-3.5 text-brand-fg" />
              <span>Output</span>
            </div>
            <div className="flex-1 p-4 overflow-y-auto space-y-3 font-mono text-xs">
              <div className="bg-canvas rounded-2xl p-4 border border-line text-ink space-y-1 min-h-36" aria-live="polite">
                {output === null && !error ? (
                  <p className="text-ink-subtle italic font-sans">Press Run to execute your code. console.log output appears here.</p>
                ) : output && output.length > 0 ? (
                  output.map((line, i) => <p key={i}>{line}</p>)
                ) : (
                  !error && <p className="text-ink-subtle italic font-sans">The code ran and printed nothing.</p>
                )}
              </div>
              {error && (
                <div role="alert" className="p-3 rounded-xl border border-danger/30 bg-danger/10 text-danger flex items-start gap-2.5">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span className="font-sans font-semibold">{error}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
