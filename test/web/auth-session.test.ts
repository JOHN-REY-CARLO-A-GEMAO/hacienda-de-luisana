// Authentication — the session: signing up, signing in, signing out, keeping a
// session across a reload, and the role each of them lands on.
//
// Tested at the seam `createSession(authPort, profilePort)` with two in-memory
// adapters standing where Firebase Auth and the Firestore `profiles` collection
// stand in production. The seam is real because two adapters satisfy it; nothing
// here reaches inside the session.
import {
  AuthError,
  createSession,
  type AuthPort,
  type Profile,
  type ProfilePort,
  type Role,
  type SessionUser,
} from '../../src/lib/auth'

// ----------------------------------------------------------------------------
// The two adapters, in memory
// ----------------------------------------------------------------------------

// Every credential in this file is invented here and used nowhere else. They are
// named for what a case means by them, because "a password" is not one thing in
// these tests: it is the one an account was registered with, one too short to
// keep, and one the floor just accepts.
const REGISTERED_WITH = 'bahay-kubo'
const TOO_SHORT_TO_KEEP = '123'
const AT_THE_FLOOR = 'xxxxxx'

type FakeAccount = { user: SessionUser; password: string }

type FakeProvider = {
  port: AuthPort
  /** Who the provider holds, keyed by email — what a sign-up leaves behind. */
  accounts: Map<string, FakeAccount>
  /** Put somebody in a signed-in session without a sign-in, as a reload would. */
  signInNow(user: SessionUser): void
  /** End the session from the provider's side, as an expired token would. */
  expire(): void
  seed(account: FakeAccount): void
}

function user(uid: string, email: string | null, extra: Partial<SessionUser> = {}): SessionUser {
  return { uid, email, displayName: null, isAnonymous: false, provider: 'password', ...extra }
}

function createFakeProvider(options: { isCloud?: boolean; google?: boolean } = {}): FakeProvider {
  const isCloud = options.isCloud ?? false
  const accounts = new Map<string, FakeAccount>()
  const listeners = new Set<(user: SessionUser | null) => void>()
  let current: SessionUser | null = null

  const emit = () => {
    for (const listener of [...listeners]) listener(current)
  }
  const signIn = (next: SessionUser) => {
    current = next
    emit()
    return next
  }

  const port: AuthPort = {
    isCloud,
    supportsGoogle: options.google ?? false,
    subscribe(listener) {
      listeners.add(listener)
      // The contract: tell the listener who is signed in right now.
      listener(current)
      return () => {
        listeners.delete(listener)
      }
    },
    current: () => current,
    async register(input) {
      if (accounts.has(input.email)) throw new AuthError('auth/email-already-in-use')
      const next = user(`uid-${accounts.size + 1}`, input.email, { displayName: input.displayName ?? null })
      accounts.set(input.email, { user: next, password: input.password })
      return signIn(next)
    },
    async login(credentials) {
      const account = accounts.get(credentials.email)
      if (!account) throw new AuthError('auth/user-not-found')
      if (account.password !== credentials.password) throw new AuthError('auth/invalid-credential')
      return signIn(account.user)
    },
    async loginWithGoogle() {
      if (!port.supportsGoogle) throw new AuthError('auth/operation-not-allowed')
      return signIn(user('google-1', 'ana@gmail.com', { provider: 'google' }))
    },
    async logout() {
      current = null
      emit()
    },
    async resetPassword(email) {
      if (!accounts.has(email)) throw new AuthError('auth/user-not-found')
    },
  }

  return {
    port,
    accounts,
    signInNow(next) {
      signIn(next)
    },
    seed(account) {
      accounts.set(account.user.email ?? account.user.uid, account)
    },
    expire() {
      current = null
      emit()
    },
  }
}

type FakeProfiles = {
  port: ProfilePort
  stored: Map<string, Profile>
  /** Make every read wait, so a test can look at the session while it waits. */
  holdReads(): void
  releaseReads(): void
}

