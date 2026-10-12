"use client";

import React, { useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { AuthCard, buttonClass, inputClass } from "@/components/AuthCard";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ message: string }>("/api/v1/auth/forgot-password", { email });
      setMessage(res.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Reset your password" subtitle="We will email you a link to choose a new one.">
      {message ? (
        <p className="text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-800/60 rounded-2xl p-3.5">
          {message}
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <p className="text-xs text-rose-300">{error}</p>}
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="name@university.edu"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
          <button type="submit" disabled={busy} className={buttonClass}>
            {busy ? "Sending..." : "Send reset link"}
          </button>
        </form>
      )}
      <p className="text-center text-[11px]">
        <Link href="/login" className="text-blue-400 hover:text-blue-300">
          Back to sign in
        </Link>
      </p>
    </AuthCard>
  );
}
