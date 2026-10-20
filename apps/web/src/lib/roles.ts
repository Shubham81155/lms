export type Role =
  | "SUPER_ADMIN"
  | "TENANT_ADMIN"
  | "INSTRUCTOR"
  | "TEACHING_ASSISTANT"
  | "STUDENT"
  | "PARENT_GUARDIAN"
  | "AUDITOR";

const AREAS: { prefix: string; roles: Role[] }[] = [
  { prefix: "/admin", roles: ["TENANT_ADMIN", "SUPER_ADMIN"] },
  { prefix: "/teacher", roles: ["INSTRUCTOR", "TEACHING_ASSISTANT"] },
  { prefix: "/audit", roles: ["AUDITOR"] },
  { prefix: "/student", roles: ["STUDENT", "PARENT_GUARDIAN"] },
];

/** The platform console. Only platform operators use it, and they use nothing else. */
export const PLATFORM_HOME = "/platform";

/**
 * Who is looking: the role inside their organisation, and whether that organisation is the platform team.
 * A platform operator is a super administrator of the operator organisation; it runs the platform, not a college,
 * so its people never get the college areas (/admin, /teacher, /student, /audit).
 */
export interface Viewer {
  role: string;
  platformOperator?: boolean;
}

const inArea = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/** Landing page for a role inside an organisation. */
export function routeForRole(role: string): string {
  const area = AREAS.find((a) => a.roles.includes(role as Role));
  return area ? area.prefix : "/student";
}

/** Landing page for a signed-in person. */
export function homeFor(viewer: Viewer): string {
  return viewer.platformOperator ? PLATFORM_HOME : routeForRole(viewer.role);
}

/** Whether a role may view a path. Paths outside the areas are open; the platform console is never open by role. */
export function canAccess(role: string, pathname: string): boolean {
  if (inArea(pathname, PLATFORM_HOME)) return false;
  const area = AREAS.find((a) => inArea(pathname, a.prefix));
  return !area || area.roles.includes(role as Role);
}

/** Whether this person may view a path: operators only the platform console, everyone else by role. */
export function canView(viewer: Viewer, pathname: string): boolean {
  if (viewer.platformOperator) return !AREAS.some((a) => inArea(pathname, a.prefix));
  return canAccess(viewer.role, pathname);
}

/** Pages where a signed-out visitor is welcome. */
export const PUBLIC_PATHS = ["/", "/login", "/register", "/find-organisation", "/forgot-password", "/reset-password", "/verify-email", "/verify", "/support/enter"];
