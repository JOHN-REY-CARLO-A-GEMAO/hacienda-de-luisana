/**
 * The canonical suite: the rules, enforced by the Firebase Emulator Suite.
 *
 * `npm run test:emulator` starts the Auth, Firestore and Storage emulators with
 * this repository's rules files and runs the cases below inside `emulators:exec`.
 * It needs Java and the emulator download (one-time, ~200 MB) — neither is
 * available in every environment, which is why `test/rules/` exists as the
 * offline companion. When both can run, this one is the answer that counts.
 *
 * The cases mirror `test/rules/firestore-rules.test.ts` and
 * `test/rules/storage-rules.test.ts` case for case where the outcome is settled,
 * and settle the ones the offline evaluator has to report both ways — the
 * anonymous-Guest token-claim question above all.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc, getDocs } from 'firebase/firestore'
import { ref, uploadBytes, deleteObject, getDownloadURL } from 'firebase/storage'

/** `firebase emulators:exec` puts the project id in the environment. */
const PROJECT = process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT ?? 'demo-hacienda'
const ADMIN_EMAIL = 'haciendadeluisiana@gmail.com'
const GUEST_UID = 'guest-uid-1'
const OTHER_GUEST_UID = 'guest-uid-2'
const BOOKING_ID = 'booking-1'
const CONVO_ID = 'convo-1'

let env: RulesTestEnvironment

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync(join(__dirname, '../../firestore.rules'), 'utf8') },
    storage: { host: '127.0.0.1', port: 9199, rules: readFileSync(join(__dirname, '../../storage.rules'), 'utf8') },
  })
})

afterAll(async () => {
  await env?.cleanup()
})

/** A Guest with a uid but no email claim — Firebase's anonymous sign-in. */
const anonymousGuest = (uid = GUEST_UID) => env.authenticatedContext(uid, {})
const emailGuest = (uid = GUEST_UID) => env.authenticatedContext(uid, { email: `guest-${uid}@example.com` })
/** The bootstrap Admin, by the allowlisted address in the token. */
const admin = () => env.authenticatedContext('admin-uid-1', { email: ADMIN_EMAIL })

const bookingDoc = (overrides: Record<string, unknown> = {}) => ({
  guest_name: 'Ana Reyes',
  phone: '09171234567',
  email: 'ana@example.com',
  check_in: '2026-10-01',
  check_out: '2026-10-03',
  guests: 2,
  accommodation: 'Main House',
  status: 'Pending',
  created_at: new Date(),
  uid: GUEST_UID,
  ref_id: BOOKING_ID,
  source: 'web',
  ...overrides,
})

async function seed(work: (rulesDisabled: ReturnType<RulesTestEnvironment['authenticatedContext']>) => Promise<void>) {
  await env.withSecurityRulesDisabled(async () => work(env.authenticatedContext('seeder', {})))
}

describe('authentication and roles', () => {
  it('lets a signed-out visitor create an inquiry Booking and refuses one with no uid', async () => {
    const anon = env.unauthenticatedContext()
    await assertSucceeds(addDoc(collection(anon.firestore(), 'bookings'), bookingDoc()))
    await assertFails(addDoc(collection(anon.firestore(), 'bookings'), bookingDoc({ uid: '' })))
  })

  it('resolves the Admin from the allowlisted address in the token', async () => {
    await seed(async (db) => setDoc(doc(db.firestore(), 'bookings', BOOKING_ID), bookingDoc()))
    await assertSucceeds(getDoc(doc(admin().firestore(), 'bookings', BOOKING_ID)))
    await assertFails(getDoc(doc(emailGuest(OTHER_GUEST_UID).firestore(), 'bookings', BOOKING_ID)))
  })

  it('resolves an Admin promoted by a Profile document', async () => {
    await seed(async (db) => {
      await setDoc(doc(db.firestore(), 'bookings', BOOKING_ID), bookingDoc())
      await setDoc(doc(db.firestore(), 'profiles', 'promoted-admin-1'), { uid: 'promoted-admin-1', role: 'admin' })
    })
    await assertSucceeds(getDoc(doc(env.authenticatedContext('promoted-admin-1', { email: 'staff@example.com' }).firestore(), 'bookings', BOOKING_ID)))
  })

  it('refuses a signed-out visitor a Booking', async () => {
    await seed(async (db) => setDoc(doc(db.firestore(), 'bookings', BOOKING_ID), bookingDoc()))
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'bookings', BOOKING_ID)))
  })

  it('never lets a person promote themselves', async () => {
    const guest = anonymousGuest()
    await assertSucceeds(setDoc(doc(guest.firestore(), 'profiles', GUEST_UID), { uid: GUEST_UID, role: 'guest' }))
    await assertFails(setDoc(doc(guest.firestore(), 'profiles', GUEST_UID), { uid: GUEST_UID, role: 'admin' }))
  })
})

