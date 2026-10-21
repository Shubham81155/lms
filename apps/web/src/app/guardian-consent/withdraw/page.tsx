"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { AuthCard, buttonClass } from "@/components/AuthCard";
import { Banner } from "@/components/admin/IdentityPanels";

interface Info {
  organisation: string;
  firstName: string;
  consentGivenAt: string;
}

function WithdrawConsent() {
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
      .get<{ data: Info }>("/api/v1/privacy/guardian-consent/withdraw", { params: { token } })
      .then((res) => {
        setInfo(res.data);
        setState("ready");
      })
      .catch((err) => {
        setState("error");
        setMessage(err instanceof ApiError ? err.message : "This link could not be checked.");
      });
  }, [token]);

  const withdraw = async () => {
    setBusy(true);
    setMessage("");
    try {
      await api.post("/api/v1/privacy/guardian-consent/withdraw", { token });
      setState("done");
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Consent could not be withdrawn. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Withdraw parent or guardian consent">
      {state === "loading" && <p role="status" className="text-xs text-center text-ink">Checking the link...</p>}
      {state === "error" && <Banner kind="error">{message || "This link is no longer valid. Consent may already have been withdrawn."}</Banner>}
      {state === "ready" && info && (
        <div className="space-y-4">
          <p className="text-xs text-ink leading-relaxed">
            You gave consent on {new Date(info.consentGivenAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} for{" "}
            <strong>{info.firstName}</strong>&apos;s use of the learning platform of <strong>{info.organisation}</strong>.
          </p>
          <p className="text-[11px] text-ink-muted">
            If you withdraw, everything {info.firstName} agreed to is withdrawn too, and {info.firstName} cannot agree to anything again until a parent or guardian consents.
            Camera and microphone monitoring stops being allowed. The organisation may no longer be able to provide the service.
          </p>
          {message && <Banner kind="error">{message}</Banner>}
          <button type="button" onClick={withdraw} disabled={busy} className={buttonClass}>
            {busy ? "Saving..." : "Withdraw my consent"}
          </button>
        </div>
      )}
      {state === "done" && <Banner kind="ok">Your consent is withdrawn. You can close this page.</Banner>}
    </AuthCard>
  );
}

export default function WithdrawConsentPage() {
  return (
    <Suspense fallback={null}>
      <WithdrawConsent />
    </Suspense>
  );
}
