"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { AuthCard, buttonClass } from "@/components/AuthCard";
import { Banner } from "@/components/admin/IdentityPanels";

interface Info {
  organisation: string;
  firstName: string;
  expiresAt: string;
}

function GuardianConsent() {
  const token = useSearchParams().get("token") ?? "";
  const [info, setInfo] = useState<Info | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "done" | "error">("loading");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setState("error");
      setMessage("This link is incomplete.");
      return;
    }
    api
      .get<{ data: Info }>("/api/v1/privacy/guardian-consent", { params: { token } })
      .then((res) => {
        setInfo(res.data);
        setState("ready");
      })
      .catch((err) => {
        setState("error");
        setMessage(err instanceof ApiError ? err.message : "This link could not be checked.");
      });
  }, [token]);

  const confirm = async () => {
    setBusy(true);
    setMessage("");
    try {
      await api.post("/api/v1/privacy/guardian-consent", { token });
      setState("done");
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Consent could not be recorded. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Parent or guardian consent">
      {state === "loading" && <p role="status" className="text-xs text-center text-ink">Checking the link...</p>}
      {state === "error" && <Banner kind="error">{message || "This link is not valid. It may have expired or already been used."}</Banner>}
      {state === "ready" && info && (
        <div className="space-y-4">
          <p className="text-xs text-ink leading-relaxed">
            <strong>{info.firstName}</strong> is under 18 and uses the learning platform of <strong>{info.organisation}</strong>. Under India&apos;s Digital Personal
            Data Protection Act, 2023, the organisation needs a parent or guardian to agree before it uses {info.firstName}&apos;s personal data.
          </p>
          <p className="text-[11px] text-ink-muted">
            By confirming, you agree on {info.firstName}&apos;s behalf to the purposes the organisation lists in its{" "}
            <Link href="/privacy" className="text-brand-fg hover:underline underline-offset-2">privacy notice</Link>. This link works once and stops working on{" "}
            {new Date(info.expiresAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}.
          </p>
          {message && <Banner kind="error">{message}</Banner>}
          <button type="button" onClick={confirm} disabled={busy} className={buttonClass}>
            {busy ? "Saving..." : "I am the parent or guardian and I consent"}
          </button>
        </div>
      )}
      {state === "done" && <Banner kind="ok">Thank you. Your consent is recorded and {info?.firstName ?? "your child"} can now continue. You can close this page.</Banner>}
    </AuthCard>
  );
}

export default function GuardianConsentPage() {
  return (
    <Suspense fallback={null}>
      <GuardianConsent />
    </Suspense>
  );
}