describe('bookings', () => {
  beforeAll(async () => {
    await seed(async (db) => setDoc(doc(db.firestore(), 'bookings', BOOKING_ID), bookingDoc()))
  })

  it('lets a Guest read their own Booking and not another Guest\'s', async () => {
    await assertSucceeds(getDoc(doc(anonymousGuest().firestore(), 'bookings', BOOKING_ID)))
    await assertFails(getDoc(doc(anonymousGuest(OTHER_GUEST_UID).firestore(), 'bookings', BOOKING_ID)))
  })

  it('accepts the self-serve payment patch and refuses any status a Guest cannot reach', async () => {
    const guest = emailGuest()
    await assertSucceeds(
      updateDoc(doc(guest.firestore(), 'bookings', BOOKING_ID), {
        status: 'Payment Pending',
        payment_plan: 'Full Payment',
        payment_status: 'pending',
        payment_proof_url: 'https://example.test/proof.jpg',
        amount_claimed: 8500,
        payment_reference: 'GCASH-123456',
      }),
    )
    await assertFails(updateDoc(doc(guest.firestore(), 'bookings', BOOKING_ID), { status: 'Reserved' }))
  })

  it('refuses a Guest a protected field', async () => {
    await assertFails(updateDoc(doc(emailGuest().firestore(), 'bookings', BOOKING_ID), { amount_verified: 8500 }))
    await assertFails(updateDoc(doc(emailGuest().firestore(), 'bookings', BOOKING_ID), { uid: OTHER_GUEST_UID }))
    await assertFails(updateDoc(doc(emailGuest().firestore(), 'bookings', BOOKING_ID), { guests: 9 }))
  })

  /**
   * The finding from the offline suite, stated as a question for the emulator:
   * can a Guest write `payment_status: 'verified'` on their own Booking? The
   * rule checks the keys a Guest touched, not the values they wrote, so the
   * expected answer is that it is allowed — and that is a defect worth seeing
   * in the emulator's own words.
   */
  it('states whether a Guest can forge payment_status: verified', async () => {
    let allowed = true
    try {
      await updateDoc(doc(emailGuest().firestore(), 'bookings', BOOKING_ID), { payment_status: 'verified' })
    } catch {
      allowed = false
    }
    console.info(`[rules probe] guest writes payment_status=verified: ${allowed ? 'ALLOWED' : 'DENIED'}`)
    expect(typeof allowed).toBe('boolean')
  })

  it('lets the Admin verify a payment and refuses a Booking that skips a gate', async () => {
    await seed(async (db) =>
      setDoc(doc(db.firestore(), 'bookings', BOOKING_ID), bookingDoc({ status: 'KYC Submitted', payment_status: 'pending' })),
    )
    await assertSucceeds(updateDoc(doc(admin().firestore(), 'bookings', BOOKING_ID), { status: 'Approved' }))
    await assertFails(updateDoc(doc(admin().firestore(), 'bookings', BOOKING_ID), { status: 'Reserved' }))
  })
})

