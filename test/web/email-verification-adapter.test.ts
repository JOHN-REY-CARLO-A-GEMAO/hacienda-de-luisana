// The real adapter through Firebase SDK doubles. No project or email service is contacted.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({
  auth: { currentUser: null as null | {
    uid: string; email: string | null; displayName: string | null; isAnonymous: boolean;
    emailVerified: boolean; providerData: { providerId: string }[]; getIdToken: ReturnType<typeof vi.fn>;
  } },
  create: vi.fn(), update: vi.fn(), send: vi.fn(), reload: vi.fn(),
}))
vi.mock('../../src/lib/firebase', () => ({ auth: sdk.auth, db: {}, googleProvider: null, isFirebaseConfigured: true }))
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), getDoc: vi.fn(), setDoc: vi.fn() }))
vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: sdk.create,
  updateProfile: sdk.update,
  sendEmailVerification: sdk.send,
  reload: sdk.reload,
  browserLocalPersistence: {}, setPersistence: vi.fn(async () => {}),
  onAuthStateChanged: vi.fn(() => () => {}),
  signInWithEmailAndPassword: vi.fn(), signInWithPopup: vi.fn(), signOut: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}))
import { createFirebasePorts } from '../../src/lib/authFirebase'

function firebaseUser(overrides: Partial<NonNullable<typeof sdk.auth.currentUser>> = {}) {
  return {
    uid: 'firebase-guest', email: 'guest@example.com', displayName: null, isAnonymous: false,
    emailVerified: false, providerData: [{ providerId: 'password' }], getIdToken: vi.fn(async () => 'token'),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  sdk.auth.currentUser = null
  sdk.send.mockResolvedValue(undefined)
  sdk.update.mockResolvedValue(undefined)
  sdk.reload.mockResolvedValue(undefined)
})

describe('Firebase verification adapter', () => {
  it('exposes the Firebase flag and sends the configured template to the new password account', async () => {
    const account = firebaseUser()
    sdk.create.mockImplementation(async () => { sdk.auth.currentUser = account; return { user: account } })
    const ports = createFirebasePorts()!
    const user = await ports.auth.register({
      email: 'guest@example.com', password: 'secret1', termsVersion: 'test', termsAcceptedAt: '2026-01-01',
    })
    expect(user).toMatchObject({ uid: account.uid, emailVerified: false, provider: 'password' })
    await ports.auth.sendVerificationEmail(user.uid, user.email!)
    expect(sdk.send).toHaveBeenCalledOnce()
    expect(sdk.send).toHaveBeenCalledWith(account)
  })

  it('refuses stale, anonymous, Google and already-verified identities without sending', async () => {
    const ports = createFirebasePorts()!
    sdk.auth.currentUser = firebaseUser()
    await expect(ports.auth.sendVerificationEmail('old-uid', 'guest@example.com')).rejects.toMatchObject({ code: 'hdl/unavailable' })
    await expect(ports.auth.sendVerificationEmail('firebase-guest', 'old@example.com')).rejects.toMatchObject({ code: 'hdl/unavailable' })
    sdk.auth.currentUser = firebaseUser({ isAnonymous: true })
    await expect(ports.auth.sendVerificationEmail('firebase-guest', 'guest@example.com')).rejects.toMatchObject({ code: 'hdl/unavailable' })
    sdk.auth.currentUser = firebaseUser({ providerData: [{ providerId: 'google.com' }] })
    await expect(ports.auth.sendVerificationEmail('firebase-guest', 'guest@example.com')).rejects.toMatchObject({ code: 'hdl/unavailable' })
    sdk.auth.currentUser = firebaseUser({ emailVerified: true })
    await expect(ports.auth.sendVerificationEmail('firebase-guest', 'guest@example.com')).rejects.toMatchObject({ code: 'hdl/unavailable' })
    expect(sdk.send).not.toHaveBeenCalled()
  })

  it('reloads Firebase and refreshes the token only after the email is verified', async () => {
    const account = firebaseUser()
    sdk.auth.currentUser = account
    const ports = createFirebasePorts()!
    const first = await ports.auth.reloadVerification(account.uid)
    expect(first.emailVerified).toBe(false)
    expect(account.getIdToken).not.toHaveBeenCalled()
    sdk.reload.mockImplementationOnce(async () => { account.emailVerified = true })
    const verified = await ports.auth.reloadVerification(account.uid)
    expect(verified.emailVerified).toBe(true)
    expect(account.getIdToken).toHaveBeenCalledWith(true)
  })

  it.each(['other-guest', 'firebase-guest'])('refuses a reload after the Firebase user changes, even to %s', async (nextUid) => {
    const account = firebaseUser()
    sdk.auth.currentUser = account
    sdk.reload.mockImplementationOnce(async () => {
      account.emailVerified = true
      sdk.auth.currentUser = firebaseUser({ uid: nextUid })
    })
    await expect(createFirebasePorts()!.auth.reloadVerification(account.uid)).rejects.toMatchObject({ code: 'auth/user-token-expired' })
    expect(account.getIdToken).not.toHaveBeenCalled()
  })
})
