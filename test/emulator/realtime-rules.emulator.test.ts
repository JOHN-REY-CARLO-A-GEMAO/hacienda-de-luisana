/**
 * The canonical suite for `database.rules.json` — the rules that guard the
 * ephemeral live-location stream (ADR-0013).
 *
 * `npm run test:emulator` starts the Auth, Firestore, **Database** and Storage
 * emulators with this repository's rules files and runs the cases below inside
 * `emulators:exec`. It needs Java and the emulator download (one-time,
 * ~200 MB) — neither is available in every environment, which is why
 * `test/web/realtime-database-rules.test.ts` exists as the offline companion
 * (it reads the rules file; it does not evaluate it).
 *
 * The cases mirror the authorization matrix the feature claims:
 *   - a Guest writes only into their own uid's path, only as themselves
 *   - nobody reads a position except the Admin, and the Admin's read is on the
 *     leaf and is refused the moment the window closes
 *   - a fix past its window is refused, and a node must carry all nine fields
 *   - nothing outside `live_location` is readable or writable at all
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'

const PROJECT = process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT ?? 'demo-hacienda'
const ADMIN_EMAIL = 'haciendadeluisiana@gmail.com'
const GUEST_UID = 'guest-uid-1'
const OTHER_GUEST_UID = 'guest-uid-2'
const CONVO_ID = 'convo-1'
const SECRET = 'a'.repeat(32)

let env: RulesTestEnvironment

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    database: {
      host: '127.0.0.1',
      port: 9000,
      rules: readFileSync(join(__dirname, '../../database.rules.json'), 'utf8'),
    },
  })
})

afterAll(async () => {
  await env?.cleanup()
})

// Every case starts from an empty stream. The suite reuses one conversation and
// one Guest across all of them, so without this a node written by one test is
// still there for the next — and the Admin's read is refused by the expiry rule
// when a previous case left `expires_at_ms` in the past, which is a correct rule
// answering a dirty database.
beforeEach(async () => {
  await env.clearDatabase()
})

const guest = (uid = GUEST_UID) => env.authenticatedContext(uid, {}).database()
const other = () => guest(OTHER_GUEST_UID)
const admin = () => env.authenticatedContext('admin-uid-1', { email: ADMIN_EMAIL }).database()
const signedOut = () => env.unauthenticatedContext().database()

/** A position the rules must accept, with the window still open. */
function fix(overrides: Record<string, unknown> = {}) {
  // Nine fields, exactly what `database.rules.json` requires. There is
  // deliberately no `'.ttl'` here: Realtime Database has no per-node TTL, and a
  // key containing `.` is rejected by the client SDK before the write is sent,
  // so a fixture carrying one fails the very first case with an invalid-key
  // error that has nothing to do with the rules. Expiry is the rules' job, and
  // it is asserted below.
  //
  // The window is 60 seconds, NOT the session's length. `.validate` refuses any
  // `expires_at_ms` more than 90 seconds ahead of `now` — a client cannot stamp
  // a node with a long life, it re-asserts the real window on every fix — so a
  // fixture claiming the full half-hour contradicted the rule it was written to
  // test, and the two cases that expected a write to succeed were the two that
  // failed. (This suite had never been executed: the Database emulator had
  // never been downloaded.)
  const expiresAtMs = Date.now() + 60_000
  return {
    lat: 14.1,
    lng: 121.3,
    accuracy_m: 12,
    at_ms: Date.now(),
    seq: 1,
    guest_uid: GUEST_UID,
    conversation_id: CONVO_ID,
    session_secret: SECRET,
    expires_at_ms: expiresAtMs,
    ...overrides,
  }
}

const path = (uid = GUEST_UID) => `live_location/${CONVO_ID}/${uid}`

/**
 * A refusal that says *why* it was a refusal.
 *
 * `@firebase/rules-unit-testing`'s `assertFails` is satisfied by any rejection at
 * all, which is the wrong contract here: the Realtime Database client validates
 * a payload before the rules ever see it, and it throws synchronously rather
 * than rejecting. A fixture carrying an invalid key — a `.` in a child name is
 * the one that shipped, see the `fix()` comment below — therefore "fails", and
 * an `assertFails` around it goes green while proving nothing whatsoever about
 * `database.rules.json`. That is how a rule that had never been evaluated once
 * came to look tested.
 *
 * So every refusal here asserts a `permission-denied` code, and reports what it
 * got instead. A payload the client rejects now fails the suite loudly instead
 * of quietly passing it.
 *
 * Takes a thunk, not a promise: the SDK throws synchronously on an invalid
 * payload, and a promise argument would be evaluated before the call.
 */
