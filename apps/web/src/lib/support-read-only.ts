// While the platform operator is in an organisation on a read-only support pass, the API refuses every change.
// The page says so up front by locking its form controls (components/shell/useReadOnlyForms.ts). Looking things
// up stays possible: anything inside role="search" (people search, audit-log filters...) or data-readonly-ok is
// left alone, and so are buttons outside forms (navigation, tabs, paging); the API still refuses those that change
// something.

export interface Control {
  /** Lower-case tag name: input, textarea, select or button. */
  tag: string;
  /** The type attribute ("" when absent). */
  type: string;
  /** Inside a <form>. */
  inForm: boolean;
  /** Inside role="search" or data-readonly-ok. */
  allowed: boolean;
}

/** Whether a read-only support session locks this control. */
export function lockedInReadOnly(c: Control): boolean {
  if (c.allowed) return false;
  const type = c.type.toLowerCase();
  if (c.tag === "input") return type !== "hidden" && type !== "search";
  if (c.tag === "textarea" || c.tag === "select") return true;
  if (c.tag === "button") return c.inForm || type === "submit";
  return false;
}

/** The tooltip on a locked control. */
export const READ_ONLY_TITLE = "Read-only support access: changes are not allowed.";
