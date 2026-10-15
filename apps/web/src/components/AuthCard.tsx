import React from "react";
import { BrandLogo } from "@/components/BrandLogo";
import { ThemeToggle } from "@/components/ThemeToggle";

export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col relative overflow-hidden">
      <div aria-hidden="true" className="absolute top-24 left-1/2 -translate-x-1/2 h-[420px] w-[720px] max-w-full rounded-full bg-brand/15 blur-3xl" />
      <header className="relative border-b border-line bg-canvas/80 backdrop-blur-md px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <BrandLogo />
          <ThemeToggle />
        </div>
      </header>
      <main className="relative flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-surface border border-line rounded-3xl p-8 space-y-6 shadow-2xl shadow-black/20">
          <div className="text-center space-y-1.5">
            <h1 className="text-2xl font-extrabold text-ink">{title}</h1>
            {subtitle && <p className="text-xs text-ink-muted">{subtitle}</p>}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

export const inputClass =
  "w-full bg-canvas border border-line rounded-xl px-4 py-2.5 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-colors";
export const buttonClass =
  "w-full py-3 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold shadow-lg shadow-brand/25 transition-all";
