"use client";

import React from "react";
import { Clock, Lock } from "lucide-react";
import { useApiData } from "@/hooks/useApiData";

export interface TrialStatus {
  /** NONE: no trial (a paid organisation); TRIAL: running; READ_ONLY: ended, read-only until `readOnlyUntil`, then suspended. */
  state: "NONE" | "TRIAL" | "READ_ONLY";
  trialEndsAt: string | null;
  /** Whole days left of a running trial. */
  daysLeft: number | null;
  readOnlyUntil: string | null;
  /** The read-only period follows a lapsed subscription, not an ended trial. */
  paymentLapsed?: boolean;
}

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "long" });

/** "in 5 days", "tomorrow", "today". */
export function trialEndsText(daysLeft: number | null, trialEndsAt: string | null): string {
  if (daysLeft === null) return trialEndsAt ? `on ${day(trialEndsAt)}` : "soon";
  if (daysLeft <= 0) return "today";
  if (daysLeft === 1) return "tomorrow";
  return `in ${daysLeft} days`;
}

const BillingLink: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button type="button" className="font-semibold text-brand-fg underline" onClick={onClick}>
    Choose a plan
  </button>
);

/** The administrator's notice of the organisation's trial: how long it has left, or that it has ended and the organisation is read-only. */
export const TrialBanner: React.FC<{ onOpenBilling?: () => void }> = ({ onOpenBilling }) => {
  const trial = useApiData<{ data: TrialStatus }>("/api/v1/trial");
  const t = trial.data?.data;
  if (!t || t.state === "NONE") return null;

  if (t.state === "READ_ONLY") {
    return (
      <div role="alert" className="flex items-start gap-3 rounded-2xl border border-danger/40 bg-danger/5 p-4 text-sm text-ink">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
        <p>
          <span className="font-semibold">{t.paymentLapsed ? "Your subscription has lapsed" : "Your trial has ended"}</span> — the organisation is read-only
          {t.readOnlyUntil ? ` until ${day(t.readOnlyUntil)}, when it will be suspended` : ""}. {onOpenBilling ? <BillingLink onClick={onOpenBilling} /> : "Contact us to continue."}
        </p>
      </div>
    );
  }

  const urgent = t.daysLeft !== null && t.daysLeft <= 7;
  return (
    <div role="status" className={`flex items-start gap-3 rounded-2xl border p-4 text-sm text-ink ${urgent ? "border-accent/50 bg-accent/10" : "border-line bg-surface"}`}>
      <Clock className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
      <p>
        <span className="font-semibold">Your trial ends {trialEndsText(t.daysLeft, t.trialEndsAt)}</span>
        {t.trialEndsAt ? ` (${day(t.trialEndsAt)})` : ""}. Afterwards the organisation becomes read-only until it is converted to a paid plan. {onOpenBilling ? <BillingLink onClick={onOpenBilling} /> : "Contact us to continue."}
      </p>
    </div>
  );
};
