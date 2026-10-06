// Actual application SDK sequences on owned Auth+Firestore emulators. No
// real-provider sign-in, allowlisted-email registration, guest recovery design,
// deployed index readiness or native device assertion.
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, signInAnonymously, EmailAuthProvider, linkWithCredential, type Auth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore, doc, setDoc, getDoc, type Firestore } from 'firebase/firestore'
import { assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { environment, reset, seed, canonicalPaid, canonicalBooking, denied } from './helpers'
import { scenarios } from '../fixtures'
let env: RulesTestEnvironment
let app: FirebaseApp
let auth: Auth
let db: Firestore
let serial = 0
beforeAll(async () => { env = await environment() })
beforeEach(async () => {
  await reset(env)
  // New memory-persistence app per case; emulator-only key/ID, not a secret.
  app = initializeApp({ projectId: 'demo-hacienda', apiKey: 'phase0-emulator-only-key', appId: 'phase0-synthetic-app' }, `phase0-auth-review-${serial++}`)
  auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  db = getFirestore(app); connectFirestoreEmulator(db, '127.0.0.1', 8080)
})
afterAll(async () => { await env?.cleanup() })
// Apps are deleted per test inside finally, including failed assertions.

it('F16-CANONICAL-CONTROL: actual anonymous session creates/reads its own booking', async () => {
  try {
    const user = (await signInAnonymously(auth)).user
    await assertSucceeds(setDoc(doc(db, 'bookings', scenarios.booking.id), canonicalBooking({ uid: user.uid })))
    await assertSucceeds(getDoc(doc(db, 'bookings', scenarios.booking.id)))
  } finally { await deleteApp(app) }
})
it('F16-CANONICAL-CURRENT: actual register adapter replaces anonymous UID and loses old booking read', async () => {
  try {
    const anonymous = (await signInAnonymously(auth)).user
    await setDoc(doc(db, 'bookings', scenarios.booking.id), canonicalBooking({ uid: anonymous.uid }))
    vi.resetModules()
    vi.doMock('../../../src/lib/firebase', () => ({ auth, db, googleProvider: null, isFirebaseConfigured: true }))
    const ports = (await import('../../../src/lib/authFirebase')).createFirebasePorts()
    if (!ports) throw new Error('actual emulator Auth ports unavailable')
    const user = await ports.auth.register({ email: `registered-${serial}@phase0.example.invalid`, password: 'synthetic-emulator-only-password', displayName: 'Synthetic Guest A' })
    expect(user.uid).not.toBe(anonymous.uid)
    await denied(() => getDoc(doc(db, 'bookings', scenarios.booking.id)))
  } finally { await deleteApp(app) }
})
it('F16-CANONICAL-POSITIVE-CONTROL: SDK credential linking preserves UID/ownership (not implemented in application)', async () => {
  try {
    const anonymous = (await signInAnonymously(auth)).user
    await setDoc(doc(db, 'bookings', scenarios.booking.id), canonicalBooking({ uid: anonymous.uid }))
    const linked = await linkWithCredential(anonymous, EmailAuthProvider.credential(`linked-${serial}@phase0.example.invalid`, 'synthetic-emulator-only-password'))
    expect(linked.user.uid).toBe(anonymous.uid)
    await assertSucceeds(getDoc(doc(db, 'bookings', scenarios.booking.id)))
  } finally { await deleteApp(app) }
})
it('F25-CANONICAL-FIXED: the real first submit now saves end to end, and only the second one is refused', async () => {
  // The application reads before it writes, so the first review of a stay arrived
  // at an id with no document behind it; the read rule compared a uid against a
  // `resource` that was not there, refused, and the Guest was told Firestore had
  // refused a write that had never been attempted. The read is now open to the
  // owner of the Booking the id names, so the whole sequence lands.
  try {
    const user = (await signInAnonymously(auth)).user
    await seed(env, owner => setDoc(doc(owner.firestore(), 'bookings', scenarios.booking.id), canonicalPaid({ uid: user.uid, status: 'Completed' })))
    vi.resetModules()
    vi.doMock('../../../src/lib/firebase', () => ({ auth, db, isFirebaseConfigured: true }))
    const reviews = await import('../../../src/lib/reviewsCloud')
    const submitted = await reviews.submitReview({ bookingId: scenarios.booking.id, uid: user.uid, bookingStatus: 'Completed', stars: 5, text: 'Synthetic review only' })
    expect(submitted.ok).toBe(true)
    const stored = await assertSucceeds(getDoc(doc(db, 'reviews', scenarios.booking.id)))
    expect(stored.exists()).toBe(true)
    // And what that read is for: the second review of one stay, refused.
    await denied(() => reviews.submitReview({ bookingId: scenarios.booking.id, uid: user.uid, bookingStatus: 'Completed', stars: 4, text: 'Synthetic review only' }))
  } finally { await deleteApp(app) }
})
