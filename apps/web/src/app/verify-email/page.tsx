"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { AuthCard } from "@/components/AuthCard";

function VerifyEmail() {
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = useState<{ status: "working" | "ok" | "error"; message?: string }>({
    status: "working",
  });

  useEffect(() => {
    if (!token) {
      setState({ status: "error", message: "This verification link is incomplete." });
      return;
    }
    api
      .post("/api/v1/auth/verify-email", { token })
      .then(() => setState({ status: "ok" }))
      .catch((err) =>
        setState({
          status: "error",
          message: err instanceof ApiError ? err.message : "Verification failed.",
        })
      );
  }, [token]);

  return (
    <AuthCard title="Email verification">
      <p className="text-xs text-center text-ink">
        {state.status === "working" && "Verifying..."}
        {state.status === "ok" && "Your email address is verified."}
        {state.status === "error" && state.message}
      </p>
      <p className="text-center text-[11px]">
        <Link href="/login" className="text-brand-fg hover:underline underline-offset-2">
          Continue to sign in
        </Link>
      </p>
    </AuthCard>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmail />
    </Suspense>
  );
}
