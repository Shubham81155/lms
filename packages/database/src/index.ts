import { AsyncLocalStorage } from 'async_hooks';
import { Prisma, PrismaClient } from '@prisma/client';

export * from '@prisma/client';

/**
 * Tenant context for PostgreSQL Row-Level Security (see prisma/migrations/*_row_level_security).
 *
 * The request pipeline calls runWithTenant(tenantId, ...). Every query made through the client
 * returned by createTenantPrismaClient() inside that scope runs in a transaction that first sets
 * `app.current_tenant_id`, so the database only exposes that tenant's rows. Outside any scope no
 * tenant is set and tenant tables return nothing (the policies fail closed).
 */
const tenantStorage = new AsyncLocalStorage<string>();

export function runWithTenant<T>(tenantId: string, fn: () => T): T {
  return tenantStorage.run(tenantId, () => {
    const result = fn();
    // Prisma queries are lazy: they only run once something awaits them. A query returned
    // straight out of this callback would therefore execute after the scope has ended, with no
    // tenant set (and RLS would hide every row). Subscribing here, inside the scope, makes the
    // query start with the tenant in place no matter how the caller consumes the result.
    if (result && typeof (result as any).then === 'function') {
      return new Promise((resolve, reject) => (result as any).then(resolve, reject)) as unknown as T;
    }
    return result;
  });
}

export function currentTenantId(): string | undefined {
  return tenantStorage.getStore();
}

export interface TenantPrismaClient {
  /** Client whose queries are scoped to the tenant of the surrounding runWithTenant(). */
  prisma: ReturnType<typeof extend>;
  /** Raw client. Queries through it carry no tenant context. */
  base: PrismaClient;
  /** Multi-statement atomic work for one tenant. */
  runInTenantTransaction: <T>(
    tenantId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>
  ) => Promise<T>;
}

function extend(base: PrismaClient) {
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const tenantId = tenantStorage.getStore();
          if (!tenantId) return query(args);

          // set_config(..., true) is transaction-local, so it cannot leak to another request
          // that reuses the pooled connection.
          const [, result] = await base.$transaction([
            base.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`,
            query(args) as any,
          ]);
          return result;
        },
      },
    },
  });
}

export function createTenantPrismaClient(options?: Prisma.PrismaClientOptions): TenantPrismaClient {
  const base = new PrismaClient(options);
  return {
    prisma: extend(base),
    base,
    runInTenantTransaction: (tenantId, fn) =>
      base.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        return fn(tx);
      }),
  };
}

/**
 * RLS is silently skipped for superusers and BYPASSRLS roles. Returns why the connected role
 * would bypass it, or null when policies apply.
 */
export async function findRlsBypassReason(client: PrismaClient): Promise<string | null> {
  const rows = await client.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean; rolname: string }[]>`
    SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  const role = rows[0];
  if (!role) return 'could not determine the database role';
  if (role.rolsuper) return `role "${role.rolname}" is a superuser`;
  if (role.rolbypassrls) return `role "${role.rolname}" has BYPASSRLS`;
  return null;
}
