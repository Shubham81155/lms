"use client";

import { useEffect } from "react";

/**
 * Arrow-key navigation for every [role="tab"] in the app (WAI-ARIA tabs pattern): Left/Right (Up/Down in a vertical
 * list) move to the neighbouring tab and activate it, wrapping around; Home and End jump to the first and last.
 * The tabs themselves only need role="tab", aria-selected, and tabIndex 0 on the selected one and -1 on the rest.
 */
export function useTabKeys() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tab = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('[role="tab"]') : null;
      const list = tab?.closest<HTMLElement>('[role="tablist"]');
      if (!tab || !list || e.altKey || e.ctrlKey || e.metaKey) return;
      const vertical = list.getAttribute("aria-orientation") === "vertical";
      const tabs = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]:not([disabled])'));
      const at = tabs.indexOf(tab);
      let next = -1;
      if (e.key === (vertical ? "ArrowDown" : "ArrowRight")) next = (at + 1) % tabs.length;
      else if (e.key === (vertical ? "ArrowUp" : "ArrowLeft")) next = (at - 1 + tabs.length) % tabs.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = tabs.length - 1;
      if (next < 0 || next === at) return;
      e.preventDefault();
      tabs[next].focus();
      tabs[next].click();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
