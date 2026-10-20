"use client";

import { useModalFocus } from "@/hooks/useModalFocus";
import { useTabKeys } from "@/hooks/useTabKeys";

/** Behaviour that applies to the whole app and has no visible output: focus handling for modal dialogs, arrow keys in tab lists. */
export function A11yEnhancements() {
  useModalFocus();
  useTabKeys();
  return null;
}
