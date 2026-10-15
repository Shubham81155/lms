// Shared look for the staff assessment screens, matching the question bank and gradebook.
export const input =
  "bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand disabled:opacity-60";
export const primary = "px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold transition-all";
export const ghost =
  "px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50";
export const danger = "px-3 py-1.5 bg-danger hover:opacity-90 disabled:opacity-50 text-on-brand rounded-lg text-[11px] font-bold transition-all";
export const card = "bg-canvas border border-line rounded-2xl p-4";

/** "MULTI_SELECT" -> "multi select" */
export const label = (s: string) => s.replace(/_/g, " ").toLowerCase();
