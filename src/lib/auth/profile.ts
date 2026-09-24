// ----------------------------------------------------------------------------
// The Profile: which of the two roles a signed-in person has
// ----------------------------------------------------------------------------
// A person's role is stored, not chosen in the browser: `profiles/{uid}` in
// Firestore holds exactly one of the two roles, and firestore.rules reads that
// document when it decides anything. The client resolves the same way the rules
// do, so a page never offers a button Firestore is about to refuse.
//
// The Admin addresses are recognised without a Profile — the bootstrap allowlist
// the rules have always had. They come first, on both sides, because a
// deployment whose Admin could be locked out by a missing document is a
// deployment nobody can fix. See ADR-0005 and ADR-0007.
//
// This is an internal file of the `src/lib/auth` module.
// ----------------------------------------------------------------------------

import { normalizeRole, type Role } from './roles'

/** The role everybody signed in starts with, and the one a bad Profile falls to. */
export const DEFAULT_ROLE: Role = 'guest'

/**
 * What is stored at `profiles/{uid}`.
 *
 * `role` is the only field the rules read. The rest is what the Admin sees when
 * looking a person up, and is snake_cased like every other document in this
 * project.
 */
export type Profile = {
  uid: string
  role: Role
  email?: string | null
  display_name?: string | null
  created_at?: string
  updated_at?: string
}

/**
 * The bootstrap allowlist: the Admin addresses, which carry the role with no
 * Profile written.
 *
 * Kept in step with `adminEmails()` in firestore.rules, `isAdminEmail()` in
 * storage.rules and `AuthStore.kAdminEmails` in the Flutter app
 * (`lib/services/auth_store.dart`). Changing one without the others splits the
 * two apps' idea of who the Admin is. `test/web/auth-firestore-rules.test.ts`
 * compares this list with the rules file.
 */
export const BOOTSTRAP_ROLES: ReadonlyArray<{ email: string; role: Role }> = [
  { email: 'haciendadeluisiana@gmail.com', role: 'admin' },
  { email: 'gemaojohnreycarloarguilles@gmail.com', role: 'admin' },
]

/**
 * The role an email address carries on its own, or null when it carries none.
 *
 * Compared case-insensitively and trimmed: an identity provider can hand back
 * either, and the allowlist must not miss because of it.
 */
export function roleForEmail(email: string | null | undefined): Role | null {
  if (typeof email !== 'string') return null
  const folded = email.trim().toLowerCase()
  if (!folded) return null
  return BOOTSTRAP_ROLES.find((entry) => entry.email === folded)?.role ?? null
}

/** Enough of a signed-in user to resolve a role. */
export type RoleBearer = {
  uid: string
  email?: string | null
  isAnonymous?: boolean
} | null

/**
 * The role this signed-in person has.
 *
 * The order is the order firestore.rules uses: the bootstrap allowlist first,
 * then the stored Profile, then Guest. Somebody signed out has no role at all —
 * null, never Guest, so a signed-out person is not mistaken for a Guest who can
 * read their own Bookings.
 *
 * A Profile whose stored role is not one of the two resolves to Guest: a
 * document nobody can explain must not grant anything.
 */
export function resolveRole(user: RoleBearer, profile: Profile | null): Role | null {
  if (!user) return null
  const bootstrap = roleForEmail(user.email)
  if (bootstrap) return bootstrap
  return normalizeRole(profile?.role) ?? DEFAULT_ROLE
}

/**
 * Read a stored Profile document, refusing one that is not a Profile.
 *
 * The shape comes off Firestore, so it is treated as untrusted: a document with
 * no uid, or a role outside the two, is no Profile at all and its owner stays
 * a Guest.
 */
export function normalizeProfile(raw: unknown): Profile | null {
  if (!raw || typeof raw !== 'object') return null
  const doc = raw as Record<string, unknown>
  const uid = typeof doc.uid === 'string' ? doc.uid.trim() : ''
  const role = normalizeRole(typeof doc.role === 'string' ? doc.role : null)
  if (!uid || !role) return null
  return {
    uid,
    role,
    email: typeof doc.email === 'string' ? doc.email : null,
    display_name: typeof doc.display_name === 'string' ? doc.display_name : null,
    created_at: typeof doc.created_at === 'string' ? doc.created_at : undefined,
    updated_at: typeof doc.updated_at === 'string' ? doc.updated_at : undefined,
  }
}
