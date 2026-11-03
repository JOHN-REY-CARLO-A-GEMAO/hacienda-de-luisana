// ----------------------------------------------------------------------------
// The session: who is signed in, which of the two roles they have, and what
// they may do about it
// ----------------------------------------------------------------------------
// One store every surface reads, whether the person signed in with Firebase or
// with the local demo adapter that stands in when there is no Firebase project.
// It owns the parts that are easy to get wrong separately: waiting for a Profile
// before anybody is told what their role is, resolving that role exactly the way
// firestore.rules resolves it, and turning every provider failure into an
// AuthError a form can show.
//
// Nothing here changes anybody's role. The website is the Guest's application
// (ADR-0007): a sign-up makes a Guest, and the Admin is recognised — never
// made — from the bootstrap allowlist or a Profile written outside this app.
//
// Nothing here knows which provider it is talking to — the ports do — so the
// whole of it is testable with two in-memory adapters and no network.
//
// This is an internal file of the `src/lib/auth` module.
// ----------------------------------------------------------------------------

import type { Actor } from '../booking'
import { DEFAULT_ROLE, resolveRole, type Profile } from './profile'
import { ROLE_LABELS, can as roleCan, type Permission, type Role } from './roles'
import { LIMITS, checkRateLimit } from '../rateLimit'
import {
  AuthError,
  describeAuthError,
  validateCredentials,
  validateEmail,
  validateRegistration,
  type Credentials,
  type Registration,
  type RegistrationInput,
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
  /** Firebase's verified-email flag, or null for the browser-only demo. */
  emailVerified: boolean | null
}

/** Delivery state belongs to one identity and email, never to the next session. */
export type VerificationEmailState = {
  uid: string | null
  email: string | null
  status: 'idle' | 'sending' | 'sent' | 'failed'
  message: string | null
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
  /** Send only for this still-current identity and email. */
  sendVerificationEmail(uid: string, email: string): Promise<void>
  /** Re-read Firebase's verified-email flag for this still-current identity. */
  reloadVerification(uid: string): Promise<SessionUser>
}

/**
 * Reading the Profile that says which role a person has, and writing the one a
 * sign-up leaves behind. There is no way to write any other role from here: the
 * website never promotes anybody (ADR-0007).
 */
export type ProfilePort = {
  read(uid: string): Promise<Profile | null>
  create(profile: Profile): Promise<Profile>
}

export type SessionState = {
  /** `loading` while a session is being restored or a Profile is being read. */
  status: 'loading' | 'signed-out' | 'signed-in'
  user: SessionUser | null
  profile: Profile | null
  /** Null while loading and while signed out: nobody has a role yet. */
  role: Role | null
  isCloud: boolean
  /** Whether this identity's registration is still finishing after sign-in. */
  isRegistering: boolean
  verificationEmail: VerificationEmailState
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
  register(input: RegistrationInput): Promise<SessionUser>
  login(email: string, password: string): Promise<SessionUser>
  loginWithGoogle(): Promise<SessionUser>
  logout(): Promise<void>
  resetPassword(email: string): Promise<void>
  /** Request another verification email for the signed-in password account. */
  sendVerificationEmail(): Promise<void>
  /** Refresh the account and token after following a verification link. */
  checkEmailVerification(): Promise<boolean>
  /** Re-read the current identity and Profile, in case either changed. */
  refresh(): Promise<void>
}

const NO_VERIFICATION_EMAIL: VerificationEmailState = {
  uid: null, email: null, status: 'idle', message: null,
}

