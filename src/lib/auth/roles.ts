// ----------------------------------------------------------------------------
// Roles and permissions — Hacienda de LuisAna
// ----------------------------------------------------------------------------
// The three roles are the three kinds of person CONTEXT.md § People defines:
// the Guest who books and stays, the Host who operates the hacienda, and the
// Staff who clean and inspect and decide nothing about money or identity.
//
// They are not a new vocabulary: `src/lib/booking` already refuses an action
// taken by the wrong `ActorKind`, and firestore.rules already splits the owner
// allowlist from the locks-readonly one. What was missing is the single list of
// *permissions* those two surfaces and the pages between them can all ask about,
// so a button, a lifecycle action and a Firestore rule cannot drift apart.
//
// This is an internal file of the `src/lib/auth` module: callers and tests go
// through `src/lib/auth`, never through here directly.
// ----------------------------------------------------------------------------

import type { ActorKind } from '../booking'

/**
 * The three roles a person can have.
 *
 * `system` is an actor in the Booking lifecycle but never a role: it is the Date
 * hold running out, and no person signs in as it.
 */
export const ROLES = ['guest', 'host', 'staff'] as const

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
  host: 'Host',
  staff: 'Staff',
}

/** Is this value one of the three roles? */
export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

/**
 * Read a stored role as one of the three, or null.
 *
 * Unknown means null rather than a default: a role nobody defined must never
 * quietly become a role that grants something. Callers that need a default for a
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
 * Each one is enforced in at least two places on purpose: the page or button
 * that would otherwise offer it, and `firestore.rules` — which is the one that
 * matters, because a person can call Firestore directly and change nothing about
 * the frontend.
 */
export const PERMISSIONS = [
  // A Guest's own Booking.
  'booking:create',
  'booking:read:own',
  'booking:update:own',
  'kyc:upload',
  // Operating the hacienda.
  'bookings:read:all',
  'bookings:review',
  'bookings:cancel:any',
  'bookings:delete',
  'payments:verify',
  'refunds:mark',
  'stays:progress',
  'stays:complete',
  // Records and people.
  'kyc:read',
  'access-logs:read',
  'access-logs:correct',
  'guest-location:read',
  'analytics:read',
  'team:manage',
  'site:manage',
  // The Host's published figures the Guest's payment choice is quoted from
  // (ticket #14). Publishing is the Host's alone; reading is public.
  'rates:publish',
] as const

export type Permission = (typeof PERMISSIONS)[number]

/**
 * What each role may do.
 *
 * Host holds everything: they operate the place. Staff hold the reads they need
 * to clean and inspect, plus the one transition that is theirs to make. Guest
 * holds their own Booking and nothing of anybody else's.
 */
const GRANTS: Record<Role, readonly Permission[]> = {
  guest: ['booking:create', 'booking:read:own', 'booking:update:own', 'kyc:upload'],
  host: PERMISSIONS,
  // CONTEXT.md: Staff "cannot approve bookings or verify payments", and
  // storage.rules keeps government IDs away from them for the same reason.
  staff: ['bookings:read:all', 'access-logs:read', 'analytics:read', 'stays:complete'],
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
