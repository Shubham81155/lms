"use client";

import React, { useEffect, useState } from "react";
import { CheckCircle2, KeyRound, PlugZap, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useAction, useApiData } from "@/hooks/useApiData";
import { Banner } from "./IdentityPanels";

type Provider = "ANTHROPIC" | "GEMINI" | "XAI";

interface AiSettings {
  provider: Provider | null;
  model: string | null;
  enabled: boolean;
  hasKey: boolean;
  keyHint: string | null;
  updatedAt: string | null;
  onPlan: boolean;
  effectiveSource: "TENANT" | "PLATFORM" | null;
  platformDefault: { provider: Provider; model: string } | null;
  providers: { id: Provider; label: string; defaultModel: string; suggestedModels: string[]; keyHelp: string }[];
}

interface TestResult {
  ok: boolean;
  error: string | null;
  provider: Provider | null;
  model: string | null;
  ms: number;
}

const field =
  "w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand";
const primaryBtn = "px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold transition-all";
const ghostBtn =
  "px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50";

/**
 * Administrators choose the AI provider (Claude, Gemini or Grok), the model and the API key used for the
 * study tutor and course-outline drafts. The key is write-only: after saving, only its last four characters show.
 */
export const AiSettingsPanel: React.FC = () => {
  const { data, error, reload } = useApiData<{ data: AiSettings }>("/api/v1/ai/settings");
  const { busy, error: actionError, run } = useAction();
  const s = data?.data;

  const [provider, setProvider] = useState<Provider>("ANTHROPIC");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [saved, setSaved] = useState<string | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);

  useEffect(() => {
    if (!s) return;
    setProvider(s.provider ?? s.platformDefault?.provider ?? "ANTHROPIC");
    setModel(s.model ?? "");
    setEnabled(s.enabled);
  }, [s]);

  const info = s?.providers.find((p) => p.id === provider);
  const switchingProvider = !!s?.provider && s.provider !== provider;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(null);
    setTest(null);
    run(async () => {
      await api.put("/api/v1/ai/settings", {
        provider,
        model: model.trim(),
        enabled,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : switchingProvider && s?.hasKey ? { apiKey: null } : {}),
      });
      setApiKey("");
      setSaved("AI settings saved.");
      await reload();
    });
  };

  const removeKey = () =>
    run(async () => {
      if (!s?.provider) return;
      await api.put("/api/v1/ai/settings", { provider: s.provider, model: s.model ?? "", enabled: s.enabled, apiKey: null });
      setSaved("The saved key was removed.");
      setTest(null);
      await reload();
    });

  const runTest = () =>
    run(async () => {
      setTest(null);
      const res = await api.post<{ data: TestResult }>("/api/v1/ai/settings/test", {});
      setTest(res.data);
    });

  const sourceText =
    s?.effectiveSource === "TENANT"
      ? `In use: your organisation's ${s.providers.find((p) => p.id === s.provider)?.label ?? s.provider} key (${s.keyHint}), model ${s.model}.`
      : s?.effectiveSource === "PLATFORM"
        ? `In use: the platform default (${s.providers.find((p) => p.id === s.platformDefault?.provider)?.label ?? ""}, ${s.platformDefault?.model}). Save your own key to use your own account.`
        : !s?.onPlan
          ? "AI assistance is not part of your plan, so nothing is in use."
          : !s?.enabled
            ? "AI assistance is turned off for your organisation."
            : "No key is in use yet. Learners and instructors do not see the AI features until one is saved.";

  return (
    <section className="space-y-4" aria-labelledby="ai-heading">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 id="ai-heading" className="font-bold text-base text-ink">AI assistance</h3>
          <p className="text-xs text-ink-muted max-w-2xl">
            The study tutor for learners and course-outline drafts for instructors. Questions and course content are sent to the provider you choose;
            names and e-mail addresses are not. Usage is billed to the key's account.
          </p>
        </div>
        <button className={ghostBtn} onClick={runTest} disabled={busy || !s || !s.effectiveSource}>
          <PlugZap className="h-3.5 w-3.5 inline mr-1" />
          Test connection
        </button>
      </div>

      {error && <Banner kind="error">{error}</Banner>}
      {actionError && <Banner kind="error">{actionError}</Banner>}
      {saved && <Banner kind="ok">{saved}</Banner>}
      {test && (
        <div role="status" className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${test.ok ? "border-success/40 bg-success/10 text-ink" : "border-danger/40 bg-danger/10 text-ink"}`}>
          {test.ok ? <CheckCircle2 className="h-4 w-4 text-success shrink-0" /> : <XCircle className="h-4 w-4 text-danger shrink-0" />}
          <span>{test.ok ? `Connected to ${test.model} in ${(test.ms / 1000).toFixed(1)} s.` : test.error}</span>
        </div>
      )}

      {s && <p className="text-xs text-ink">{sourceText}</p>}
      {s && !s.onPlan && <Banner kind="error">Your plan does not include AI assistance. The platform operator can add it.</Banner>}

      {s && (
        <form onSubmit={save} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <fieldset className="md:col-span-2 space-y-2">
            <legend className="text-xs font-semibold text-ink-muted mb-1">Provider</legend>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {s.providers.map((p) => (
                <label
                  key={p.id}
                  className={`cursor-pointer rounded-2xl border p-3 text-xs transition-colors ${provider === p.id ? "border-brand bg-brand/10" : "border-line bg-canvas hover:border-brand/40"}`}
                >
                  <input
                    type="radio"
                    name="ai-provider"
                    value={p.id}
                    checked={provider === p.id}
                    onChange={() => {
                      setProvider(p.id);
                      setModel(p.id === s.provider ? (s.model ?? "") : "");
                    }}
                    className="sr-only"
                  />
                  <div className="font-semibold text-ink">{p.label}</div>
                  <div className="text-[11px] text-ink-subtle">Default model: {p.defaultModel}</div>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <label htmlFor="ai-model" className="text-xs font-semibold text-ink-muted">
              Model
            </label>
            <input
              id="ai-model"
              list="ai-models"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={info ? `${info.defaultModel} (recommended)` : ""}
              maxLength={100}
              className={field}
            />
            <datalist id="ai-models">
              {info?.suggestedModels.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <p className="text-[11px] text-ink-subtle">Leave empty for the recommended model, or type any model id your account can use.</p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="ai-key" className="text-xs font-semibold text-ink-muted">
              API key
            </label>
            <div className="relative">
              <KeyRound className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
              <input
                id="ai-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={s.hasKey && !switchingProvider ? `Saved (${s.keyHint}). Enter a new key to replace it.` : "Paste the key"}
                maxLength={500}
                className={`${field} pl-8`}
              />
            </div>
            <p className="text-[11px] text-ink-subtle">
              {info?.keyHelp} Stored encrypted; it cannot be viewed again after saving.
              {switchingProvider && s.hasKey ? " Switching provider removes the saved key unless you enter one for the new provider." : ""}
            </p>
          </div>

          <label className="md:col-span-2 flex items-center gap-2 text-xs text-ink cursor-pointer w-fit">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="rounded border-line" />
            <span>AI assistance is on for this organisation</span>
          </label>

          <div className="md:col-span-2 flex flex-wrap items-center gap-2">
            <button type="submit" className={primaryBtn} disabled={busy}>
              {busy ? "Saving…" : "Save AI settings"}
            </button>
            {s.hasKey && (
              <button type="button" className={ghostBtn} onClick={removeKey} disabled={busy}>
                Remove saved key
              </button>
            )}
            {s.updatedAt && <span className="text-[11px] text-ink-subtle">Last changed {new Date(s.updatedAt).toLocaleString()}</span>}
          </div>
        </form>
      )}
    </section>
  );
};
