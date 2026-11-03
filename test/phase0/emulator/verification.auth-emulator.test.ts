// Full session -> real Firebase adapter -> real Firebase Auth emulator.
// Only the Profile port is in-memory. The emulator records codes locally;
// it never sends a real email or contacts a live Firebase project.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app'
import {
  applyActionCode, connectAuthEmulator, EmailAuthProvider, getAuth, linkWithCredential,
  signInAnonymously, signOut, type Auth,
} from 'firebase/auth'
import { assertEmulatorEnvironment } from '../../../scripts/phase0/boundary.mjs'
import { createSession, type ProfilePort, type SessionStore } from '../../../src/lib/auth'

const mockedFirebase = vi.hoisted(() => ({ auth: null as Auth | null }))
vi.mock('../../../src/lib/firebase', () => ({
  get auth() { return mockedFirebase.auth }, db: {}, isFirebaseConfigured: true, googleProvider: null,
}))
import { createFirebasePorts } from '../../../src/lib/authFirebase'

const PROJECT = 'demo-hacienda'
const ORIGIN = 'http://127.0.0.1:9099'
let app: FirebaseApp
let auth: Auth
let session: SessionStore

beforeAll(() => {
  assertEmulatorEnvironment()
  app = initializeApp({ apiKey: 'phase0-fake-api-key', projectId: PROJECT, authDomain: `${PROJECT}.firebaseapp.com` }, 'verification-adapter')
  auth = getAuth(app)
  connectAuthEmulator(auth, ORIGIN, { disableWarnings: true })
  mockedFirebase.auth = auth
})
beforeEach(async () => {
  await signOut(auth)
  const response = await fetch(`${ORIGIN}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })
  expect(response.ok).toBe(true)
  const ports = createFirebasePorts()
  if (!ports) throw new Error('The local emulator adapter was not created')
  const profiles: ProfilePort = { read: async () => null, create: async (profile) => profile }
  session = createSession(ports.auth, profiles)
})
afterEach(() => session.destroy())
afterAll(async () => { mockedFirebase.auth = null; await deleteApp(app) })

describe('automatic verification through the actual Firebase adapter', () => {
  it('requests the action code on signup and reloads a verified claim without changing UID', async () => {
    const email = 'adapter-verify@phase0.example.invalid'
    const account = await session.register({ email, password: 'phase0-password', birthdate: '1990-01-01', acceptedTerms: true })
    await vi.waitFor(() => expect(session.getState().verificationEmail).toMatchObject({ uid: account.uid, status: 'sent' }))
    expect(session.getState().user?.emailVerified).toBe(false)
    const response = await fetch(`${ORIGIN}/emulator/v1/projects/${PROJECT}/oobCodes`)
    const data: { oobCodes: { email: string; oobCode: string; requestType: string }[] } = await response.json()
    const action = data.oobCodes.find((entry) => entry.email === email && entry.requestType === 'VERIFY_EMAIL')
    expect(action).toBeDefined()
    await applyActionCode(auth, action!.oobCode)
    expect(await session.checkEmailVerification()).toBe(true)
    expect(session.getState().user).toMatchObject({ uid: account.uid, emailVerified: true })
    const payload = JSON.parse(Buffer.from((await auth.currentUser!.getIdToken()).split('.')[1], 'base64url').toString('utf8'))
    expect(payload.email_verified).toBe(true)
  })

  it('can request and verify an email linked to the same anonymous booking identity', async () => {
    const anonymous = (await signInAnonymously(auth)).user
    await vi.waitFor(() => expect(session.getState().user?.uid).toBe(anonymous.uid))
    const email = 'linked-adapter@phase0.example.invalid'
    const linked = (await linkWithCredential(anonymous, EmailAuthProvider.credential(email, 'phase0-password'))).user
    await linked.getIdToken(true)
    await session.refresh()
    expect(session.getState().user).toMatchObject({ uid: anonymous.uid, email, provider: 'password', emailVerified: false })
    await session.sendVerificationEmail()
    expect(session.getState().verificationEmail).toMatchObject({ uid: anonymous.uid, status: 'sent' })
    const response = await fetch(`${ORIGIN}/emulator/v1/projects/${PROJECT}/oobCodes`)
    const data: { oobCodes: { email: string; oobCode: string; requestType: string }[] } = await response.json()
    const action = data.oobCodes.find((entry) => entry.email === email && entry.requestType === 'VERIFY_EMAIL')
    expect(action).toBeDefined()
    await applyActionCode(auth, action!.oobCode)
    expect(await session.checkEmailVerification()).toBe(true)
    expect(session.getState().user).toMatchObject({ uid: anonymous.uid, emailVerified: true })
  })
})