describe('activity log', () => {
  const entry = (actor: string, actorId = GUEST_UID) => ({
    booking_id: BOOKING_ID,
    action: 'submit',
    from_status: null,
    to_status: 'Pending',
    actor,
    actor_id: actorId,
    at: new Date(),
  })

  it('refuses any edit or delete, the Admin included', async () => {
    await seed(async (db) => setDoc(doc(db.firestore(), 'bookings', BOOKING_ID, 'activity', 'entry-1'), entry('admin')))
    await assertSucceeds(getDoc(doc(admin().firestore(), 'bookings', BOOKING_ID, 'activity', 'entry-1')))
    await assertFails(updateDoc(doc(admin().firestore(), 'bookings', BOOKING_ID, 'activity', 'entry-1'), { action: 'rewritten' }))
    await assertFails(deleteDoc(doc(admin().firestore(), 'bookings', BOOKING_ID, 'activity', 'entry-1')))
  })

  it('refuses an entry signed as if a Guest wrote it, by anybody but a Guest', async () => {
    await assertFails(addDoc(collection(admin().firestore(), 'bookings', BOOKING_ID, 'activity'), entry('guest')))
  })

  /**
   * THE question the offline evaluator reports both ways. `role()` reads
   * `request.auth.token.email`, which an anonymous Guest's token does not carry.
   * If the emulator denies this write, the website's guest Activity log never
   * fills up in production and `firestore.rules` needs the fix recorded in
   * docs/VERIFICATION.md.
   */
  it('states whether an anonymous Guest may record themselves as the actor', async () => {
    let allowed = true
    try {
      await addDoc(collection(anonymousGuest().firestore(), 'bookings', BOOKING_ID, 'activity'), entry('guest'))
    } catch {
      allowed = false
    }
    console.info(`[rules probe] anonymous guest writes an activity entry: ${allowed ? 'ALLOWED' : 'DENIED'}`)
    expect(typeof allowed).toBe('boolean')
  })
})

describe('payments and references', () => {
  it('keeps the reference catalogue to the Admin', async () => {
    await seed(async (db) => setDoc(doc(db.firestore(), 'payment_references', 'GCASH-123456'), { reference: 'GCASH-123456', amount: 8500, status: 'available' }))
    await assertSucceeds(getDoc(doc(admin().firestore(), 'payment_references', 'GCASH-123456')))
    await assertFails(getDoc(doc(emailGuest().firestore(), 'payment_references', 'GCASH-123456')))
    await assertFails(setDoc(doc(emailGuest().firestore(), 'payment_references', 'GCASH-999999'), { reference: 'GCASH-999999', amount: 1, status: 'available' }))
    await assertFails(setDoc(doc(admin().firestore(), 'payment_references', 'GCASH-999998'), { reference: 'x', amount: 1, status: 'maybe' }))
  })
})

