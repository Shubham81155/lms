"use client";

import React, { useEffect, useState } from "react";
import { LifeBuoy, LogOut } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

// Shown on every signed-in page while the platform operator is in this organisation on a support pass, so nobody
// mistakes the session for an ordinary one. It also notices when the pass is revoked or expires (the API then
// refuses the session) and leaves.

export interface SupportSession {
  passId: string;
  scope: "READ_ONLY" | "FULL";
  expiresAt: string;
  operatorEmail: string;
}

const CHECK_MS = 30_000;
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** The current support session (null for an ordinary one), checked again every 30 s while there is one. */
export function useSupportSession(): SupportSession | null {
  const { user } = useAuth();
  const [session, setSession] = useState<SupportSession | null>(null);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    const check = () =>
      api
        .get<{ data: SupportSession | null }>("/api/v1/support/session")
        .then((res) => alive && setSession(res.data))
        .catch((err) => {
          // Revoked or expired while open: the session is gone, so is the page.
          if (alive && err instanceof ApiError && err.status === 401 && session) window.location.assign("/login");
        });
    check();
    // Only a support session needs watching.
    const timer = session ? setInterval(check, CHECK_MS) : undefined;
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [user, session?.passId]); // eslint-disable-line react-hooks/exhaustive-deps

  return session;
}

export const SupportBanner: React.FC<{ session: SupportSession | null }> = ({ session }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!session) return null;

  const exit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ data: { redirect: string } }>("/api/v1/support/exit");
      window.location.assign(res.data.redirect);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not end the support session.");
      setBusy(false);
    }
  };

  const readOnly = session.scope === "READ_ONLY";
  return (
    <>
    {/* A frame round the whole window keeps the support session visible once the bar has scrolled away. */}
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[55] border-4 border-accent/70" />
    <div role="status" className="flex flex-wrap items-center justify-between gap-3 border-b border-accent/60 bg-accent/15 px-4 py-2 text-xs text-ink">
      <p className="flex min-w-0 items-center gap-2">
        <LifeBuoy className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
        <span>
          <span className="font-semibold">Support access by {session.operatorEmail}</span>
          {" — "}
          {readOnly ? "read-only, forms are locked" : "full access, every change is audited"}
          {" — "}ends at {time(session.expiresAt)}
        </span>
        {error && <span className="text-danger">{error}</span>}
      </p>
      <button
        type="button"
        onClick={exit}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-[11px] font-semibold text-ink transition-colors hover:bg-raised disabled:opacity-50"
      >
        <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
        {busy ? "Leaving…" : "Exit support session"}
      </button>
    </div>
    </>
  );
};
