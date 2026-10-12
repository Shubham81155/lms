export * from '@prisma/client';

/**
 * Tenant Context Session helper for PostgreSQL Row Level Security (RLS)
 */
export interface TenantContext {
  tenantId: string;
  userId?: string;
  userRole?: string;
}

/**
 * Helper to build SQL execution string for setting RLS session variable
 */
export function getTenantSessionSql(tenantId: string): string {
  return `SET LOCAL app.current_tenant_id = '${tenantId}';`;
}