function createFakeProfiles(seed: Profile[] = []): FakeProfiles {
  const stored = new Map(seed.map((profile) => [profile.uid, profile]))
  let blocked: { promise: Promise<void>; resolve: () => void } | null = null
  const wait = () => blocked?.promise ?? Promise.resolve()

  const port: ProfilePort = {
    async read(uid) {
      await wait()
      return stored.get(uid) ?? null
    },
    async create(profile) {
      await wait()
      stored.set(profile.uid, profile)
      return profile
    },
  }

  return {
    port,
    stored,
    holdReads() {
      let resolve!: () => void
      const promise = new Promise<void>((done) => {
        resolve = done
      })
      blocked = { promise, resolve }
    },
    releaseReads() {
      blocked?.resolve()
      blocked = null
    },
  }
}

function startSession(provider: FakeProvider = createFakeProvider(), profiles: FakeProfiles = createFakeProfiles()) {
  return { session: createSession(provider.port, profiles.port), provider, profiles }
}

/** Let every microtask a promise chain is waiting on run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const ADMIN: Profile = { uid: 'uid-admin', role: 'admin', email: 'ana@hacienda.test' }

// ----------------------------------------------------------------------------

describe('signing up', () => {
  it('makes the person a Guest and keeps them signed in', async () => {
    const { session, profiles } = startSession()

    const signed = await session.register({
      email: '  Maria@Example.com ',
      password: REGISTERED_WITH,
      displayName: '  Maria   Santos ',
    })

    expect(signed.email).toBe('maria@example.com')
    expect(session.getState().status).toBe('signed-in')
    expect(session.getState().role).toBe('guest')
    // The role is stored, not kept in a component: the next reload reads it back.
    expect(profiles.stored.get(signed.uid)).toMatchObject({ role: 'guest', display_name: 'Maria Santos' })
  })

  it('cannot be talked into any other role', async () => {
    const { session } = startSession()

    // Whatever arrives in the body of a sign-up, the person is a Guest: there is
    // no role to ask for, and the Admin is recognised, never requested
    // (ADR-0005, ADR-0007).
    const signed = await session.register({
      email: 'escalator@example.com',
      password: REGISTERED_WITH,
      role: 'admin',
    } as any)

    expect(signed.uid).toBeTruthy()
    expect(session.getState().role).toBe('guest')
    expect(session.can('bookings:review')).toBe(false)
  })

  it('refuses a password too short to keep, without creating an account', async () => {
    const { session, provider } = startSession()

    await expect(session.register({ email: 'short@example.com', password: TOO_SHORT_TO_KEEP })).rejects.toMatchObject({
      code: 'auth/weak-password',
    })
    expect(provider.accounts.size).toBe(0)
    expect(session.getState().status).toBe('signed-out')
  })

  it('refuses an address that is not an address', async () => {
    const { session, provider } = startSession()

    await expect(session.register({ email: 'not-an-email', password: REGISTERED_WITH })).rejects.toMatchObject({
      code: 'auth/invalid-email',
      message: 'Please enter a valid email address.',
    })
    await expect(session.register({ email: '', password: REGISTERED_WITH })).rejects.toMatchObject({
      code: 'auth/invalid-email',
    })
    expect(provider.accounts.size).toBe(0)
  })

  it('says plainly that an account already exists', async () => {
    const { session } = startSession()
    await session.register({ email: 'twice@example.com', password: REGISTERED_WITH })
    await session.logout()

    await expect(session.register({ email: 'twice@example.com', password: REGISTERED_WITH })).rejects.toMatchObject({
      code: 'auth/email-already-in-use',
      message: 'An account with this email already exists. Try logging in.',
    })
  })

  it('keeps an account that survives a lost Profile write', async () => {
    const provider = createFakeProvider()
    const profiles = createFakeProfiles()
    profiles.port.create = async () => {
      throw new Error('permission-denied')
    }
    const session = createSession(provider.port, profiles.port)

    await session.register({ email: 'no-profile@example.com', password: REGISTERED_WITH })

    // No Profile is the same answer the rules give: a Guest, signed in.
    expect(session.getState()).toMatchObject({ status: 'signed-in', role: 'guest', profile: null })
  })
})

describe('signing in', () => {
  it('answers with the role the stored Profile gives', async () => {
    const provider = createFakeProvider()
    provider.seed({ user: user('uid-admin', 'ana@hacienda.test'), password: REGISTERED_WITH })
    const { session } = startSession(provider, createFakeProfiles([ADMIN]))

    await session.login('ana@hacienda.test', 'bahay-kubo')

    expect(session.getState()).toMatchObject({ status: 'signed-in', role: 'admin' })
    expect(session.can('bookings:read:all')).toBe(true)
    expect(session.can('bookings:review')).toBe(true)
    // An Admin's own Bookings are not a thing the website has: the Admin
    // operates from the mobile app (ADR-0007).
    expect(session.can('booking:read:own')).toBe(false)
  })

  it('reads a leftover Host or Staff Profile as a Guest', async () => {
    // Profiles written before ADR-0007 may still say 'host' or 'staff'. Neither
    // is a role any more, and neither grants anything.
    const provider = createFakeProvider()
    provider.seed({ user: user('uid-old', 'old@hacienda.test'), password: REGISTERED_WITH })
    const { session } = startSession(
      provider,
      createFakeProfiles([{ uid: 'uid-old', role: 'staff' as Role, email: 'old@hacienda.test' }]),
    )

    await session.login('old@hacienda.test', 'bahay-kubo')

    expect(session.getState().role).toBe('guest')
    expect(session.can('bookings:read:all')).toBe(false)
  })

  it('lets the bootstrap allowlist outrank a Profile, the way the rules do', async () => {
    const provider = createFakeProvider()
    provider.seed({ user: user('uid-owner', 'haciendadeluisiana@gmail.com'), password: REGISTERED_WITH })
    // A Profile written before the allowlist was read says Guest; firestore.rules
    // would still answer Admin, so the session must too.
    const { session } = startSession(
      provider,
      createFakeProfiles([{ uid: 'uid-owner', role: 'guest', email: 'haciendadeluisiana@gmail.com' }]),
    )

    await session.login('haciendadeluisiana@gmail.com', 'bahay-kubo')

    expect(session.getState().role).toBe('admin')
    expect(session.can('bookings:review')).toBe(true)
  })

  it('makes a person with no Profile a Guest', async () => {
    const provider = createFakeProvider()
    provider.seed({ user: user('uid-new', 'new@hacienda.test'), password: REGISTERED_WITH })
    const { session } = startSession(provider, createFakeProfiles())

    await session.login('new@hacienda.test', 'bahay-kubo')

    expect(session.getState()).toMatchObject({ status: 'signed-in', profile: null, role: 'guest' })
  })

  it('refuses a wrong password without saying which half was wrong', async () => {
    const provider = createFakeProvider()
    provider.seed({ user: user('uid-1', 'maria@example.com'), password: REGISTERED_WITH })
    const { session } = startSession(provider)

    await expect(session.login('maria@example.com', 'mali-ang-password')).rejects.toMatchObject({
      code: 'auth/invalid-credential',
      message: 'Invalid email or password. Please try again.',
    })
    expect(session.getState().status).toBe('signed-out')
    expect(session.can('booking:read:own')).toBe(false)
  })

  it('refuses an address nobody has an account for', async () => {
    const { session } = startSession()

    await expect(session.login('wala@example.com', 'bahay-kubo')).rejects.toMatchObject({
      code: 'auth/user-not-found',
    })
  })

  it('gives nobody a role while their Profile is still being read', async () => {
    const provider = createFakeProvider()
    provider.seed({ user: user('uid-admin', 'ana@hacienda.test'), password: REGISTERED_WITH })
    const profiles = createFakeProfiles([ADMIN])
    profiles.holdReads()
    const { session } = startSession(provider, profiles)

    const signingIn = session.login('ana@hacienda.test', 'bahay-kubo')
    await settle()

    expect(session.getState().status).toBe('loading')
    expect(session.getState().role).toBeNull()
    expect(session.can('bookings:review')).toBe(false)

    profiles.releaseReads()
    await signingIn
    expect(session.getState()).toMatchObject({ status: 'signed-in', role: 'admin' })
  })

  it('turns whatever a provider throws into a message a person can read', async () => {
    const provider = createFakeProvider()
    provider.seed({ user: user('uid-1', 'a@b.co'), password: AT_THE_FLOOR })
    provider.port.login = async () => {
      throw new Error('A network response that was not JSON')
    }
    const { session } = startSession(provider)

    const error = await session.login('a@b.co', AT_THE_FLOOR).catch((thrown) => thrown)
    expect(error).toBeInstanceOf(AuthError)
    expect(error).toMatchObject({ code: 'hdl/unknown', message: 'A network response that was not JSON' })
  })

  it('sends a password reset to an address that exists, cleaned on the way', async () => {
    const provider = createFakeProvider()
    provider.seed({ user: user('uid-1', 'maria@example.com'), password: REGISTERED_WITH })
    const { session } = startSession(provider)
    const sent: string[] = []
    provider.port.resetPassword = async (email: string) => {
      sent.push(email)
      if (!provider.accounts.has(email)) throw new AuthError('auth/user-not-found')
    }

    await expect(session.resetPassword('  MARIA@example.com ')).resolves.toBeUndefined()
    // Trimming and folding happen here, so no provider has to do them again.
    expect(sent).toEqual(['maria@example.com'])
    await expect(session.resetPassword('nobody@example.com')).rejects.toMatchObject({
      code: 'auth/user-not-found',
    })
    await expect(session.resetPassword('not-an-email')).rejects.toMatchObject({ code: 'auth/invalid-email' })
  })
})

describe('signing out, and a session that ends by itself', () => {
  it('leaves the person with no role and no permissions', async () => {
    const provider = createFakeProvider()
    provider.seed({ user: user('uid-admin', 'ana@hacienda.test'), password: REGISTERED_WITH })
    const { session } = startSession(provider, createFakeProfiles([ADMIN]))
    await session.login('ana@hacienda.test', 'bahay-kubo')

    await session.logout()

    expect(session.getState()).toEqual({
      status: 'signed-out',
      user: null,
      profile: null,
      role: null,
      isCloud: false,
    })
    expect(session.can('bookings:review')).toBe(false)
    expect(session.actor()).toBeNull()
  })

  it('follows the provider when a session expires underneath the page', async () => {
    const provider = createFakeProvider()
    provider.seed({ user: user('uid-admin', 'ana@hacienda.test'), password: REGISTERED_WITH })
    const { session } = startSession(provider, createFakeProfiles([ADMIN]))
    await session.login('ana@hacienda.test', 'bahay-kubo')
    expect(session.getState().role).toBe('admin')

    provider.expire()

    expect(session.getState().status).toBe('signed-out')
    expect(session.can('bookings:read:all')).toBe(false)
  })

  it('is still signed in when the page is reloaded', async () => {
    const provider = createFakeProvider()
    provider.seed({ user: user('uid-admin', 'ana@hacienda.test'), password: REGISTERED_WITH })
    const profiles = createFakeProfiles([ADMIN])
    const first = createSession(provider.port, profiles.port)
    await first.login('ana@hacienda.test', 'bahay-kubo')

    // A new session over the same provider is a reload: nobody signs in again.
    const reloaded = createSession(provider.port, profiles.port)
    await reloaded.refresh()

    expect(reloaded.getState()).toMatchObject({ status: 'signed-in', role: 'admin' })
    first.destroy()
    reloaded.destroy()
  })

  it('tells the listeners what happened, so a page can follow', async () => {
    const provider = createFakeProvider()
    provider.seed({ user: user('uid-1', 'maria@example.com'), password: REGISTERED_WITH })
    const { session } = startSession(provider, createFakeProfiles())
    const seen: string[] = []
    const unsubscribe = session.subscribe((state) => seen.push(`${state.status}:${state.role ?? 'none'}`))

    await session.login('maria@example.com', 'bahay-kubo')
    await session.logout()
    unsubscribe()
    await session.login('maria@example.com', 'bahay-kubo')

    expect(seen).toEqual(['loading:none', 'signed-in:guest', 'signed-out:none'])
    expect(session.getState().role).toBe('guest')
  })
})

describe('the actor a signed-in person puts on a Booking', () => {
  it('is their role, their uid and the name the Activity log will show', async () => {
    const provider = createFakeProvider()
    provider.seed({
      user: user('uid-admin', 'ana@hacienda.test', { displayName: 'Ana Luisana' }),
      password: REGISTERED_WITH,
    })
    const { session } = startSession(provider, createFakeProfiles([ADMIN]))
    await session.login('ana@hacienda.test', 'bahay-kubo')

    expect(session.actor()).toEqual({ actor: 'admin', actor_id: 'uid-admin', actor_name: 'Ana Luisana' })
  })

  it('falls back to the address, then to the role, when there is no name', async () => {
    const provider = createFakeProvider()
    provider.seed({ user: user('uid-1', 'maria@example.com'), password: REGISTERED_WITH })
    const { session } = startSession(provider)
    await session.login('maria@example.com', 'bahay-kubo')
    expect(session.actor()).toMatchObject({ actor: 'guest', actor_name: 'maria@example.com' })

    // An anonymous Guest identity: no address, no name, still a Guest.
    const anonymous = createFakeProvider()
    anonymous.signInNow(user('anon-9', null, { isAnonymous: true, provider: 'anonymous' }))
    const anonymousSession = createSession(anonymous.port, createFakeProfiles().port)
    await anonymousSession.refresh()

    expect(anonymousSession.actor()).toEqual({ actor: 'guest', actor_id: 'anon-9', actor_name: 'Guest' })
  })
})

describe('who decides which role a person has', () => {
  it('is nobody on the website: the session has no way to change a role', async () => {
    const provider = createFakeProvider()
    provider.seed({ user: user('uid-admin', 'ana@hacienda.test'), password: REGISTERED_WITH })
    const { session } = startSession(provider, createFakeProfiles([ADMIN]))
    await session.login('ana@hacienda.test', 'bahay-kubo')

    // Not even the Admin: the website is the Guest's application, and a
    // Profile's role is written outside it (ADR-0007).
    expect('assignRole' in session).toBe(false)
    expect('team' in session).toBe(false)
    expect('signInAsRole' in session).toBe(false)
  })

  it('picks up a role written for you elsewhere, on refresh', async () => {
    const provider = createFakeProvider()
    const profiles = createFakeProfiles([{ uid: 'uid-ben', role: 'guest', email: 'ben@hacienda.test' }])
    provider.seed({ user: user('uid-ben', 'ben@hacienda.test'), password: REGISTERED_WITH })
    const session = createSession(provider.port, profiles.port)
    await session.login('ben@hacienda.test', 'bahay-kubo')
    expect(session.getState().role).toBe('guest')

    // The Profile is changed outside this session; the person re-reads it.
    profiles.stored.set('uid-ben', { uid: 'uid-ben', role: 'admin', email: 'ben@hacienda.test' })
    await session.refresh()

    expect(session.getState().role).toBe('admin')
    expect(session.can('stays:complete')).toBe(true)
    expect(session.can('booking:read:own')).toBe(false)
  })
})

describe('a session with no Firebase behind it', () => {
  it('still makes a sign-up a Guest, with no role switcher to step past it', async () => {
    const { session } = startSession(createFakeProvider(), createFakeProfiles())

    await session.register({ email: 'maria@example.com', password: REGISTERED_WITH })

    expect(session.getState().role).toBe('guest')
    expect(session.can('bookings:read:all')).toBe(false)
  })

  it('refuses Google sign-in where it does not exist', async () => {
    const cloud = startSession(createFakeProvider({ isCloud: true, google: false }))

    await expect(cloud.session.loginWithGoogle()).rejects.toMatchObject({ code: 'hdl/unavailable' })
  })

  it('signs in with Google where the project supports it', async () => {
    const { session } = startSession(createFakeProvider({ isCloud: true, google: true }))

    await session.loginWithGoogle()

    expect(session.getState()).toMatchObject({ status: 'signed-in', user: { email: 'ana@gmail.com' } })
  })
})
