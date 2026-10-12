import { createTenantPrismaClient, TenantPrismaClient } from '@enterprise-lms/database';

declare global {
  // eslint-disable-next-line no-var
  var __tenantPrisma: TenantPrismaClient | undefined;
}

const client = globalThis.__tenantPrisma ?? createTenantPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__tenantPrisma = client;
}

/** Tenant-scoped Prisma client: queries obey the tenant set by runWithTenant(). */
export const prisma = client.prisma;
/** Unscoped client, for startup checks only. */
export const basePrisma = client.base;
/** Atomic multi-statement work for a single tenant. */
export const runInTenantTransaction = client.runInTenantTransaction;

export default prisma;
