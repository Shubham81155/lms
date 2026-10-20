// The steps a new organisation's administrator works through, worked out from what the organisation already has.

export interface SetupFacts {
  tenant: { name: string; slug: string; logoUrl: string | null } | null;
  /** Active and invited people. */
  seatsUsed: number | null;
  courses: number | null;
  /** Whether the plan includes single sign-on. */
  ssoAvailable: boolean;
  /** An OIDC or SAML connection exists and is switched on. */
  ssoConnected: boolean;
  terms: number | null;
}

export type SetupStepKey = "branding" | "people" | "course" | "signin" | "terms";

export interface SetupStep {
  key: SetupStepKey;
  title: string;
  hint: string;
  done: boolean;
}

/**
 * The checklist, in order. Sign-in only appears when the plan has single sign-on. A step whose facts have not
 * loaded yet counts as not done, so the list never claims more than it knows.
 */
export function setupSteps(f: SetupFacts): SetupStep[] {
  const steps: SetupStep[] = [
    {
      key: "branding",
      title: "Add your name and logo",
      hint: "Organisation → Branding: the name and logo people see when they sign in.",
      // A registered organisation always has a proper name, so only a logo shows the branding was looked at.
      done: !!f.tenant?.logoUrl,
    },
    {
      key: "people",
      title: "Invite your people",
      hint: "People → Invite, or import a CSV of teachers and learners.",
      done: (f.seatsUsed ?? 0) > 1,
    },
    {
      key: "course",
      title: "Get the first course created",
      hint: "Teachers create courses. Invite an instructor in People; their first course shows up under Courses.",
      done: (f.courses ?? 0) > 0,
    },
  ];
  if (f.ssoAvailable) {
    steps.push({
      key: "signin",
      title: "Connect single sign-on",
      hint: "Identity & Provisioning: let people sign in with your college accounts (optional).",
      done: f.ssoConnected,
    });
  }
  steps.push({
    key: "terms",
    title: "Add your academic terms",
    hint: "Organisation → Terms, so courses can be filed under Fall 2026 and so on.",
    done: (f.terms ?? 0) > 0,
  });
  return steps;
}

/** True once every step is done; the card then hides itself. */
export const setupComplete = (steps: SetupStep[]) => steps.length > 0 && steps.every((s) => s.done);
