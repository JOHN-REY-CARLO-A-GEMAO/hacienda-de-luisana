// ----------------------------------------------------------------------------
// Which pages a role may open — Hacienda de LuisAna
// ----------------------------------------------------------------------------
// A page is gated by the permission it exists to exercise, not by a list of
// roles kept beside the catalogue: `/admin` is where a Booking is reviewed, so it
// opens for whoever holds `bookings:review`. Add a permission to a role in
// `roles.ts` and the pages that role can open follow, with nothing to remember
// here.
//
// Hiding a page is a courtesy, not the enforcement — firestore.rules is. Both
// read the same catalogue.
//
// This is an internal file of the `src/lib/auth` module.
// ----------------------------------------------------------------------------

import { ROLES, can, type Permission, type Role } from './roles'

/**
 * The pages that are not public, each with the permission that opens it.
 *
 * Nested paths are listed with their parent: the deepest rule that matches a
 * path wins, so `/app/tracking` is narrower than `/app`.
 */
const GATED_PAGES: ReadonlyArray<{ path: string; permission: Permission }> = [
  { path: '/admin', permission: 'bookings:review' },
  { path: '/app', permission: 'bookings:read:all' },
  { path: '/app/tracking', permission: 'guest-location:read' },
  { path: '/app/analytics', permission: 'analytics:read' },
  { path: '/app/records', permission: 'access-logs:read' },
  { path: '/account', permission: 'booking:read:own' },
]

/** Where each role lands after signing in. */
const HOME_BY_ROLE: Record<Role, string> = {
  host: '/admin',
  staff: '/app',
  guest: '/account',
}

/**
 * A path as the rules see it: no query, no hash, no trailing slash, lowercase.
 *
 * React Router matches case-insensitively, so `/Admin` would open the page while
 * a case-sensitive rule let it through ungated.
 */
export function normalizePath(path: string): string {
  const withoutQuery = (path.split(/[?#]/)[0] ?? '').replace(/\/+/g, '/')
  const withoutTrailing = withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, '') : withoutQuery
  const rooted = withoutTrailing.startsWith('/') ? withoutTrailing : `/${withoutTrailing}`
  return rooted.toLowerCase() || '/'
}

/** The permission that opens this path, or null when the path is public. */
export function pagePermission(path: string): Permission | null {
  const target = normalizePath(path)
  let best: { path: string; permission: Permission } | null = null
  for (const rule of GATED_PAGES) {
    const matches = target === rule.path || target.startsWith(`${rule.path}/`)
    if (!matches) continue
    if (!best || rule.path.length > best.path.length) best = rule
  }
  return best?.permission ?? null
}

/**
 * The roles a page is open to, or null when it is public.
 *
 * Derived from the catalogue, so it can never disagree with `can()`.
 */
export function pageRoles(path: string): Role[] | null {
  const permission = pagePermission(path)
  if (!permission) return null
  return ROLES.filter((role) => can(role, permission))
}

/** May this signed-in (or signed-out) person open this page? */
export function canOpenPage(role: Role | null, path: string): boolean {
  const permission = pagePermission(path)
  if (!permission) return true
  return can(role, permission)
}

/** Where to send somebody once they are signed in. */
export function homeForRole(role: Role | null): string {
  return role && HOME_BY_ROLE[role] ? HOME_BY_ROLE[role] : '/'
}
