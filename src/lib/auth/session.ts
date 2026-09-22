// ----------------------------------------------------------------------------
// The session: who is signed in, which of the three roles they have, and what
// they may do about it
// ----------------------------------------------------------------------------
// One store every surface reads, whether the person signed in with Firebase or
// with the local demo adapter that stands in when there is no Firebase project.
// It owns the parts that are easy to get wrong separately: waiting for a Profile
// before anybody is told what their role is, resolving that role exactly the way
// firestore.rules resolves it, refusing a role change from somebody who is not
// the Host, and turning every provider failure into an AuthError a form can show.
//
// Nothing here knows which provider it is talking to — the ports do — so the
// whole of it is testable with two in-memory adapters and no network.
//
// This is an internal file of the `src/lib/auth` module.
// ----------------------------------------------------------------------------

import type { Actor } from '../booking'
import { DEFAULT_ROLE, resolveRole, type Profile } from './profile'
import { ROLE_LABELS, can as roleCan, isRole, type Permission, type Role } from './roles'
import {
  AuthError,
  describeAuthError,
  validateCredentials,
  validateEmail,
  validateRegistration,
  type Credentials,
  type Registration,
} from './credentials'

/** A signed-in person, as far as the session is concerned. */
export type SessionUser = {
  uid: string
  email: string | null
  displayName: string | null
  /** An anonymous Guest identity: a Booking hangs off it, but nobody signed up. */
  isAnonymous: boolean
  /** Where the session came from, so a form can offer what this provider supports. */
  provider: 'password' | 'google' | 'anonymous' | 'local'
}

/**
 * Signing people in and out.
 *
 * Two adapters satisfy this: Firebase Auth, and the local demo store used when
 * the project has no Firebase configured. `subscribe` must call the listener
 * straight away with whoever is signed in now — that is how the session knows a
 * page reload kept its sign-in.
 */
export type AuthPort = {
  /** True when the accounts live somewhere that enforces rules of its own. */
  readonly isCloud: boolean
  /** Google sign-in only exists on Firebase. */
  readonly supportsGoogle: boolean
  subscribe(listener: (user: SessionUser | null) => void): () => void
  current(): SessionUser | null
  register(input: Registration): Promise<SessionUser>
  login(credentials: Credentials): Promise<SessionUser>
  loginWithGoogle(): Promise<SessionUser>
  logout(): Promise<void>
  resetPassword(email: string): Promise<void>
  /**
   * Sign in as a ready-made account for a role. Present only on the local demo
   * adapter, where there is no Host to promote anybody and no Firebase to hold
   * the accounts.
   */
  signInAsRole?(role: Role): Promise<SessionUser>
}

/** Reading and writing the Profile that says which role a person has. */
export type ProfilePort = {
  read(uid: string): Promise<Profile | null>
  create(profile: Profile): Promise<Profile>
  assign(input: { uid: string; role: Role; email?: string | null; display_name?: string | null }): Promise<Profile>
  list(): Promise<Profile[]>
}

export type SessionState = {
  /** `loading` while a session is being restored or a Profile is being read. */
  status: 'loading' | 'signed-out' | 'signed-in'
  user: SessionUser | null
  profile: Profile | null
  /** Null while loading and while signed out: nobody has a role yet. */
  role: Role | null
  isCloud: boolean
}

export type SessionStore = {
  getState(): SessionState
  subscribe(listener: (state: SessionState) => void): () => void
  /** Stop listening to the provider. Tests and hot reloads need this. */
  destroy(): void
  /** May the signed-in person do this? Fails closed while loading. */
  can(permission: Permission): boolean
  /** The actor to put on a Booking action, or null when nobody is signed in. */
  actor(): Actor | null
  register(input: { email: string; password: string; displayName?: string }): Promise<SessionUser>
  login(email: string, password: string): Promise<SessionUser>
  loginWithGoogle(): Promise<SessionUser>
  logout(): Promise<void>
  resetPassword(email: string): Promise<void>
  /** Demo mode only: step into a role that has no Host to grant it. */
  signInAsRole(role: Role): Promise<SessionUser>
  /** Host only: decide which of the three roles somebody has. */
  assignRole(target: { uid: string; email?: string | null; displayName?: string | null }, role: Role): Promise<Profile>
  /** Host only: everybody who has a Profile. */
  team(): Promise<Profile[]>
  /** Re-read the signed-in person's Profile, in case a Host changed their role. */
  refresh(): Promise<void>
}

const SIGNED_OUT: Omit<SessionState, 'isCloud'> = {
  status: 'signed-out',
  user: null,
  profile: null,
  role: null,
}

/**
 * Build a session on top of a provider and a Profile store.
 *
 * The role is never taken on trust from the client: it is resolved from the
 * stored Profile (with the bootstrap allowlist ahead of it) every time the
 * signed-in person changes, which is the same answer firestore.rules gives.
 */
