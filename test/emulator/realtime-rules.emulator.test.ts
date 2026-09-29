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
 *   - nobody reads a position except the Admin
 *   - a fix past its window is refused, and a node must carry all nine fields
 *   - nothing outside `live_location` is readable or writable at all
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, it } from 'vitest'
import {
  assertFails,
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

const guest = (uid = GUEST_UID) => env.authenticatedContext(uid, {}).database()
const other = () => guest(OTHER_GUEST_UID)
const admin = () => env.authenticatedContext('admin-uid-1', { email: ADMIN_EMAIL }).database()
const signedOut = () => env.unauthenticatedContext().database()

/** A position the rules must accept, with the window still open. */
function fix(overrides: Record<string, unknown> = {}) {
  const expiresAtMs = Date.now() + 30 * 60_000
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
    '.ttl': expiresAtMs,
    ...overrides,
  }
}

const path = (uid = GUEST_UID) => `live_location/${CONVO_ID}/${uid}`

describe('live location, the ephemeral stream', () => {
  it('lets the sharing Guest write their own position', async () => {
    await assertSucceeds(guest().ref(path()).set(fix()))
  })

  it('refuses a Guest writing under somebody else\'s uid', async () => {
    await assertFails(other().ref(path()).set(fix({ guest_uid: OTHER_GUEST_UID })))
  })

  it('refuses a fix that names another Guest inside their own path', async () => {
    await assertFails(guest().ref(path()).set(fix({ guest_uid: OTHER_GUEST_UID })))
  })

  it('refuses a fix filed under the wrong conversation', async () => {
    await assertFails(guest().ref(path()).set(fix({ conversation_id: 'convo-9' })))
  })

  it('refuses a fix whose window has already closed', async () => {
    const past = Date.now() - 1000
    await assertFails(guest().ref(path()).set(fix({ expires_at_ms: past, '.ttl': past })))
  })

  it('refuses a fix claiming a window far beyond its own', async () => {
    const far = Date.now() + 24 * 60 * 60_000
    await assertFails(guest().ref(path()).set(fix({ expires_at_ms: far, '.ttl': far })))
  })

  it('refuses a position outside the Philippines', async () => {
    await assertFails(guest().ref(path()).set(fix({ lat: 51.5 })))
    await assertFails(guest().ref(path()).set(fix({ lng: -0.12 })))
  })

  it('refuses a fix missing a field, and a signed-out writer', async () => {
    const incomplete = {...(fix() as Record<string, unknown>)}
    delete incomplete.session_secret
    await assertFails(guest().ref(path()).set(incomplete))
    await assertFails(signedOut().ref(path()).set(fix()))
  })

  it('lets the Admin read a position, and refuses every Guest', async () => {
    await assertSucceeds(guest().ref(path()).set(fix()))
    await assertSucceeds(admin().ref(path()).once('value'))
    await assertFails(guest().ref(path()).once('value'))
    await assertFails(other().ref(path()).once('value'))
    await assertFails(signedOut().ref(path()).once('value'))
  })

  it('closes everything that is not the stream', async () => {
    await assertFails(admin().ref('conversations').once('value'))
    await assertFails(admin().ref('live_location_admins').once('value'))
    await assertFails(guest().ref('anything_at_all').set({ hello: 'world' }))
  })
})
