// Canonical Firebase Auth EMULATOR checks (firebase-tools' own Auth emulator,
// real Firebase JS SDK). Runs via `npm run test:emulator:auth` inside the
// loopback-only namespace. It needs no Java and no downloaded JAR, so it is the
// one part of the Emulator Suite that can execute when the Firestore/RTDB/
// Storage emulator artefacts are unavailable.
//
// Scope, stated honestly:
//  * These tests exercise the SAME SDK calls the website makes
//    (src/lib/guestAuth.ts:50 signInAnonymously, src/lib/authFirebase.ts:120
//    createUserWithEmailAndPassword, :132 signInWithEmailAndPassword) against a
//    real Auth implementation. They do NOT import src/lib/firebase.ts, which only
//    initialises when a Firebase web config is present — Phase 0 refuses to
//    provide one.
//  * They establish platform semantics (what an anonymous session becomes after
//    register/login; what an ID token can claim). Whether production Auth has
//    the same sign-up settings (e.g. email/password sign-up enabled, email
//    enumeration protection) is deployed state: REQUIRES RUNTIME VERIFICATION.
//  * No real address is registered, even locally (fixture note for
//    `unverifiedAllowlisted`). Rules evaluation of an unverified allowlisted
//    token needs the Firestore emulator (BLOCKED here).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app'
import {
  connectAuthEmulator, createUserWithEmailAndPassword, EmailAuthProvider, getAuth, linkWithCredential,
  signInAnonymously, signInWithEmailAndPassword, signOut, type Auth,
} from 'firebase/auth'
import { assertEmulatorEnvironment } from '../../../scripts/phase0/boundary.mjs'

const PROJECT = 'demo-hacienda'
const ORIGIN = 'http://127.0.0.1:9099'
const PASSWORD = 'phase0-synthetic-password'
let app: FirebaseApp
let auth: Auth

function claims(token: string) {
  const [header, payload] = token.split('.').slice(0, 2).map(part => JSON.parse(Buffer.from(part, 'base64url').toString('utf8')))
  return { header, payload }
}
async function emulatorAccounts(): Promise<Array<{ localId: string; email?: string }>> {
  const response = await fetch(`${ORIGIN}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:query`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: '{}',
  })
  expect(response.ok).toBe(true)
  return (await response.json()).userInfo ?? []
}

beforeAll(() => {
  assertEmulatorEnvironment()
  app = initializeApp({ apiKey: 'phase0-fake-api-key', projectId: PROJECT, authDomain: `${PROJECT}.firebaseapp.com` }, 'phase0-auth')
  auth = getAuth(app)
  connectAuthEmulator(auth, ORIGIN, { disableWarnings: true })
})
beforeEach(async () => {
  await signOut(auth)
  const response = await fetch(`${ORIGIN}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })
  expect(response.ok).toBe(true)
})
afterAll(async () => { await deleteApp(app) })

describe('Auth emulator availability (TEST boundary)', () => {
  it('is the owned loopback emulator bound to the demo project', async () => {
    const response = await fetch(`${ORIGIN}/emulator/v1/projects/${PROJECT}/config`)
    expect(response.ok).toBe(true)
    expect(process.env.FIREBASE_AUTH_EMULATOR_HOST).toBe('127.0.0.1:9099')
  })
  it('issues anonymous sessions as unsigned emulator tokens for demo-hacienda only', async () => {
    const credential = await signInAnonymously(auth)
    const { header, payload } = claims(await credential.user.getIdToken())
    expect(header.alg).toBe('none') // emulator token: never accepted by production
    expect(payload.aud).toBe(PROJECT)
    expect(payload.firebase.sign_in_provider).toBe('anonymous')
  })
})

describe('F16 canonical platform semantics: anonymous continuity', () => {
  it('createUserWithEmailAndPassword from an anonymous session yields a DIFFERENT uid and orphans the anonymous one', async () => {
    const anonymousUid = (await signInAnonymously(auth)).user.uid
    const registered = await createUserWithEmailAndPassword(auth, 'guest-register@phase0.example.invalid', PASSWORD)
    expect(registered.user.uid).not.toBe(anonymousUid)
    expect(auth.currentUser?.uid).toBe(registered.user.uid)
    const ids = (await emulatorAccounts()).map(account => account.localId)
    expect(ids).toContain(anonymousUid) // still exists, no longer reachable from this browser session
  })
  it('signInWithEmailAndPassword from an anonymous session also replaces the uid', async () => {
    await createUserWithEmailAndPassword(auth, 'guest-login@phase0.example.invalid', PASSWORD)
    await signOut(auth)
    const anonymousUid = (await signInAnonymously(auth)).user.uid
    const signedIn = await signInWithEmailAndPassword(auth, 'guest-login@phase0.example.invalid', PASSWORD)
    expect(signedIn.user.uid).not.toBe(anonymousUid)
  })
  it('CONTROL (not a fix): the platform offers a uid-preserving link that the website does not call', async () => {
    const anonymousUid = (await signInAnonymously(auth)).user.uid
    const linked = await linkWithCredential(auth.currentUser!, EmailAuthProvider.credential('guest-link@phase0.example.invalid', PASSWORD))
    expect(linked.user.uid).toBe(anonymousUid)
  })
})

describe('F04 canonical precondition: self-asserted email claims', () => {
  it('a self-registered password account receives a token whose email claim is chosen by the registrant and email_verified=false', async () => {
    const chosen = 'self-asserted@phase0.example.invalid'
    const credential = await createUserWithEmailAndPassword(auth, chosen, PASSWORD)
    const { payload } = claims(await credential.user.getIdToken())
    expect(payload.email).toBe(chosen)
    expect(payload.email_verified).toBe(false)
    expect(payload.firebase.sign_in_provider).toBe('password')
  })
})
