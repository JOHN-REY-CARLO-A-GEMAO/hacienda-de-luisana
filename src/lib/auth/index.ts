// ----------------------------------------------------------------------------
// Authentication & RBAC module — public interface
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// One deep module owning everything the system knows about *who* is asking: the
// three roles CONTEXT.md defines, the permissions each of them holds, the pages
// those permissions open, the Profile that stores a person's role, the words for
// every way a sign-in can fail, and the session that ties a provider to a role.
//
// Nothing in here imports Firebase. The two adapters that do — Firebase Auth with
// Firestore Profiles, and the local demo store — live beside this module and are
// handed to `createSession` as ports, so every decision RBAC makes is testable
// without a backend and is the same decision on every surface.
//
// The enforcement that actually matters is `firestore.rules`, which answers from
// the same catalogue: a person who calls Firestore directly, or edits this app's
// state in the browser, still gets refused there.
//
// Callers and tests import `src/lib/auth`; the files behind this entry point are
// implementation detail.
// ----------------------------------------------------------------------------

export {
  PERMISSIONS,
  ROLES,
  ROLE_LABELS,
  can,
  isRole,
  normalizeRole,
  permissionsOf,
  type Permission,
  type Role,
  type RoleAsActorKind,
} from './roles'

export { canOpenPage, homeForRole, normalizePath, pagePermission, pageRoles } from './pages'

export {
  BOOTSTRAP_ROLES,
  DEFAULT_ROLE,
  normalizeProfile,
  resolveRole,
  roleForEmail,
  type Profile,
  type RoleBearer,
} from './profile'

export {
  AuthError,
  MIN_PASSWORD_LENGTH,
  describeAuthError,
  validateCredentials,
  validateEmail,
  validateRegistration,
  type Accepted,
  type AuthErrorCode,
  type Credentials,
  type Registration,
  type Rejected,
} from './credentials'

export {
  createSession,
  type AuthPort,
  type ProfilePort,
  type SessionState,
  type SessionStore,
  type SessionUser,
} from './session'