const SIGNED_OUT: Pick<SessionState, 'status' | 'user' | 'profile' | 'role'> = {
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
  let state: SessionState = {
    ...SIGNED_OUT,
    status: 'loading',
    isCloud: auth.isCloud,
    isRegistering: false,
    verificationEmail: NO_VERIFICATION_EMAIL,
  }
  const listeners = new Set<(state: SessionState) => void>()
  /** Bumped on every change of person, so a slow Profile read cannot land late. */
  let generation = 0
  let pending: { uid: string; promise: Promise<void> } | null = null
  const registrationsInProgress = new Map<symbol, string>()
  let verificationGeneration = 0
  /** Distinguish even two sign-ins of the same UID across a sign-out. */
  let identityEpoch = 0
  let verificationInFlight: { uid: string; email: string; promise: Promise<void> } | null = null
  let destroyed = false

  function registeringFor(user: SessionUser | null): boolean {
    return Boolean(user?.email && [...registrationsInProgress.values()].includes(user.email.trim().toLowerCase()))
  }

  function emit() {
    for (const listener of [...listeners]) listener(state)
  }

  function set(next: Partial<SessionState>) {
    state = { ...state, ...next }
    emit()
  }

  async function loadProfile(user: SessionUser, gen: number): Promise<void> {
    const userAtStart = state.user
    let profile: Profile | null = null
    try {
      profile = await profiles.read(user.uid)
    } catch (error) {
      // A Profile that cannot be read leaves the person a Guest, which is what
      // the rules do too. Losing the read must not lose the session.
      console.warn('[Auth] could not read the Profile for this session', error)
    }
    if (gen !== generation) return
    // Verification can finish while a Profile read is still pending. Keep the
    // latest version of this identity rather than restoring the older flag.
    const latest = state.user?.uid === user.uid && state.user !== userAtStart ? state.user : user
    set({ status: 'signed-in', user: latest, profile, role: resolveRole(latest, profile) })
  }

  function onUser(user: SessionUser | null) {
    generation += 1
    if ((state.user?.uid ?? null) !== (user?.uid ?? null)) identityEpoch += 1
    const delivery = state.verificationEmail
    const changedDeliveryIdentity = delivery.uid !== null && (
      !user || delivery.uid !== user.uid || delivery.email !== user.email || user.emailVerified === true
    )
    if (!user || changedDeliveryIdentity) {
      verificationGeneration += 1
      verificationInFlight = null
    }
    const verificationEmail = !user || changedDeliveryIdentity ? NO_VERIFICATION_EMAIL : delivery
    const isRegistering = registeringFor(user)
    if (!user) {
      pending = null
      set({ ...SIGNED_OUT, isCloud: auth.isCloud, verificationEmail, isRegistering })
      return
    }
    if (state.status === 'signed-in' && state.user?.uid === user.uid) {
      // The same person, refreshed: keep the role rather than flashing a spinner.
      set({ user, verificationEmail, isRegistering })
      return
    }
    // Loading with no role: a page that asked now would be told nobody may
    // anything, which is the safe answer until the Profile has been read.
    set({ status: 'loading', user, profile: null, role: null, verificationEmail, isRegistering })
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
    // A sign-out or account switch can happen while registration/profile work
    // is pending. Only the provider listener may move the session to that new
    // identity; the old operation must not load its user back into the store.
    if (auth.current()?.uid !== user.uid || (state.user && state.user.uid !== user.uid)) return
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

  function canVerify(user: SessionUser | null): user is SessionUser & { email: string } {
    return Boolean(
      auth.isCloud && user && !user.isAnonymous && user.provider === 'password'
      && user.email && user.emailVerified === false,
    )
  }

  function deliveryFailure(error: unknown): string {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    if (code === 'auth/network-request-failed') {
      return 'Check your internet connection and try again.'
    }
    if (code === 'auth/too-many-requests') {
      return 'Too many requests. Please wait before trying again.'
    }
    return 'Please try again in a little while.'
  }

  /**
   * Both sign-up and the resend button use this one path. Its result is tagged
   * with the exact UID and email so a late response can never announce success
   * or failure on another Guest's session. Firebase also rate-limits requests;
   * this small client cooldown prevents accidental repeated clicks.
   */
  async function requestVerification(user: SessionUser & { email: string }): Promise<void> {
    const { uid, email } = user
    const current = auth.current()
    if (!canVerify(current) || current.uid !== uid || current.email !== email) {
      throw new AuthError('hdl/unavailable', 'Sign in again before requesting a verification email.')
    }
    if (verificationInFlight?.uid === uid && verificationInFlight.email === email) {
      return verificationInFlight.promise
    }

    const operation = ++verificationGeneration
    const isCurrent = () => {
      const now = auth.current()
      return !destroyed && operation === verificationGeneration
        && canVerify(now) && now.uid === uid && now.email === email
    }
    const limit = checkRateLimit(`email-verification:${uid}`, LIMITS.verification)
    if (!limit.ok) {
      if (isCurrent()) set({ verificationEmail: { uid, email, status: 'failed', message: limit.message } })
      throw new AuthError('auth/too-many-requests', limit.message)
    }

    const promise = Promise.resolve()
      .then(() => auth.sendVerificationEmail(uid, email))
      .then(() => {
        if (isCurrent()) set({ verificationEmail: { uid, email, status: 'sent', message: null } })
      })
      .catch((error: unknown) => {
        if (isCurrent()) set({ verificationEmail: { uid, email, status: 'failed', message: deliveryFailure(error) } })
        throw error
      })
    verificationInFlight = { uid, email, promise }
    set({ verificationEmail: { uid, email, status: 'sending', message: null } })
    try {
      await promise
    } finally {
      if (verificationInFlight?.promise === promise) verificationInFlight = null
    }
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener)
      // Report the state that is current at the moment of subscribing, the way
      // the provider's own `subscribe` does. Without this, a page reload in
      // demo mode hangs on "Checking authentication…" forever: the local
      // Profile read resolves in a microtask — before React's effect can
      // subscribe — so the one `emit()` that would have said "signed in" is
      // broadcast to nobody and the spinner never leaves.
      listener(state)
      return () => {
        listeners.delete(listener)
      }
    },

    destroy() {
      unsubscribeAuth()
      listeners.clear()
      destroyed = true
      generation += 1
      identityEpoch += 1
      verificationGeneration += 1
      pending = null
      verificationInFlight = null
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
        const registration = Symbol('registration')
        registrationsInProgress.set(registration, checked.value.email)
        set({ isRegistering: registeringFor(state.user) })
        try {
          const user = await auth.register(checked.value)
          // Account creation has already succeeded. Email delivery is a separate
          // operation: a failed or slow send must not turn that success into a
          // failed sign-up, or make the Guest try to create the account again.
          // The state is retained even if the sign-in page has already redirected.
          if (canVerify(user)) void requestVerification(user).catch(() => {})

          // A sign-up is a Guest. There is no role to pass in, so nothing a person
          // types can arrive as the Admin (ADR-0005).
          const at = new Date().toISOString()
          try {
            await profiles.create({
              uid: user.uid,
              role: DEFAULT_ROLE,
              email: user.email,
              display_name: checked.value.displayName ?? user.displayName,
              first_name: checked.value.firstName,
              middle_name: checked.value.middleName,
              last_name: checked.value.lastName,
              phone: checked.value.phone,
              birthdate: checked.value.birthdate,
              terms_version: checked.value.termsVersion,
              terms_accepted_at: checked.value.termsAcceptedAt,
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
        } finally {
          registrationsInProgress.delete(registration)
          if (!destroyed) set({ isRegistering: registeringFor(state.user) })
        }
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
        identityEpoch += 1
        verificationGeneration += 1
        verificationInFlight = null
        pending = null
        // Most providers tell us themselves; only say it once.
        if (state.status !== 'signed-out') {
          set({ ...SIGNED_OUT, isCloud: auth.isCloud, isRegistering: false, verificationEmail: NO_VERIFICATION_EMAIL })
        }
      }),

    resetPassword: (email) =>
      guard(async () => {
        const checked = validateEmail(email)
        if (!checked.ok) throw checked.error
        await auth.resetPassword(checked.value.email)
      }),

    sendVerificationEmail: () =>
      guard(async () => {
        const user = state.user
        if (!canVerify(user)) {
          throw new AuthError('hdl/unavailable', 'Email verification is not available for this session.')
        }
        if (state.isRegistering && (verificationInFlight?.uid !== user.uid || verificationInFlight.email !== user.email)) {
          throw new AuthError('hdl/unavailable', 'Your verification email is being prepared. Please wait.')
        }
        await requestVerification(user)
      }),

    checkEmailVerification: () =>
      guard(async () => {
        const previous = state.user
        if (!canVerify(previous)) {
          throw new AuthError('hdl/unavailable', 'Email verification is not available for this session.')
        }
        const epoch = identityEpoch
        const refreshed = await auth.reloadVerification(previous.uid)
        // Checking a link must never restore a signed-out or different identity,
        // including an older sign-in of the same UID.
        if (epoch !== identityEpoch || auth.current()?.uid !== previous.uid || state.user?.uid !== previous.uid) {
          throw new AuthError('auth/user-token-expired')
        }
        if (refreshed.email !== previous.email) {
          verificationGeneration += 1
          verificationInFlight = null
          set({ user: refreshed, verificationEmail: NO_VERIFICATION_EMAIL })
          throw new AuthError('hdl/unavailable', 'Your sign-in email changed. Check the current address and try again.')
        }
        if (refreshed.emailVerified) {
          verificationGeneration += 1
          verificationInFlight = null
          set({ user: refreshed, verificationEmail: NO_VERIFICATION_EMAIL })
        } else {
          set({ user: refreshed })
        }
        return refreshed.emailVerified === true
      }),

    refresh: () =>
      guard(async () => {
        const previous = state.user
        const current = auth.current()
        // Never resurrect a signed-out or different identity during a refresh.
        // The provider listener owns changes of person; refresh only updates the
        // same UID (including after an anonymous account is linked).
        if (!previous || !current || previous.uid !== current.uid) return
        generation += 1
        await loadProfile(current, generation)
      }),
  }
}