export function createSession(auth: AuthPort, profiles: ProfilePort): SessionStore {
  let state: SessionState = { ...SIGNED_OUT, status: 'loading', isCloud: auth.isCloud }
  const listeners = new Set<(state: SessionState) => void>()
  /** Bumped on every change of person, so a slow Profile read cannot land late. */
  let generation = 0
  let pending: { uid: string; promise: Promise<void> } | null = null

  function emit() {
    for (const listener of [...listeners]) listener(state)
  }

  function set(next: Partial<SessionState>) {
    state = { ...state, ...next }
    emit()
  }

  async function loadProfile(user: SessionUser, gen: number): Promise<void> {
    let profile: Profile | null = null
    try {
      profile = await profiles.read(user.uid)
    } catch (error) {
      // A Profile that cannot be read leaves the person a Guest, which is what
      // the rules do too. Losing the read must not lose the session.
      console.warn('[Auth] could not read the Profile for this session', error)
    }
    if (gen !== generation) return
    set({ status: 'signed-in', user, profile, role: resolveRole(user, profile) })
  }

  function onUser(user: SessionUser | null) {
    generation += 1
    if (!user) {
      pending = null
      set({ ...SIGNED_OUT, isCloud: auth.isCloud })
      return
    }
    if (state.status === 'signed-in' && state.user?.uid === user.uid) {
      // The same person, refreshed: keep the role rather than flashing a spinner.
      set({ user })
      return
    }
    // Loading with no role: a page that asked now would be told nobody may
    // anything, which is the safe answer until the Profile has been read.
    set({ status: 'loading', user, profile: null, role: null })
    const promise = loadProfile(user, generation)
    pending = { uid: user.uid, promise }
  }

  const unsubscribeAuth = auth.subscribe(onUser)

  /** Wait until this person's role is known, reading the Profile if nobody has. */
  async function settleFor(user: SessionUser): Promise<void> {
    const started = pending
    if (started && started.uid === user.uid) {
      await started.promise
      if (state.status === 'signed-in' && state.user?.uid === user.uid) return
    }
    generation += 1
    await loadProfile(user, generation)
  }

  /** Turn anything a provider throws into an AuthError, so callers see one shape. */
  async function guard<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run()
    } catch (error) {
      throw describeAuthError(error)
    }
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    destroy() {
      unsubscribeAuth()
      listeners.clear()
      generation += 1
      pending = null
    },

    can: (permission) => roleCan(state.role, permission),

    actor() {
      const { user, role } = state
      if (!user || !role) return null
      return {
        actor: role,
        actor_id: user.uid,
        actor_name: user.displayName || user.email || ROLE_LABELS[role],
      }
    },

    register: (input) =>
      guard(async () => {
        const checked = validateRegistration(input)
        if (!checked.ok) throw checked.error
        const user = await auth.register(checked.value)
        // A sign-up is a Guest. There is no role to pass in, so nothing a person
        // types can arrive as the Host (ADR-0005).
        const at = new Date().toISOString()
        try {
          await profiles.create({
            uid: user.uid,
            role: DEFAULT_ROLE,
            email: user.email,
            display_name: checked.value.displayName ?? user.displayName,
            created_at: at,
            updated_at: at,
          })
        } catch (error) {
          // Without a Profile the person is still a Guest — the default both
          // here and in the rules — so a failed write costs nothing.
          console.warn('[Auth] the new account is a Guest without a stored Profile', error)
        }
        await settleFor(user)
        return user
      }),

    login: (email, password) =>
      guard(async () => {
        const checked = validateCredentials({ email, password })
        if (!checked.ok) throw checked.error
        const user = await auth.login(checked.value)
        await settleFor(user)
        return user
      }),

    loginWithGoogle: () =>
      guard(async () => {
        if (!auth.supportsGoogle) {
          throw new AuthError('hdl/unavailable', 'Google sign-in needs Firebase to be configured.')
        }
        const user = await auth.loginWithGoogle()
        await settleFor(user)
        return user
      }),

    logout: () =>
      guard(async () => {
        await auth.logout()
        generation += 1
        pending = null
        // Most providers tell us themselves; only say it once.
        if (state.status !== 'signed-out') set({ ...SIGNED_OUT, isCloud: auth.isCloud })
      }),

    resetPassword: (email) =>
      guard(async () => {
        const checked = validateEmail(email)
        if (!checked.ok) throw checked.error
        await auth.resetPassword(checked.value.email)
      }),

    signInAsRole: (role) =>
      guard(async () => {
        if (!auth.signInAsRole) {
          throw new AuthError('hdl/unavailable', 'Demo sign-in is only available while Firebase is not configured.')
        }
        if (!isRole(role)) throw new AuthError('hdl/unknown', 'That is not one of the three roles.')
        const user = await auth.signInAsRole(role)
        await settleFor(user)
        return user
      }),

    assignRole: (target, role) =>
      guard(async () => {
        if (!roleCan(state.role, 'team:manage')) {
          throw new AuthError('hdl/forbidden', 'Only the Host decides which role somebody has.')
        }
        if (!isRole(role)) throw new AuthError('hdl/unknown', 'That is not one of the three roles.')
        if (!target?.uid) throw new AuthError('hdl/unknown', 'Nobody to give that role to.')
        if (target.uid === state.user?.uid) {
          // Otherwise one wrong click leaves the hacienda with no Host and nobody
          // signed in who can put it right.
          throw new AuthError('hdl/forbidden', 'You cannot change your own role — ask another Host.')
        }
        const profile = await profiles.assign({
          uid: target.uid,
          role,
          email: target.email ?? null,
          display_name: target.displayName ?? null,
        })
        return profile
      }),

    team: () =>
      guard(async () => {
        if (!roleCan(state.role, 'team:manage')) {
          throw new AuthError('hdl/forbidden', 'Only the Host can see who has which role.')
        }
        return profiles.list()
      }),

    refresh: () =>
      guard(async () => {
        const user = state.user
        if (!user) return
        generation += 1
        await loadProfile(user, generation)
      }),
  }
}
