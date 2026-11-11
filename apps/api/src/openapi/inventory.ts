import type { Router } from 'express';
import { authenticateJWT, optionalAuth } from '../middleware/auth';
import type { Mount } from '../mounts';

export type SecurityKind = 'session' | 'optional-session' | 'scim-token' | 'none';

export interface Operation {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** Express-style full path, e.g. /api/v1/courses/:id. */
  path: string;
  security: SecurityKind;
  /** Roles accepted by a requireRole() guard, when the route has one. */
  roles?: string[];
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

const sample = (path: string) => path.replace(/:([A-Za-z0-9_]+)/g, 'x');

function securityOf(handle: unknown): SecurityKind | undefined {
  if (handle === authenticateJWT) return 'session';
  if (handle === optionalAuth) return 'optional-session';
  if (typeof handle === 'function' && handle.name === 'scimAuth') return 'scim-token';
  return undefined;
}

const rolesOf = (handle: unknown): string[] | undefined => {
  const roles = typeof handle === 'function' ? (handle as { requiredRoles?: unknown }).requiredRoles : undefined;
  return Array.isArray(roles) ? [...roles] : undefined;
};

/** The parts of Express's internal router layer that the inventory reads. */
interface RouterLayer {
  name: string;
  handle: unknown;
  match: (path: string) => boolean;
  route?: {
    path: unknown;
    methods: Record<string, boolean | undefined>;
    stack: { handle: unknown }[];
  };
}

const joinPath = (prefix: string, path: string) => (prefix + (path === '/' ? '' : path)).replace(/\/+$/, '') || '/';

/**
 * Lists every route of the given routers by reading Express's own routing table, so the API
 * description cannot drift from what is actually mounted. A route counts as authenticated when a
 * guard sits on it, or on a `router.use()` that comes earlier in the same router and matches its path.
 */
export function inventory(mounts: Mount[]): Operation[] {
  const ops: Operation[] = [];
  for (const { prefix, router } of mounts) {
    const stack = (router as unknown as { stack: RouterLayer[] }).stack;
    stack.forEach((layer, index) => {
      if (!layer.route) {
        if (layer.name === 'router') throw new Error(`Nested routers are not supported by the API inventory (under ${prefix})`);
        return;
      }
      const paths: unknown[] = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const path of paths) {
        if (typeof path !== 'string') throw new Error(`Route path under ${prefix} is not a string; the API inventory cannot describe it`);
        const sampled = sample(path);
        let security: SecurityKind = 'none';
        let roles: string[] | undefined;

        const consider = (handle: unknown) => {
          const kind = securityOf(handle);
          if (kind && (security === 'none' || kind === 'session')) security = kind;
          roles = rolesOf(handle) ?? roles;
        };
        for (const earlier of stack.slice(0, index)) if (!earlier.route && earlier.match(sampled)) consider(earlier.handle);
        for (const h of layer.route.stack) consider(h.handle);

        for (const method of METHODS) {
          if (layer.route.methods[method]) ops.push({ method, path: joinPath(prefix, path), security, ...(roles ? { roles } : {}) });
        }
      }
    });
  }
  return ops.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

export type { Router };
