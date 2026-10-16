"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { brandTokens } from "@/lib/branding";
import { useTheme } from "@/context/ThemeContext";

export interface Branding {
  name: string;
  slug: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string | null;
}

const BrandingContext = createContext<Branding | null>(null);

/**
 * The organisation's white-label settings (GET /tenant/config, public; the API picks the organisation from the
 * host name). Applies the favicon and, when it is legible, the brand colour; BrandLogo shows the logo and name.
 */
export const BrandingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [branding, setBranding] = useState<Branding | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    let alive = true;
    api
      .get<{ slug: string; name: string; theme: { logoUrl: string | null; faviconUrl: string | null; primaryColor: string | null } }>("/api/v1/tenant/config")
      .then((r) => alive && setBranding({ name: r.name, slug: r.slug, logoUrl: r.theme.logoUrl, faviconUrl: r.theme.faviconUrl, primaryColor: r.theme.primaryColor }))
      .catch(() => alive && setBranding(null));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const tokens = brandTokens(branding?.primaryColor, theme === "light" ? "light" : "dark");
    if (tokens) {
      root.style.setProperty("--brand", tokens.brand);
      root.style.setProperty("--brand-hover", tokens.hover);
    } else {
      root.style.removeProperty("--brand");
      root.style.removeProperty("--brand-hover");
    }
  }, [branding?.primaryColor, theme]);

  useEffect(() => {
    if (!branding?.faviconUrl) return;
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = branding.faviconUrl;
  }, [branding?.faviconUrl]);

  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
};

export const useBranding = () => useContext(BrandingContext);
