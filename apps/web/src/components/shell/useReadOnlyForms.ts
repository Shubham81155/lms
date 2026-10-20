"use client";

import { useEffect, type RefObject } from "react";
import { lockedInReadOnly, READ_ONLY_TITLE } from "@/lib/support-read-only";

const CONTROLS = "input, textarea, select, button";
// Set on the controls this hook disabled, so they can be given back and are not confused with ones the page disabled.
const MARK = "supportLocked";

function lock(root: HTMLElement) {
  root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>(CONTROLS).forEach((el) => {
    const locked = lockedInReadOnly({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type") ?? "",
      inForm: !!el.closest("form"),
      allowed: !!el.closest('[role="search"], [data-readonly-ok]'),
    });
    if (!locked || el.disabled) return;
    el.disabled = true;
    el.dataset[MARK] = "1";
    if (!el.title) el.title = READ_ONLY_TITLE;
  });
}

function unlock(root: HTMLElement) {
  root.querySelectorAll<HTMLInputElement | HTMLButtonElement>(`[data-support-locked]`).forEach((el) => {
    el.disabled = false;
    delete el.dataset[MARK];
    if (el.title === READ_ONLY_TITLE) el.removeAttribute("title");
  });
}

/**
 * Locks the form controls under `ref` while `active` (a read-only support session), including ones rendered later
 * and ones a component re-enables (e.g. after its own busy state ends).
 */
export function useReadOnlyForms(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return;
    let frame = 0;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; lock(root); });
    };
    lock(root);
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      unlock(root);
    };
  }, [ref, active]);
}
