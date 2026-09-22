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
// keep, one the floor just accepts, and one a stub never checks.
const REGISTERED_WITH = 'bahay-kubo'
const TOO_SHORT_TO_KEEP = '123'
const AT_THE_FLOOR = 'xxxxxx'
const NEVER_CHECKED = 'not-a-secret'

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

function createFakeProvider(options: { isCloud?: boolean; google?: boolean; demo?: boolean } = {}): FakeProvider {
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

  // The local demo adapter is the only one that can hand somebody a role with no
  // Host to grant it: there is no cloud behind it to promote them.
  if (!isCloud && options.demo !== false) {
    port.signInAsRole = async (role: Role) => {
      const next = user(`demo-${role}`, `${role}@hacienda.test`, {
        displayName: `Demo ${role}`,
        provider: 'local',
      })
      accounts.set(next.email!, { user: next, password: NEVER_CHECKED })
      return signIn(next)
    }
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
    async assign(input) {
      await wait()
      const before = stored.get(input.uid)
      const next: Profile = {
        uid: input.uid,
        role: input.role,
        email: input.email ?? before?.email ?? null,
        display_name: input.display_name ?? before?.display_name ?? null,
        updated_at: '2026-09-22T00:00:00.000Z',
      }
      stored.set(input.uid, next)
      return next
    },
    async list() {
      await wait()
      return [...stored.values()]
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

const HOST: Profile = { uid: 'uid-host', role: 'host', email: 'ana@hacienda.test' }
const STAFF: Profile = { uid: 'uid-staff', role: 'staff', email: 'ben@hacienda.test' }
const GUEST: Profile = { uid: 'uid-guest', role: 'guest', email: 'guest@hacienda.test' }

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
    // no role to ask for, and only a Host can give one (ADR-0005).
    const signed = await session.register({
      email: 'escalator@example.com',
      password: REGISTERED_WITH,
      role: 'host',
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
    provider.seed({ user: user('uid-staff', 'ben@hacienda.test'), password: REGISTERED_WITH })
    const { session } = startSession(provider, createFakeProfiles([STAFF]))

    await session.login('ben@hacienda.test', 'bahay-kubo')

    expect(session.getState()).toMatchObject({ status: 'signed-in', role: 'staff' })
    expect(session.can('bookings:read:all')).toBe(true)
    expect(session.can('bookings:review')).toBe(false)
  })

  it('lets the bootstrap allowlist outrank a Profile, the way the rules do', async () => {
    const provider = createFakeProvider()
    provider.seed({ user: user('uid-owner', 'haciendadeluisiana@gmail.com'), password: REGISTERED_WITH })
    // A Profile written before the allowlist was read says Guest; firestore.rules
    // would still answer Host, so the session must too.
    const { session } = startSession(
      provider,
      createFakeProfiles([{ uid: 'uid-owner', role: 'guest', email: 'haciendadeluisiana@gmail.com' }]),
    )

    await session.login('haciendadeluisiana@gmail.com', 'bahay-kubo')

    expect(session.getState().role).toBe('host')
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
    provider.seed({ user: user('uid-host', 'ana@hacienda.test'), password: REGISTERED_WITH })
    const profiles = createFakeProfiles([HOST])
    profiles.holdReads()
    const { session } = startSession(provider, profiles)

    const signingIn = session.login('ana@hacienda.test', 'bahay-kubo')
    await settle()

    expect(session.getState().status).toBe('loading')
    expect(session.getState().role).toBeNull()
    expect(session.can('bookings:review')).toBe(false)

    profiles.releaseReads()
    await signingIn
    expect(session.getState()).toMatchObject({ status: 'signed-in', role: 'host' })
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
    provider.seed({ user: user('uid-host', 'ana@hacienda.test'), password: REGISTERED_WITH })
    const { session } = startSession(provider, createFakeProfiles([HOST]))
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
    provider.seed({ user: user('uid-host', 'ana@hacienda.test'), password: REGISTERED_WITH })
    const { session } = startSession(provider, createFakeProfiles([HOST]))
    await session.login('ana@hacienda.test', 'bahay-kubo')
    expect(session.getState().role).toBe('host')

    provider.expire()

    expect(session.getState().status).toBe('signed-out')
    expect(session.can('bookings:read:all')).toBe(false)
  })

  it('is still signed in when the page is reloaded', async () => {
    const provider = createFakeProvider()
    provider.seed({ user: user('uid-staff', 'ben@hacienda.test'), password: REGISTERED_WITH })
    const profiles = createFakeProfiles([STAFF])
    const first = createSession(provider.port, profiles.port)
    await first.login('ben@hacienda.test', 'bahay-kubo')

    // A new session over the same provider is a reload: nobody signs in again.
    const reloaded = createSession(provider.port, profiles.port)
    await reloaded.refresh()

    expect(reloaded.getState()).toMatchObject({ status: 'signed-in', role: 'staff' })
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
      user: user('uid-staff', 'ben@hacienda.test', { displayName: 'Ben Cariño' }),
      password: REGISTERED_WITH,
    })
    const { session } = startSession(provider, createFakeProfiles([STAFF]))
    await session.login('ben@hacienda.test', 'bahay-kubo')

    expect(session.actor()).toEqual({ actor: 'staff', actor_id: 'uid-staff', actor_name: 'Ben Cariño' })
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

describe('deciding who has which role', () => {
  async function signedInAs(role: Role) {
    const provider = createFakeProvider()
    const profiles = createFakeProfiles([HOST, STAFF, GUEST])
    provider.seed({ user: user(`uid-${role}`, `${role}@hacienda.test`), password: REGISTERED_WITH })
    const session = createSession(provider.port, profiles.port)
    await session.login(`${role}@hacienda.test`, 'bahay-kubo')
    return { session, profiles }
  }

  it('is the Host’s to decide', async () => {
    const { session, profiles } = await signedInAs('host')

    const assigned = await session.assignRole({ uid: 'uid-guest', email: 'guest@hacienda.test' }, 'staff')

    expect(assigned.role).toBe('staff')
    expect(profiles.stored.get('uid-guest')?.role).toBe('staff')
  })

  it('is refused to Staff, who can neither change the team nor see it', async () => {
    const { session, profiles } = await signedInAs('staff')

    await expect(session.assignRole({ uid: 'uid-guest' }, 'host')).rejects.toMatchObject({ code: 'hdl/forbidden' })
    await expect(session.team()).rejects.toMatchObject({ code: 'hdl/forbidden' })
    expect(profiles.stored.get('uid-guest')?.role).toBe('guest')
  })

  it('is refused to a Guest, and to anybody signed out', async () => {
    const { session } = await signedInAs('guest')
    await expect(session.assignRole({ uid: 'uid-staff' }, 'guest')).rejects.toMatchObject({ code: 'hdl/forbidden' })

    const signedOut = startSession().session
    await expect(signedOut.assignRole({ uid: 'uid-staff' }, 'host')).rejects.toMatchObject({ code: 'hdl/forbidden' })
    await expect(signedOut.team()).rejects.toMatchObject({ code: 'hdl/forbidden' })
  })

  it('will not let the Host lock themselves out', async () => {
    const { session } = await signedInAs('host')

    await expect(session.assignRole({ uid: 'uid-host' }, 'guest')).rejects.toMatchObject({ code: 'hdl/forbidden' })
    expect(session.getState().role).toBe('host')
  })

  it('refuses a role that is not one of the three', async () => {
    const { session, profiles } = await signedInAs('host')

    await expect(session.assignRole({ uid: 'uid-guest' }, 'superuser' as Role)).rejects.toBeInstanceOf(AuthError)
    expect(profiles.stored.get('uid-guest')?.role).toBe('guest')
  })

  it('lists the team for the Host alone', async () => {
    const { session } = await signedInAs('host')

    const team = await session.team()
    expect(team.map((profile) => profile.role).sort()).toEqual(['guest', 'host', 'staff'])
  })

  it('picks up a role another Host gave you', async () => {
    const provider = createFakeProvider()
    const profiles = createFakeProfiles([{ uid: 'uid-ben', role: 'guest', email: 'ben@hacienda.test' }])
    provider.seed({ user: user('uid-ben', 'ben@hacienda.test'), password: REGISTERED_WITH })
    const session = createSession(provider.port, profiles.port)
    await session.login('ben@hacienda.test', 'bahay-kubo')
    expect(session.getState().role).toBe('guest')

    // Somebody else's session promotes this person; they re-read their Profile.
    profiles.stored.set('uid-ben', { uid: 'uid-ben', role: 'staff', email: 'ben@hacienda.test' })
    await session.refresh()

    expect(session.getState().role).toBe('staff')
    expect(session.can('stays:complete')).toBe(true)
    expect(session.can('bookings:review')).toBe(false)
  })
})

describe('a session with no Firebase behind it', () => {
  it('can still step into a role, because there is no Host to grant one', async () => {
    const { session } = startSession(createFakeProvider(), createFakeProfiles([{ uid: 'demo-staff', role: 'staff' }]))

    await session.signInAsRole('staff')

    expect(session.getState().role).toBe('staff')
    expect(session.can('bookings:read:all')).toBe(true)
  })

  it('refuses Google sign-in and demo sign-in where they do not exist', async () => {
    const cloud = startSession(createFakeProvider({ isCloud: true, google: false }))

    await expect(cloud.session.loginWithGoogle()).rejects.toMatchObject({ code: 'hdl/unavailable' })
    await expect(cloud.session.signInAsRole('host')).rejects.toMatchObject({ code: 'hdl/unavailable' })
  })

  it('signs in with Google where the project supports it', async () => {
    const { session } = startSession(createFakeProvider({ isCloud: true, google: true }))

    await session.loginWithGoogle()

    expect(session.getState()).toMatchObject({ status: 'signed-in', user: { email: 'ana@gmail.com' } })
  })
})
