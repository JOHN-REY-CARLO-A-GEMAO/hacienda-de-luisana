// Authentication without Firebase — the local demo adapter.
//
// When the project has no Firebase keys there is still a website to click
// through, so accounts, passwords and Profiles live in the browser instead. It
// is the same seam as Firebase (`AuthPort` + `ProfilePort`), which is what makes
// the session above it worth testing once: everything a Guest does in demo mode
// is what they would do against the cloud, minus the cloud.
//
// The password rules are not relaxed for demo mode: nothing plaintext is ever
// written down, and a wrong password is a wrong password.
import { AuthError, createSession } from '../../src/lib/auth'
import { createLocalPorts, LOCAL_ACCOUNTS_KEY, LOCAL_PROFILES_KEY, LOCAL_SESSION_KEY } from '../../src/lib/authLocal'

// Credentials invented for this file and used nowhere else: the one every
// fixture account is registered with, one two accounts share (so their salts can
// be compared), and one that arrives with an address somebody already took.
const REGISTERED_WITH = 'bahay-kubo-9'
const SHARED_BY_TWO = 'parehas-lang'
const ARRIVED_LATE = 'ibang-password'

type StoredAccount = {
  uid: string
  email: string
  display_name: string | null
  password: { algorithm: string; iterations: number; salt: string; hash: string }
  created_at: string
}

const accountsIn = (): StoredAccount[] => JSON.parse(localStorage.getItem(LOCAL_ACCOUNTS_KEY) ?? '[]')
const profilesIn = (): Array<{ uid: string; role: string }> =>
  JSON.parse(localStorage.getItem(LOCAL_PROFILES_KEY) ?? '[]')
const sessionIn = (): { uid: string } | null => JSON.parse(localStorage.getItem(LOCAL_SESSION_KEY) ?? 'null')

function startLocalSession() {
  const ports = createLocalPorts()
  return { session: createSession(ports.auth, ports.profiles), ports }
}

beforeEach(() => {
  localStorage.clear()
})

describe('a local account', () => {
  it('is written down without the password anybody typed', async () => {
    const { session } = startLocalSession()

    await session.register({ email: 'maria@example.com', password: REGISTERED_WITH })

    const [account] = accountsIn()
    expect(account.email).toBe('maria@example.com')
    expect(JSON.stringify(account)).not.toContain('bahay-kubo-9')
    // Stretched, salted, and labelled with what it is so a future reader can
    // re-derive it rather than guess.
    expect(account.password).toMatchObject({ algorithm: 'pbkdf2-sha256', iterations: 210000 })
    expect(account.password.salt.length).toBeGreaterThan(10)
    expect(account.password.hash).not.toBe(account.password.salt)
  })

  it('salts two accounts that chose the same password differently', async () => {
    const { session } = startLocalSession()
    await session.register({ email: 'one@example.com', password: SHARED_BY_TWO })
    await session.logout()
    await session.register({ email: 'two@example.com', password: SHARED_BY_TWO })

    const [first, second] = accountsIn()
    expect(first.password.salt).not.toBe(second.password.salt)
    expect(first.password.hash).not.toBe(second.password.hash)
  })

  it('comes back signed in after the page is reloaded', async () => {
    const first = startLocalSession()
    await first.session.register({ email: 'maria@example.com', password: REGISTERED_WITH })
    expect(sessionIn()?.uid).toBeTruthy()

    // A reload: new ports, same browser storage, nobody signing in again.
    const reloaded = startLocalSession()
    await reloaded.session.refresh()

    expect(reloaded.session.getState()).toMatchObject({
      status: 'signed-in',
      role: 'guest',
      user: { email: 'maria@example.com' },
    })
  })

  it('refuses a second account on the same address', async () => {
    const { session } = startLocalSession()
    await session.register({ email: 'twice@example.com', password: REGISTERED_WITH })

    await expect(session.register({ email: 'TWICE@example.com ', password: ARRIVED_LATE })).rejects.toMatchObject({
      code: 'auth/email-already-in-use',
    })
    expect(accountsIn()).toHaveLength(1)
  })

  it('refuses a wrong password, and says nothing about which half was wrong', async () => {
    const { session } = startLocalSession()
    await session.register({ email: 'maria@example.com', password: REGISTERED_WITH })
    await session.logout()

    await expect(session.login('maria@example.com', 'hindi-ito-ang-password')).rejects.toMatchObject({
      code: 'auth/invalid-credential',
      message: 'Invalid email or password. Please try again.',
    })
    expect(session.getState().status).toBe('signed-out')
  })

  it('refuses an address nobody registered, in the same words as a wrong password', async () => {
    const { session } = startLocalSession()
    await session.register({ email: 'maria@example.com', password: REGISTERED_WITH })
    await session.logout()

    // Which half was wrong is nobody's business: telling them the account does
    // not exist would hand out a list of who stays here.
    await expect(session.login('wala@example.com', 'bahay-kubo-9')).rejects.toMatchObject({
      code: 'auth/invalid-credential',
      message: 'Invalid email or password. Please try again.',
    })
  })

  it('accepts the right password again, however often it is asked', async () => {
    const { session } = startLocalSession()
    await session.register({ email: 'maria@example.com', password: REGISTERED_WITH })
    await session.logout()

    await session.login('maria@example.com', 'bahay-kubo-9')
    expect(session.getState().role).toBe('guest')
    await session.logout()
    await session.login(' MARIA@example.com', 'bahay-kubo-9')
    expect(session.getState().status).toBe('signed-in')
  })

  it('ends the session on disk when the person signs out', async () => {
    const { session } = startLocalSession()
    await session.register({ email: 'maria@example.com', password: REGISTERED_WITH })

    await session.logout()

    expect(sessionIn()).toBeNull()
    const reloaded = startLocalSession()
    await reloaded.session.refresh()
    expect(reloaded.session.getState().status).toBe('signed-out')
    // The account outlives the session: signing out is not deleting anybody.
    expect(accountsIn()).toHaveLength(1)
  })

  it('keeps the account it has when a session it never issued turns up', async () => {
    localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify({ uid: 'uid-na-wala' }))
    const { session } = startLocalSession()

    await session.refresh()

    expect(session.getState().status).toBe('signed-out')
    expect(localStorage.getItem(LOCAL_SESSION_KEY)).toBeNull()
  })
})

