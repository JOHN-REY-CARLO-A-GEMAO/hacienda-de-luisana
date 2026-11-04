// ----------------------------------------------------------------------------
// Which pages a role may open — Hacienda de LuisAna
// ----------------------------------------------------------------------------
// The website is the Guest's application (ADR-0007). Its Guest pages are gated by
// the permission they exist to exercise: `/mybookings` is where a Guest reads
// their own Bookings, so it opens for whoever holds `booking:read:own`. The
// Admin's screens are in the Flutter app, and an Admin session on the website is
// a person on the wrong front door, and is told so.
//
// The single exception is the live-location reader at `/admin/live-location`,
// which exists because the Guest's own share promises the Admin can see them and
// the website could not read a position at all. It is gated by `guest-location:read`
// — held by the Admin role and nobody else — and by the two rules files under it.
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
 * path wins.
 */
const GATED_PAGES: ReadonlyArray<{ path: string; permission: Permission }> = [
  { path: '/mybookings', permission: 'booking:read:own' },
  { path: '/profile', permission: 'booking:read:own' },
  { path: '/messages', permission: 'booking:read:own' },
  // The one Admin page the website has. The Guest's live-location share says
  // "the Admin can see your location"; without this the only thing that could
  // read a position was the Flutter app, and the website's own `checkFix` gate
  // was called by nothing but its tests. `guest-location:read` is held by the
  // Admin role and by no other, and it is the same permission the lifecycle
  // names — `firestore.rules` and `database.rules.json` remain the enforcement.
  { path: '/admin/live-location', permission: 'guest-location:read' },
]

/**
 * Where each role lands after signing in on the website.
 *
 * The Admin has no page here: their home is the mobile app, so the website
 * sends them back to the landing page, where the gate explains as much.
 */
const HOME_BY_ROLE: Record<Role, string> = {
  guest: '/mybookings',
  admin: '/',
}

/**
 * A path as the rules see it: no query, no hash, no trailing slash, lowercase.
 *
 * React Router matches case-insensitively, so `/Account` would open the page
 * while a case-sensitive rule let it through ungated.
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