async function assertDenied(act: () => unknown, what: string): Promise<void> {
  let outcome: unknown
  try {
    await act()
  } catch (caught) {
    outcome = caught
  }
  if (outcome === undefined) {
    throw new Error(`${what}: expected a permission denial, but it was allowed`)
  }
  const code = (outcome as { code?: string }).code
  // Firestore and Storage spell it `permission-denied`; the Realtime Database
  // spells it `PERMISSION_DENIED`. Both mean one thing, and the suite is about
  // the Realtime Database, so both are accepted — but nothing else is.
  if (String(code).toLowerCase().replace(/_/g, '-') !== 'permission-denied') {
    const message = outcome instanceof Error ? outcome.message : String(outcome)
    throw new Error(`${what}: expected a permission denial, got ${code ?? 'no code'} — ${message}`)
  }
}

describe('live location, the ephemeral stream', () => {
  it('lets the sharing Guest write their own position', async () => {
    await assertSucceeds(guest().ref(path()).set(fix()))
  })

  it('refuses a Guest writing under somebody else\'s uid', async () => {
    await assertDenied(() => other().ref(path()).set(fix({ guest_uid: OTHER_GUEST_UID })), "another Guest's path")
  })

  it('refuses a fix that names another Guest inside their own path', async () => {
    await assertDenied(() => guest().ref(path()).set(fix({ guest_uid: OTHER_GUEST_UID })), 'a spoofed guest_uid')
  })

  it('refuses a fix filed under the wrong conversation', async () => {
    await assertDenied(() => guest().ref(path()).set(fix({ conversation_id: 'convo-9' })), 'a mismatched conversation_id')
  })

  it('refuses a fix whose window has already closed', async () => {
    const past = Date.now() - 1000
    await assertDenied(() => guest().ref(path()).set(fix({ expires_at_ms: past })), 'a closed window')
  })

  it('refuses a fix claiming a window far beyond its own', async () => {
    const far = Date.now() + 24 * 60 * 60_000
    await assertDenied(() => guest().ref(path()).set(fix({ expires_at_ms: far })), 'a window an hour and a day out')
  })

  it('refuses a position outside the Philippines', async () => {
    await assertDenied(() => guest().ref(path()).set(fix({ lat: 51.5 })), 'a latitude in London')
    await assertDenied(() => guest().ref(path()).set(fix({ lng: -0.12 })), 'a longitude in London')
  })

  it('refuses a fix missing a field, and a signed-out writer', async () => {
    const incomplete = {...(fix() as Record<string, unknown>)}
    delete incomplete.session_secret
    await assertDenied(() => guest().ref(path()).set(incomplete), 'a fix with no session_secret')
    await assertDenied(() => signedOut().ref(path()).set(fix()), 'a signed-out writer')
  })

  it('refuses a fix carrying a movement log beside the position', async () => {
    // `hasChildren` is a floor, not a ceiling — Firebase's own documentation says
    // so, and the rules language has no "only these keys" primitive to reach for.
    // (An earlier attempt here used `newData.numChildren()`, which does not exist;
    // the emulator refused to compile the file, which is the only reason the claim
    // did not ship.) So the refusal is a denylist of the accumulation shapes, the
    // same shape of defence as Firestore's `location_sessions` rule. It is not
    // airtight — a client that invents an unlisted key name could still park bytes
    // in a node only that Guest can write — and ADR-0013 records the residual
    // rather than claiming a guarantee the language cannot make.
    for (const key of ['trail', 'points', 'history', 'track', 'path']) {
      await assertDenied(
        () => guest().ref(path()).set({ ...fix(), [key]: [{ lat: 14.1, lng: 121.3 }] }),
        `a fix carrying \`${key}\``,
      )
    }
    // .and the nine fields on their own are still what the rules ask for.
    await assertSucceeds(guest().ref(path()).set(fix()))
  })

  it('lets the Admin read a position, and refuses every Guest', async () => {
    await assertSucceeds(guest().ref(path()).set(fix()))
    await assertSucceeds(admin().ref(path()).once('value'))
    await assertDenied(() => guest().ref(path()).once('value'), 'the sharing Guest reading their own node')
    await assertDenied(() => other().ref(path()).once('value'), 'another Guest reading it')
    await assertDenied(() => signedOut().ref(path()).once('value'), 'a signed-out reader')
  })

  it('refuses the Admin a position whose window has closed', async () => {
    // The guarantee that replaced the server-side TTL Realtime Database never
    // had. A `.read` cascades downward and a deeper rule cannot revoke a
    // shallower one, so the expiry check only bites because the Admin's grant
    // was moved down onto the leaf — a grant at the conversation node would
    // cover this read and no leaf rule could take it away.
    //
    // The node is left in place deliberately: this is the abandoned-share case
    // (a closed tab, a dead battery) where nothing deleted the bytes, and the
    // position must still be unreadable.
    //
    // The refusal reaches the SDK as a synchronous throw rather than a rejected
    // promise, which is why `assertDenied` takes a thunk.
    await assertSucceeds(
      guest().ref(path()).set(fix({ expires_at_ms: Date.now() + 5_000 })),
    )
    await new Promise((resolve) => setTimeout(resolve, 6_000))
    await assertDenied(() => admin().ref(path()).once('value'), 'the Admin reading a closed window')
    await assertDenied(() => guest().ref(path()).once('value'), 'the Guest reading a closed window')
    await assertDenied(() => other().ref(path()).once('value'), 'another Guest reading a closed window')
    await assertDenied(() => signedOut().ref(path()).once('value'), 'a signed-out reader on a closed window')
  })

  it('keeps the Admin mirror to the allowlist, and to their own uid', async () => {
    // `live_location_admins` is the only way a Profile-promoted Admin is let into
    // the Admin's read, so who may write it decides who may read a position. It
    // had no case in this suite at all: the mirror was exercised by neither
    // writer, so a rule that let any signed-in person promote themselves would
    // have been green here.
    await assertSucceeds(admin().ref('live_location_admins/promoted-1').set(true))
    await assertDenied(() => guest().ref('live_location_admins/promoted-2').set(true), 'a Guest writing the mirror')
    await assertDenied(() => other().ref('live_location_admins/promoted-3').set(true), 'another Guest writing the mirror')
    await assertDenied(() => signedOut().ref('live_location_admins/promoted-4').set(true), 'a signed-out writer')
    // And it is a mirror, not a grant of its own: nobody may read it back.
    await assertDenied(() => admin().ref('live_location_admins').once('value'), 'reading the mirror')
  })

  it('lets the promoted Admin in once the mirror names them', async () => {
    // The whole point of the mirror: an address on the allowlist writes it, and a
    // Profile-promoted Admin with no allowlisted address is let in by it.
    await assertSucceeds(admin().ref('live_location_admins/promoted-1').set(true))
    await assertSucceeds(guest().ref(path()).set(fix()))
    const promoted = env.authenticatedContext('promoted-1', { email: 'not-allowlisted@example.com' })
    await assertSucceeds(promoted.database().ref(path()).once('value'))
  })

  it('refuses a write above the leaf, where the rules grant nothing', async () => {
    // `.write` cascades downward, so the leaf grant cannot authorise the parent —
    // but nothing says so out loud, and a parent write would land `convo-1` as a
    // bare node. Asserted rather than assumed.
    await assertDenied(() => guest().ref(`live_location/${CONVO_ID}`).set(fix()), 'a write to the conversation node')
    await assertDenied(() => guest().ref('live_location').set({ anything: true }), 'a write to the stream root')
  })

  it('closes everything that is not the stream', async () => {
    await assertDenied(() => admin().ref('conversations').once('value'), 'reading conversations')
    await assertDenied(() => admin().ref('live_location_admins').once('value'), 'reading the mirror')
    await assertDenied(() => guest().ref('anything_at_all').set({ hello: 'world' }), 'an unnamed path')
  })

  it('cannot be satisfied by a payload the client itself refuses', async () => {
    // The regression that made this suite meaningless, asserted against itself.
    // `.ttl` was written by an earlier revision of `publishFix`; a `.` in a child
    // name is rejected by `validateFirebaseData` in the browser, before the write
    // is sent, so it threw on every fix and the feature had never once published a
    // position. Under `assertFails` that throw is indistinguishable from a rule
    // refusing — so the helper has to refuse it too, and say which error it got.
    await expect(
      assertDenied(
        () => guest().ref(path()).set({ ...fix(), '.ttl': Date.now() + 30_000 }),
        'a child name containing a dot',
      ),
    ).rejects.toThrow(/expected a permission denial, got/)

    // The same shape of mistake from the other direction: a payload that succeeds
    // is not a denial, and must not be reported as one.
    await expect(assertDenied(() => guest().ref(path()).set(fix()), 'a valid fix')).rejects.toThrow(
      /expected a permission denial, but it was allowed/,
    )
  })
})
