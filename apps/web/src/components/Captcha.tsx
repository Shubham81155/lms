"use client";

import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useTheme } from "@/context/ThemeContext";

// Cloudflare Turnstile CAPTCHA for public forms. The site key comes from the API (GET
// /api/v1/organizations/captcha); with none, the CAPTCHA is off and this renders nothing. Each token can be
// checked once only, so a form calls reset() after a refused submit to get a fresh one.

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileOptions {
  sitekey: string;
  action?: string;
  theme?: "light" | "dark" | "auto";
  size?: "normal" | "flexible" | "compact";
  retry?: "auto" | "never";
  "refresh-expired"?: "auto" | "manual" | "never";
  callback?: (token: string) => void;
  "error-callback"?: (code: string) => boolean | void;
  "expired-callback"?: () => void;
  "timeout-callback"?: () => void;
}

interface Turnstile {
  render(container: HTMLElement, options: TurnstileOptions): string | undefined;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let loading: Promise<Turnstile> | null = null;

/** Loads Cloudflare's script once per page. */
function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!loading) {
    loading = new Promise<Turnstile>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_URL;
      script.async = true;
      script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile did not load")));
      script.onerror = () => reject(new Error("Turnstile did not load"));
      document.head.appendChild(script);
    }).catch((err) => {
      loading = null; // a later mount may try again
      throw err;
    });
  }
  return loading;
}

export interface CaptchaHandle {
  /** Clears the current token and shows a fresh challenge. */
  reset(): void;
}

interface CaptchaProps {
  /** From the API; null or empty: no CAPTCHA, nothing rendered. */
  siteKey: string | null | undefined;
  /** Must match the action the API expects for this form. */
  action?: string;
  /** The token once solved; null when it expires, fails or is reset. */
  onToken: (token: string | null) => void;
  className?: string;
}

export const Captcha = forwardRef<CaptchaHandle, CaptchaProps>(function Captcha({ siteKey, action, onToken, className }, ref) {
  const { theme } = useTheme();
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<{ api: Turnstile; id: string } | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const [problem, setProblem] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    reset() {
      onTokenRef.current(null);
      if (widget.current) widget.current.api.reset(widget.current.id);
    },
  }), []);

  // Rendered again when the theme changes: Turnstile cannot restyle a widget in place.
  useEffect(() => {
    if (!siteKey) return;
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    setProblem(null);
    onTokenRef.current(null);
    loadTurnstile()
      .then((api) => {
        if (!alive || !container.current) return;
        const resetSoon = (delay: number) => {
          clearTimeout(retry);
          retry = setTimeout(() => alive && widget.current && api.reset(widget.current.id), delay);
        };
        const id = api.render(container.current, {
          sitekey: siteKey,
          action,
          theme,
          size: "flexible",
          retry: "never",
          "refresh-expired": "manual",
          callback: (token) => {
            setProblem(null);
            onTokenRef.current(token);
          },
          "error-callback": () => {
            onTokenRef.current(null);
            setProblem("The security check failed to run. Trying again…");
            resetSoon(3000);
            return true;
          },
          "expired-callback": () => {
            onTokenRef.current(null);
            resetSoon(0);
          },
          "timeout-callback": () => {
            onTokenRef.current(null);
            resetSoon(0);
          },
        });
        if (id) widget.current = { api, id };
      })
      .catch(() => {
        if (!alive) return;
        onTokenRef.current(null);
        setProblem("The security check could not load. Check your connection or allow challenges.cloudflare.com in any content blocker, then reload the page.");
      });
    return () => {
      alive = false;
      clearTimeout(retry);
      if (widget.current) {
        widget.current.api.remove(widget.current.id);
        widget.current = null;
      }
    };
  }, [siteKey, action, theme]);

  if (!siteKey) return null;
  return (
    <div className={className}>
      <div ref={container} className="min-h-[65px]" />
      {problem && <p role="alert" className="mt-1.5 text-[11px] text-danger">{problem}</p>}
    </div>
  );
});
