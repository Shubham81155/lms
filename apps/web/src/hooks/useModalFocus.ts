"use client";

import { useEffect } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const MODAL = '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]';

const visible = (el: HTMLElement) =>
  typeof el.checkVisibility === "function" ? el.checkVisibility({ visibilityProperty: true }) : !el.closest("[hidden]") && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden";

/** Open modals (not the always-mounted, inert navigation drawer), topmost last. */
const openModals = () => Array.from(document.querySelectorAll<HTMLElement>(MODAL)).filter((el) => !el.closest("[inert]") && !el.hasAttribute("hidden") && visible(el));

/**
 * Keyboard behaviour shared by the app's hand-written modal dialogs, without touching each of them: when a dialog
 * with aria-modal appears, focus moves into it (its first control, or the dialog itself); Tab and Shift+Tab stay
 * inside the topmost one; when it goes away, focus returns to whatever opened it. Escape stays with each dialog,
 * because only it knows whether closing is safe (an exam or a live call must not vanish on a stray key).
 * Mounted once, in the root layout (components/A11yEnhancements).
 */
export function useModalFocus() {
  useEffect(() => {
    let openers: { dialog: HTMLElement; opener: HTMLElement | null }[] = [];

    const sync = () => {
      const now = openModals();
      for (const dialog of now) {
        if (openers.some((o) => o.dialog === dialog)) continue;
        const opener = document.activeElement instanceof HTMLElement && !dialog.contains(document.activeElement) ? document.activeElement : null;
        openers.push({ dialog, opener });
        if (!dialog.contains(document.activeElement)) {
          const first = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).find(visible);
          if (!dialog.hasAttribute("tabindex")) dialog.setAttribute("tabindex", "-1");
          (first ?? dialog).focus({ preventScroll: true });
        }
      }
      const gone = openers.filter((o) => !now.includes(o.dialog));
      if (gone.length) {
        openers = openers.filter((o) => now.includes(o.dialog));
        // Hand focus back only when it was lost with the dialog (not when the person already moved on).
        const last = gone[gone.length - 1];
        if (last.opener?.isConnected && (document.activeElement === document.body || !document.activeElement)) last.opener.focus({ preventScroll: true });
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const dialog = openModals().pop();
      if (!dialog) return;
      const els = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(visible);
      if (els.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const first = els[0];
      const last = els[els.length - 1];
      const active = document.activeElement;
      if (!dialog.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && (active === first || active === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    // The app mutates the DOM constantly; look at modals at most once per frame.
    let frame = 0;
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(() => ((frame = 0), sync()));
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["inert", "hidden", "aria-modal", "role"] });
    document.addEventListener("keydown", onKeyDown);
    sync();
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}
