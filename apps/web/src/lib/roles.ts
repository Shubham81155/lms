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
  { prefix: "/student", roles: ["STUDENT", "PARENT_GUARDIAN", "AUDITOR"] },
];

/** Landing page for a role. */
export function routeForRole(role: string): string {
  const area = AREAS.find((a) => a.roles.includes(role as Role));
  return area ? area.prefix : "/student";
}

/** Whether a role may view a path. Paths outside the role areas are open. */
export function canAccess(role: string, pathname: string): boolean {
  const area = AREAS.find((a) => pathname === a.prefix || pathname.startsWith(`${a.prefix}/`));
  return !area || area.roles.includes(role as Role);
}
