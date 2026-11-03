import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSession, type AuthPort, type ProfilePort, type SessionUser, type SessionStore } from '../../src/lib/auth'
import { resetRateLimit } from '../../src/lib/rateLimit'

const signup = { email: 'guest@example.com', password: 'secret1', birthdate: '1990-03-10', acceptedTerms: true }
const guest = (uid = 'guest-one', email = 'guest@example.com'): SessionUser => ({
  uid, email, displayName: 'Guest', isAnonymous: false, provider: 'password', emailVerified: false,
})

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const sessions: SessionStore[] = []
function harness(isCloud = true) {
  let current: SessionUser | null = null
  let listener: (user: SessionUser | null) => void = () => {}
  const send = vi.fn<(uid: string, email: string) => Promise<void>>().mockResolvedValue(undefined)
  const reload = vi.fn<(uid: string) => Promise<SessionUser>>().mockImplementation(async (uid) => {
    if (!current || current.uid !== uid) throw new Error('wrong identity')
    return current
  })
  const emit = (user: SessionUser | null) => { current = user; listener(user) }
  const auth: AuthPort = {
    isCloud,
    supportsGoogle: isCloud,
    subscribe(callback) { listener = callback; callback(current); return () => { listener = () => {} } },
    current: () => current,
    async register(input) {
      const next = isCloud
        ? guest('new-guest', input.email)
        : { ...guest('demo-guest', input.email), provider: 'local' as const, emailVerified: null }
      emit(next) // Firebase emits before registration's other work has completed.
      return next
    },
    async login() { const next = guest(); emit(next); return next },
    async loginWithGoogle() {
      const next = { ...guest('google-guest'), provider: 'google' as const, emailVerified: true }
      emit(next)
      return next
    },
    async logout() { emit(null) },
    async resetPassword() {},
    sendVerificationEmail: send,
    reloadVerification: reload,
  }
  const profiles: ProfilePort = {
    read: vi.fn(async () => null),
    create: vi.fn(async (profile) => profile),
  }
  const session = createSession(auth, profiles)
  sessions.push(session)
  return { session, send, reload, profiles, emit }
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  resetRateLimit()
})
afterEach(() => { sessions.splice(0).forEach((session) => session.destroy()) })

