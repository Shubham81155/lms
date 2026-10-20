import type { KeyboardEvent } from "react";

/**
 * onKeyDown for a row or card that is clickable: Enter and Space do what a click does. Only when the row itself has
 * focus, so typing in or activating a control inside it is left alone.
 */
export const activateOnKey =
  (action: () => void) =>
  (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    action();
  };
