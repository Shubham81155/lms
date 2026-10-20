"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

const COLLAPSED_KEY = "lms_sidebar_collapsed";
const DESKTOP_QUERY = "(min-width: 1024px)";
/** Below this width the rail starts as icons only, so the page keeps its room, until the person chooses. */
const ROOMY_QUERY = "(min-width: 1280px)";

/**
 * Sidebar state: the desktop rail can be collapsed (remembered per browser) and below the desktop
 * breakpoint the same navigation opens as a drawer.
 */
export function useSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Until the stored preference has been read, the width must not animate from the default to it.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(COLLAPSED_KEY);
      setCollapsed(stored === null ? !window.matchMedia(ROOMY_QUERY).matches : stored === "1");
    } catch {
      /* storage can be blocked; the sidebar then follows the window width */
      setCollapsed(!window.matchMedia(ROOMY_QUERY).matches);
    }
    setReady(true);
  }, []);

  const toggleCollapsed = useCallback(() => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      /* not persisted */
    }
  }, [collapsed]);

  const openMobile = useCallback(() => setMobileOpen(true), []);
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  // A drawer left open while the window grows to desktop width would otherwise hide behind the rail.
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => mq.matches && setMobileOpen(false);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return { collapsed, ready, toggleCollapsed, mobileOpen, openMobile, closeMobile };
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Makes an open drawer behave like a dialog: focus moves into it and returns to what opened it, Tab stays
 * inside, Escape closes it, and the page behind does not scroll.
 */
export function useDrawerBehavior(open: boolean, containerRef: RefObject<HTMLElement | null>, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusables = () => Array.from(container?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter((el) => el.offsetParent !== null);
    (focusables()[0] ?? container)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const els = focusables();
      if (els.length === 0) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (!container?.contains(document.activeElement)) {
        // focus ended up behind the drawer (e.g. after a click on the backdrop): bring it back
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, [open, containerRef]);
}