describe('verification email session', () => {
  it('starts a Firebase email request after account creation without waiting for delivery', async () => {
    const h = harness()
    const delivery = deferred<void>()
    h.send.mockReturnValueOnce(delivery.promise)

    const created = await h.session.register(signup)
    expect(created.uid).toBe('new-guest')
    expect(h.profiles.create).toHaveBeenCalledOnce()
    expect(h.session.getState().role).toBe('guest')
    expect(h.send).toHaveBeenCalledOnce()
    expect(h.send).toHaveBeenCalledWith('new-guest', 'guest@example.com')
    expect(h.session.getState().verificationEmail).toMatchObject({ uid: 'new-guest', status: 'sending' })
    expect(h.session.getState().isRegistering).toBe(false)

    delivery.resolve()
    await vi.waitFor(() => expect(h.session.getState().verificationEmail.status).toBe('sent'))
    // A successful request is not the same as the Guest having verified the email.
    expect(h.session.getState().user?.emailVerified).toBe(false)
  })

  it('keeps a created account signed in if the verification send fails', async () => {
    const h = harness()
    h.send.mockRejectedValueOnce({ code: 'auth/network-request-failed', message: 'private provider details' })
    await expect(h.session.register(signup)).resolves.toMatchObject({ uid: 'new-guest' })
    await vi.waitFor(() => expect(h.session.getState().verificationEmail.status).toBe('failed'))
    expect(h.session.getState()).toMatchObject({ status: 'signed-in', role: 'guest', user: { uid: 'new-guest' } })
    expect(h.session.getState().verificationEmail.message).toContain('internet connection')
    expect(h.session.getState().verificationEmail.message).not.toContain('private provider details')
  })

  it('never sends or claims email delivery in demo, Google, or anonymous sessions', async () => {
    const demo = harness(false)
    await demo.session.register(signup)
    expect(demo.send).not.toHaveBeenCalled()
    expect(demo.session.getState().user?.emailVerified).toBeNull()
    await expect(demo.session.sendVerificationEmail()).rejects.toMatchObject({ code: 'hdl/unavailable' })

    const cloud = harness()
    await cloud.session.loginWithGoogle()
    await expect(cloud.session.sendVerificationEmail()).rejects.toMatchObject({ code: 'hdl/unavailable' })
    cloud.emit({ ...guest('anonymous'), email: null, isAnonymous: true, provider: 'anonymous' })
    await expect(cloud.session.checkEmailVerification()).rejects.toMatchObject({ code: 'hdl/unavailable' })
    expect(cloud.send).not.toHaveBeenCalled()
  })

  it('deduplicates simultaneous resend requests and applies the client cooldown', async () => {
    const h = harness()
    h.emit(guest())
    const delivery = deferred<void>()
    h.send.mockReturnValueOnce(delivery.promise)
    const first = h.session.sendVerificationEmail()
    const sameRequest = h.session.sendVerificationEmail()
    await vi.waitFor(() => expect(h.send).toHaveBeenCalledOnce())
    delivery.resolve()
    await Promise.all([first, sameRequest])
    await h.session.sendVerificationEmail()
    await h.session.sendVerificationEmail()
    await expect(h.session.sendVerificationEmail()).rejects.toMatchObject({ code: 'auth/too-many-requests' })
    expect(h.send).toHaveBeenCalledTimes(3)
    expect(h.session.getState().verificationEmail).toMatchObject({ status: 'failed', uid: 'guest-one' })
  })

  it.each(['sent', 'failed'] as const)('does not publish a late %s result to another identity', async (result) => {
    const h = harness()
    const delivery = deferred<void>()
    h.send.mockReturnValueOnce(delivery.promise)
    h.emit(guest('first', 'first@example.com'))
    const request = h.session.sendVerificationEmail().catch(() => {})
    await vi.waitFor(() => expect(h.send).toHaveBeenCalledOnce())
    h.emit(guest('second', 'second@example.com'))
    if (result === 'sent') delivery.resolve()
    else delivery.reject({ code: 'auth/network-request-failed' })
    await request
    expect(h.session.getState().user?.uid).toBe('second')
    expect(h.session.getState().verificationEmail).toEqual({ uid: null, email: null, status: 'idle', message: null })
    await h.session.sendVerificationEmail()
    expect(h.send).toHaveBeenLastCalledWith('second', 'second@example.com')
    expect(h.session.getState().verificationEmail).toMatchObject({ uid: 'second', status: 'sent' })
  })

  it('allows a new request after signing out and back in while an old request is pending', async () => {
    const h = harness()
    const oldDelivery = deferred<void>()
    h.send.mockReturnValueOnce(oldDelivery.promise)
    h.emit(guest())
    const oldRequest = h.session.sendVerificationEmail()
    await vi.waitFor(() => expect(h.send).toHaveBeenCalledOnce())
    h.emit(null)
    h.emit(guest())
    await h.session.sendVerificationEmail()
    expect(h.send).toHaveBeenCalledTimes(2)
    expect(h.session.getState().verificationEmail.status).toBe('sent')
    oldDelivery.resolve()
    await oldRequest
    expect(h.session.getState().verificationEmail.status).toBe('sent')
  })

  it('refreshes verified state after a link is followed, without changing Guest access', async () => {
    const h = harness()
    h.emit(guest())
    h.reload.mockResolvedValueOnce({ ...guest(), emailVerified: true })
    await expect(h.session.checkEmailVerification()).resolves.toBe(true)
    expect(h.reload).toHaveBeenCalledWith('guest-one')
    expect(h.session.getState().user?.emailVerified).toBe(true)
    await vi.waitFor(() => expect(h.session.getState().role).toBe('guest'))
  })

  it('does not lose a verified flag when an older Profile read finishes later', async () => {
    const h = harness()
    const profile = deferred<null>()
    vi.mocked(h.profiles.read).mockReturnValueOnce(profile.promise)
    h.emit(guest())
    h.reload.mockResolvedValueOnce({ ...guest(), emailVerified: true })
    await expect(h.session.checkEmailVerification()).resolves.toBe(true)
    profile.resolve(null)
    await vi.waitFor(() => expect(h.session.getState().status).toBe('signed-in'))
    expect(h.session.getState().user?.emailVerified).toBe(true)
  })

  it('does not restore a new account over another Guest if registration finishes late', async () => {
    const h = harness()
    const profileWrite = deferred<void>()
    vi.mocked(h.profiles.create).mockImplementationOnce(async (profile) => {
      await profileWrite.promise
      return profile
    })
    const registration = h.session.register(signup)
    await vi.waitFor(() => expect(h.profiles.create).toHaveBeenCalledOnce())
    h.emit(guest('second', 'second@example.com'))
    expect(h.session.getState().isRegistering).toBe(false)
    await h.session.sendVerificationEmail()
    expect(h.send).toHaveBeenLastCalledWith('second', 'second@example.com')
    profileWrite.resolve()
    await registration
    await vi.waitFor(() => expect(h.session.getState().status).toBe('signed-in'))
    expect(h.session.getState().user?.uid).toBe('second')
    expect(h.session.getState().verificationEmail).toMatchObject({ uid: 'second', status: 'sent' })
  })

  it('never restores a previous identity when a verification check finishes late', async () => {
    const h = harness()
    h.emit(guest('first', 'first@example.com'))
    const check = deferred<SessionUser>()
    h.reload.mockReturnValueOnce(check.promise)
    const pending = h.session.checkEmailVerification()
    h.emit(guest('second', 'second@example.com'))
    check.resolve({ ...guest('first', 'first@example.com'), emailVerified: true })
    await expect(pending).rejects.toMatchObject({ code: 'auth/user-token-expired' })
    expect(h.session.getState().user?.uid).toBe('second')
    expect(h.session.getState().user?.emailVerified).toBe(false)
  })

  it('rejects a verification result from a prior sign-in of the same UID', async () => {
    const h = harness()
    h.emit(guest())
    const check = deferred<SessionUser>()
    h.reload.mockReturnValueOnce(check.promise)
    const pending = h.session.checkEmailVerification()
    h.emit(null)
    h.emit(guest())
    check.resolve({ ...guest(), emailVerified: true })
    await expect(pending).rejects.toMatchObject({ code: 'auth/user-token-expired' })
    expect(h.session.getState().user?.emailVerified).toBe(false)
  })
})
