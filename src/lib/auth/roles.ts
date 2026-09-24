// ----------------------------------------------------------------------------
// Roles and permissions — Hacienda de LuisAna
// ----------------------------------------------------------------------------
// The two roles are the two kinds of person CONTEXT.md § People defines: the
// Guest who books and stays, and the Admin who operates the hacienda. Two apps
// match them one-to-one (ADR-0007): the Guest uses this website, the Admin uses
// the Flutter mobile app. There is no Staff role and no Host role — everything
// that was ever theirs is the Admin's.
//
// The catalogue of *permissions* is kept so that a page, a lifecycle action and a
// Firestore rule all ask the same named question. The website only ever asks the
// Guest's questions; the Admin's are listed because `firestore.rules` and the
// Flutter app answer them, and one list is easier to keep honest than three.
//
// This is an internal file of the `src/lib/auth` module: callers and tests go
// through `src/lib/auth`, never through here directly.
// ----------------------------------------------------------------------------

import type { ActorKind } from '../booking'

/**
 * The two roles a person can have.
 *
 * `system` is an actor in the Booking lifecycle but never a role: it is the Date
 * hold running out, and no person signs in as it.
 */
export const ROLES = ['guest', 'admin'] as const

export type Role = (typeof ROLES)[number]

/**
 * Compile-time promise that a Role can be handed to the lifecycle as an
 * `ActorKind`: a session's role becomes the actor on every Booking action
 * without a translation table. If a role is ever added that the lifecycle does
 * not know, this line stops compiling.
 */
export type RoleAsActorKind<R extends ActorKind = Role> = R

/** How each role is written down for a person to read (CONTEXT.md § People). */
export const ROLE_LABELS: Record<Role, string> = {
  guest: 'Guest',
  admin: 'Admin',
}

/** Is this value one of the two roles? */
export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

/**
 * Read a stored role as one of the two, or null.
 *
 * Unknown means null rather than a default: a role nobody defined must never
 * quietly become a role that grants something. In particular the retired
 * `host` and `staff` values read as no role at all — a Profile still carrying
 * one resolves to Guest, and the Admin is recognised by the allowlist or by a
 * Profile that says `admin` (ADR-0007). Callers that need a default for a
 * signed-in user go through `resolveRole`, which lands on Guest.
 */
export function normalizeRole(stored: string | undefined | null): Role | null {
  if (typeof stored !== 'string') return null
  const folded = stored.trim().toLowerCase()
  return isRole(folded) ? folded : null
}

// ----------------------------------------------------------------------------
// Permissions
// ----------------------------------------------------------------------------

/**
 * Everything the system decides by role, named for the domain act it allows.
 *
 * Each one is enforced in at least two places on purpose: the surface that would
 * otherwise offer it, and `firestore.rules` — which is the one that matters,
 * because a person can call Firestore directly and change nothing about the
 * frontend.
 */
export const PERMISSIONS = [
  // A Guest's own Booking — the website.
  'booking:create',
  'booking:read:own',
  'booking:update:own',
  'kyc:upload',
  // Operating the hacienda — the Admin app.
  'bookings:read:all',
  'bookings:review',
  'bookings:cancel:any',
  'bookings:delete',
  'payments:verify',
  'refunds:mark',
  'stays:progress',
  'stays:complete',
  'kyc:read',
  'access-logs:read',
  'access-logs:correct',
  'guest-location:read',
  'analytics:read',
  'site:manage',
  'rates:publish',
] as const

export type Permission = (typeof PERMISSIONS)[number]

/** The permissions that belong to a Guest's own Booking. */
const GUEST_PERMISSIONS: readonly Permission[] = ['booking:create', 'booking:read:own', 'booking:update:own', 'kyc:upload']

/**
 * What each role may do.
 *
 * The Admin holds everything that operates the place. The Guest holds their own
 * Booking and nothing of anybody else's. The Admin does not hold the Guest's
 * own-Booking permissions: an Admin does not book through the website, and the
 * one page here that needs a permission (`/account`) is a Guest's page.
 */
const GRANTS: Record<Role, readonly Permission[]> = {
  guest: GUEST_PERMISSIONS,
  admin: PERMISSIONS.filter((permission) => !GUEST_PERMISSIONS.includes(permission)),
}

/** The permissions a role holds, in catalogue order. */
export function permissionsOf(role: Role | null): Permission[] {
  if (!isRole(role)) return []
  return PERMISSIONS.filter((permission) => (GRANTS[role] as readonly string[]).includes(permission))
}

/**
 * May this role do this?
 *
 * Fails closed: a role that is null (signed out), unknown, or `system` holds
 * nothing at all.
 */
export function can(role: Role | null, permission: Permission): boolean {
  if (!isRole(role)) return false
  return (GRANTS[role] as readonly string[]).includes(permission)
}