describe('local Profiles', () => {
  it('store the role a sign-up was given, and read it back', async () => {
    const { session } = startLocalSession()
    await session.register({ email: 'maria@example.com', password: REGISTERED_WITH, displayName: 'Maria Santos' })

    expect(profilesIn()).toEqual([
      expect.objectContaining({ role: 'guest', email: 'maria@example.com', display_name: 'Maria Santos' }),
    ])
  })

  it('let the Host make somebody Staff, and the change outlives a reload', async () => {
    const { session } = startLocalSession()
    await session.register({ email: 'ben@example.com', password: REGISTERED_WITH, displayName: 'Ben Cariño' })
    const ben = session.getState().user!
    expect(session.getState().role).toBe('guest')

    // Demo mode has no Host account to sign in with, so the adapter makes one.
    await session.signInAsRole('host')
    const assigned = await session.assignRole(
      { uid: ben.uid, email: ben.email, displayName: ben.displayName },
      'staff',
    )

    expect(assigned.role).toBe('staff')
    expect(profilesIn().find((profile) => profile.uid === ben.uid)?.role).toBe('staff')

    const reloaded = startLocalSession()
    await reloaded.session.login('ben@example.com', 'bahay-kubo-9')
    expect(reloaded.session.getState().role).toBe('staff')
    expect(reloaded.session.can('stays:complete')).toBe(true)
    expect(reloaded.session.can('bookings:review')).toBe(false)
  })

  it('refuse a role change asked for by somebody who is not the Host', async () => {
    const { session } = startLocalSession()
    await session.register({ email: 'maria@example.com', password: REGISTERED_WITH })

    await expect(session.assignRole({ uid: 'whoever' }, 'host')).rejects.toBeInstanceOf(AuthError)
    expect(profilesIn().every((profile) => profile.role === 'guest')).toBe(true)
  })

  it('step into each of the three roles, because demo mode has no Host to ask', async () => {
    const { session } = startLocalSession()

    for (const role of ['host', 'staff', 'guest'] as const) {
      await session.signInAsRole(role)
      expect(session.getState().role).toBe(role)
      expect(sessionIn()?.uid).toBe(session.getState().user?.uid)
    }
    // One account per role, each with its Profile already written.
    expect(accountsIn()).toHaveLength(3)
    expect(profilesIn().map((profile) => profile.role).sort()).toEqual(['guest', 'host', 'staff'])
  })
})

describe('the local adapter’s own promises', () => {
  it('is not the cloud, and does not pretend to offer Google', () => {
    const { ports } = startLocalSession()
    expect(ports.auth.isCloud).toBe(false)
    expect(ports.auth.supportsGoogle).toBe(false)
  })

  it('refuses to reset a password there is no email service for', async () => {
    const { session } = startLocalSession()

    await expect(session.resetPassword('maria@example.com')).rejects.toMatchObject({ code: 'hdl/unavailable' })
  })
})