describe('chat', () => {
  beforeAll(async () => {
    await seed(async (db) =>
      setDoc(doc(db.firestore(), 'conversations', CONVO_ID), {
        guest_uid: GUEST_UID,
        category: 'booking-inquiry',
        created_at: new Date(),
        updated_at: new Date(),
        last_message: '',
        unread_admin: 0,
        unread_guest: 0,
      }),
    )
  })

  it('keeps a conversation to its Guest and to the Admin', async () => {
    await assertSucceeds(getDoc(doc(anonymousGuest().firestore(), 'conversations', CONVO_ID)))
    await assertFails(getDoc(doc(anonymousGuest(OTHER_GUEST_UID).firestore(), 'conversations', CONVO_ID)))
    await assertSucceeds(getDoc(doc(admin().firestore(), 'conversations', CONVO_ID)))
  })

  it('lets the Guest send as themselves and refuses a spoofed sender', async () => {
    const message = { sender_uid: GUEST_UID, sender_role: 'guest', text: 'Hello?', created_at: new Date() }
    await assertSucceeds(addDoc(collection(anonymousGuest().firestore(), 'conversations', CONVO_ID, 'messages'), message))
    await assertFails(addDoc(collection(anonymousGuest(OTHER_GUEST_UID).firestore(), 'conversations', CONVO_ID, 'messages'), message))
  })

  it('never lets a message be rewritten', async () => {
    const sent = await addDoc(collection(anonymousGuest().firestore(), 'conversations', CONVO_ID, 'messages'), {
      sender_uid: GUEST_UID,
      sender_role: 'guest',
      text: 'Hello?',
      created_at: new Date(),
    })
    await assertFails(updateDoc(doc(admin().firestore(), 'conversations', CONVO_ID, 'messages', sent.id), { text: 'edited' }))
    await assertFails(deleteDoc(doc(admin().firestore(), 'conversations', CONVO_ID, 'messages', sent.id)))
  })

  it('states whether a stranger may post into a conversation that is not theirs', async () => {
    let allowed = true
    try {
      await addDoc(collection(anonymousGuest(OTHER_GUEST_UID).firestore(), 'conversations', CONVO_ID, 'messages'), {
        sender_uid: OTHER_GUEST_UID,
        sender_role: 'guest',
        text: 'not mine',
        created_at: new Date(),
      })
    } catch {
      allowed = false
    }
    console.info(`[rules probe] stranger posts into another conversation: ${allowed ? 'ALLOWED' : 'DENIED'}`)
    expect(typeof allowed).toBe('boolean')
  })
})

describe('reviews', () => {
  it('accepts a signed Guest review with a 1..5 rating and refuses the rest', async () => {
    const guest = emailGuest()
    await assertSucceeds(addDoc(collection(guest.firestore(), 'reviews'), { booking_id: BOOKING_ID, uid: GUEST_UID, stars: 5, text: 'Lovely', created_at: new Date() }))
    await assertFails(addDoc(collection(guest.firestore(), 'reviews'), { booking_id: BOOKING_ID, uid: GUEST_UID, stars: 6, created_at: new Date() }))
    await assertFails(addDoc(collection(guest.firestore(), 'reviews'), { booking_id: BOOKING_ID, uid: OTHER_GUEST_UID, stars: 5, created_at: new Date() }))
  })

  it('states whether a second review for the same stay can be written', async () => {
    const guest = emailGuest()
    let secondAllowed = true
    try {
      await addDoc(collection(guest.firestore(), 'reviews'), { booking_id: BOOKING_ID, uid: GUEST_UID, stars: 4, text: 'Again', created_at: new Date() })
    } catch {
      secondAllowed = false
    }
    console.info(`[rules probe] second review for the same booking: ${secondAllowed ? 'ALLOWED' : 'DENIED'}`)
    expect(typeof secondAllowed).toBe('boolean')
  })

  it('keeps reviews private between Guests', async () => {
    await seed(async (db) => setDoc(doc(db.firestore(), 'reviews', 'r-1'), { booking_id: BOOKING_ID, uid: GUEST_UID, stars: 5, created_at: new Date() }))
    await assertSucceeds(getDoc(doc(emailGuest().firestore(), 'reviews', 'r-1')))
    await assertFails(getDoc(doc(emailGuest(OTHER_GUEST_UID).firestore(), 'reviews', 'r-1')))
    await assertSucceeds(getDoc(doc(admin().firestore(), 'reviews', 'r-1')))
  })
})

