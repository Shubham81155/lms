'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Code, X, Play, RotateCcw, Terminal, AlertCircle } from 'lucide-react';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useT } from '@/lib/i18n';

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

/** What went wrong, kept as a kind so the message follows the language at render time; `raw` is the browser's own text. */
type RunError = { kind: 'timeout' } | { kind: 'failed' } | { kind: 'raw'; text: string };

const starterFor = (instructions: string | undefined, hint: string) => {
  const header = (instructions ?? '')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => `// ${l}`)
    .join('\n');
  return `${header ? `${header}\n\n` : ''}${hint}\n`;
};

export const CodeSandbox: React.FC<CodeSandboxProps> = ({ title, instructions, onClose }) => {
  useEscapeKey(onClose);
  const t = useT();
  const starter = starterFor(instructions, t('learn.sandbox.starter'));
  const [code, setCode] = useState(starter);
  const [output, setOutput] = useState<string[] | null>(null);
  const [error, setError] = useState<RunError | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const worker = useRef<Worker | null>(null);

  useEffect(() => () => worker.current?.terminate(), []);

  const run = () => {
    worker.current?.terminate();
    setIsRunning(true);
    setOutput(null);
    setError(null);

    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
    const w = new Worker(url);
    worker.current = w;

    const finish = (lines: string[], err: RunError | null) => {
      clearTimeout(timer);
      w.terminate();
      URL.revokeObjectURL(url);
      setOutput(lines);
      setError(err);
      setIsRunning(false);
    };
    const timer = setTimeout(() => finish([], { kind: 'timeout' }), TIME_LIMIT_MS);

    w.onmessage = (e: MessageEvent<{ lines: string[]; error?: string }>) =>
      finish(e.data.lines, e.data.error ? { kind: 'raw', text: e.data.error } : null);
    w.onerror = (e) => finish([], e.message ? { kind: 'raw', text: e.message } : { kind: 'failed' });
    w.postMessage(code);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-canvas/85 backdrop-blur-md flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('learn.sandbox.dialog')}
    >
      <div className="bg-surface border border-line rounded-3xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="bg-canvas border-b border-line px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-success/20 border border-success/40 text-success flex items-center justify-center">
              <Code className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-ink">{title}</h3>
              <p className="text-[11px] text-ink-muted">{t('learn.sandbox.subtitle')}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="p-1 rounded-lg hover:bg-raised text-ink-muted hover:text-ink transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 overflow-hidden">
          <div className="flex flex-col border-b md:border-b-0 md:border-r border-line bg-canvas">
            <div className="px-4 py-2.5 bg-surface/60 border-b border-line/80 flex items-center justify-between text-xs text-ink-muted">
              <span className="font-mono text-[11px] text-ink">solution.js</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCode(starter)}
                  className="p-1 hover:text-ink text-ink-muted transition-colors"
                  title={t('learn.sandbox.reset')}
                  aria-label={t('learn.sandbox.reset')}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={run}
                  disabled={isRunning}
                  className="px-3 py-1 bg-brand hover:bg-brand-hover disabled:opacity-60 text-on-brand rounded-lg text-xs font-bold flex items-center gap-1 shadow-md transition-all"
                >
                  <Play className="h-3 w-3 fill-current" />
                  <span>{isRunning ? t('learn.sandbox.running') : t('learn.sandbox.run')}</span>
                </button>
              </div>
            </div>
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              spellCheck={false}
              aria-label={t('learn.sandbox.editor')}
              className="flex-1 w-full bg-canvas p-4 font-mono text-xs text-success focus:outline-none resize-none selection:bg-brand/40"
            />
          </div>

          <div className="flex flex-col bg-surface/40 overflow-hidden">
            <div className="px-4 py-2.5 bg-surface/80 border-b border-line/80 text-xs font-bold text-ink flex items-center gap-2">
              <Terminal className="h-3.5 w-3.5 text-brand-fg" />
              <span>{t('learn.sandbox.output')}</span>
            </div>
            <div className="flex-1 p-4 overflow-y-auto space-y-3 font-mono text-xs">
              <div className="bg-canvas rounded-2xl p-4 border border-line text-ink space-y-1 min-h-36" aria-live="polite">
                {output === null && !error ? (
                  <p className="text-ink-subtle italic font-sans">{t('learn.sandbox.idle')}</p>
                ) : output && output.length > 0 ? (
                  output.map((line, i) => <p key={i}>{line}</p>)
                ) : (
                  !error && <p className="text-ink-subtle italic font-sans">{t('learn.sandbox.noOutput')}</p>
                )}
              </div>
              {error && (
                <div role="alert" className="p-3 rounded-xl border border-danger/30 bg-danger/10 text-danger flex items-start gap-2.5">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span className="font-sans font-semibold">
                    {error.kind === 'timeout'
                      ? t.plural('learn.sandbox.timeout', TIME_LIMIT_MS / 1000)
                      : error.kind === 'failed'
                        ? t('learn.sandbox.failed')
                        : error.text}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