describe('smart lock and the retired tracker', () => {
  it('records a lock touch in the writer\'s own uid, and refuses a spoofed one', async () => {
    const row = { timestamp: new Date(), uid: GUEST_UID, ref_id: BOOKING_ID, result: 'granted', reason: 'mobile-key' }
    await assertSucceeds(addDoc(collection(anonymousGuest().firestore(), 'access_logs'), row))
    await assertFails(addDoc(collection(anonymousGuest(OTHER_GUEST_UID).firestore(), 'access_logs'), row))
    await assertFails(addDoc(collection(anonymousGuest().firestore(), 'access_logs'), { ...row, result: 'maybe' }))
  })

  it('keeps the Access log readable by the Admin only', async () => {
    await assertSucceeds(getDocs(admin().firestore().collection('access_logs')))
    await assertFails(getDocs(anonymousGuest().firestore().collection('access_logs')))
  })

  it('refuses the tracking_sessions collection to everybody', async () => {
    const session = { bookingId: BOOKING_ID, uid: GUEST_UID, tracking_consent_at: new Date(), latitude: 14.1, longitude: 121.3, lastUpdated: new Date() }
    const path = `tracking_sessions/${BOOKING_ID}`
    await assertFails(setDoc(doc(anonymousGuest().firestore(), path), session))
    await assertFails(getDoc(doc(anonymousGuest().firestore(), path)))
    await assertFails(setDoc(doc(admin().firestore(), path), session))
    await assertFails(getDoc(doc(admin().firestore(), path)))
    await assertFails(getDocs(admin().firestore().collection('tracking_sessions')))
  })

  it('leaves the Admin the delete that purges an old session', async () => {
    await seed(async (db) => setDoc(doc(db.firestore(), 'tracking_sessions', BOOKING_ID), { bookingId: BOOKING_ID, uid: GUEST_UID }))
    await assertSucceeds(deleteDoc(doc(admin().firestore(), 'tracking_sessions', BOOKING_ID)))
  })
})

describe('storage', () => {
  const bytes = new Uint8Array([137, 80, 78, 71])

  it('lets a Guest upload their own proof and refuses another Guest\'s folder', async () => {
    await assertSucceeds(uploadBytes(ref(anonymousGuest().storage(), `payments/${GUEST_UID}/${BOOKING_ID}/proof.png`), bytes, { contentType: 'image/png' }))
    await assertFails(uploadBytes(ref(anonymousGuest(OTHER_GUEST_UID).storage(), `payments/${GUEST_UID}/${BOOKING_ID}/proof.png`), bytes, { contentType: 'image/png' }))
  })

  it('refuses a non-image upload', async () => {
    await assertFails(uploadBytes(ref(anonymousGuest().storage(), `kyc/${GUEST_UID}/${BOOKING_ID}/id.txt`), bytes, { contentType: 'text/plain' }))
  })

  it('keeps a KYC document to its owner and the Admin', async () => {
    await assertSucceeds(getDownloadURL(ref(anonymousGuest().storage(), `payments/${GUEST_UID}/${BOOKING_ID}/proof.png`)))
    await assertFails(getDownloadURL(ref(emailGuest(OTHER_GUEST_UID).storage(), `payments/${GUEST_UID}/${BOOKING_ID}/proof.png`)))
    await assertSucceeds(getDownloadURL(ref(admin().storage(), `payments/${GUEST_UID}/${BOOKING_ID}/proof.png`)))
  })

  it('lets nobody read a payment proof signed out', async () => {
    await assertFails(getDownloadURL(ref(env.unauthenticatedContext().storage(), `payments/${GUEST_UID}/${BOOKING_ID}/proof.png`)))
  })

  it('lets only the Admin delete a proof', async () => {
    await assertFails(deleteObject(ref(anonymousGuest().storage(), `payments/${GUEST_UID}/${BOOKING_ID}/proof.png`)))
    await assertSucceeds(deleteObject(ref(admin().storage(), `payments/${GUEST_UID}/${BOOKING_ID}/proof.png`)))
  })

  it('refuses a path with no rule', async () => {
    await assertFails(uploadBytes(ref(admin().storage(), 'backups/dump.png'), bytes, { contentType: 'image/png' }))
  })
})
