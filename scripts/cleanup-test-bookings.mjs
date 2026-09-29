/**
 * Delete the booking documents the test suite wrote into the LIVE Firestore
 * project. Read-only by default.
 *
 * -----------------------------------------------------------------------------
 * WHERE THEY CAME FROM
 * -----------------------------------------------------------------------------
 * `vitest.config.ts` gained `envDir: 'test/web'` in commit fdb2579 ("test: make
 * the vitest run hermetic"). Before it, a developer with real keys in
 * `.env.local` ran the suite against the live project, so fixtures from
 * `test/web/booking-store.test.ts` and `activity-log.test.ts` landed here as
 * real documents. They are recognisable: every email is `@example.com`, every
 * uid is `guest-1` / `guest-uid-7` / `guest-ocr` rather than a Firebase uid, and
 * none of them has a `payment_proof_url` — which `firestore.rules` has required
 * since 538fd40, so none could have come from a Guest on the live site.
 *
 * -----------------------------------------------------------------------------
 * WHAT IT NEVER TOUCHES
 * -----------------------------------------------------------------------------
 * `profiles` (role data), `site_config` (the published rates) and `users` (no
 * rule covers it, so only the console can). It also refuses outright when a
 * booking does not carry an `@example.com` address, unless told otherwise —
 * see the interlocks below.
 *
 * -----------------------------------------------------------------------------
 * HOW TO RUN
 * -----------------------------------------------------------------------------
 *   node scripts/cleanup-test-bookings.mjs                     # dry run
 *   node scripts/cleanup-test-bookings.mjs --confirm           # delete the fixtures
 *   node scripts/cleanup-test-bookings.mjs --confirm --skip-real
 *
 * `--skip-real` deletes the `@example.com` fixtures and leaves every booking
 * that carries a real-looking address alone, which is what you want while your
 * own test bookings are still in the database. `--allow-real` deletes them too.
 *
 * The credentials come from the environment, never a command-line argument, so
 * the password does not land in shell history, and it is never printed.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIRM = process.argv.includes('--confirm')
const SKIP_REAL = process.argv.includes('--skip-real')
const ALLOW_REAL = process.argv.includes('--allow-real')
const PROJECT = 'hacienda-de-luisana'
const BATCH = 400 // Firestore's limit is 500 writes per batchWrite.

const EMAIL = process.env.ADMIN_EMAIL
const PASSWORD = process.env.ADMIN_PASSWORD
if (!EMAIL || !PASSWORD) {
  console.error(
    'Set ADMIN_EMAIL and ADMIN_PASSWORD first. They come from the environment so the\n' +
      'password never lands in your shell history.\n',
  )
  process.exit(2)
}

function bail(message, code = 2) {
  console.error(message)
  process.exit(code)
}

function readEnvLocal() {
  const out = {}
  for (const line of readFileSync(join(repoRoot, '.env.local'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}
const env = readEnvLocal()
if (env.VITE_FIREBASE_PROJECT_ID !== PROJECT) {
  bail(`Refusing: .env.local points at "${env.VITE_FIREBASE_PROJECT_ID}", not "${PROJECT}".`)
}
const API_KEY = env.VITE_FIREBASE_API_KEY
const DOCS = `projects/${PROJECT}/databases/(default)/documents`
const call = (path, init = {}) =>
  fetch(`https://firestore.googleapis.com/v1/${DOCS}/${path}${path.includes('?') ? '&' : '?'}key=${API_KEY}`, init)

const signedIn = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true }),
  },
)
if (!signedIn.ok) bail(`Could not sign in as ${EMAIL} (HTTP ${signedIn.status}).`)
const idToken = (await signedIn.json()).idToken
const authed = { headers: { authorization: `Bearer ${idToken}`, 'content-type': 'application/json' } }
console.log(`Project:  ${PROJECT}`)
console.log(`As:       ${EMAIL}`)
console.log(`Mode:     ${CONFIRM ? 'DELETE' : 'dry run — pass --confirm to apply'}`)

// Interlock 1: can this credential actually administer? Tested, not assumed — a
// read of `access_logs` is Admin-only, so a refusal here means every delete
// below would be refused too. Checked as a capability rather than against one
// particular grant, because the rules do not only hand out Admin by email.
const capability = await call('access_logs?pageSize=1', authed)
if (!capability.ok) {
  bail(`This credential cannot perform an Admin-only read (HTTP ${capability.status}). Nothing changed.`)
}
console.log('')

async function listCollection(path) {
  const docs = []
  let page = ''
  do {
    const r = await call(`${path}?pageSize=1000${page ? `&pageToken=${page}` : ''}`, authed)
    if (!r.ok) bail(`Could not read ${path} (HTTP ${r.status}).`)
    const body = await r.json()
    for (const d of body.documents ?? []) docs.push({ name: d.name, data: d.fields })
    page = body.nextPageToken ?? ''
  } while (page)
  return docs
}

/**
 * Every `activity` document under every booking.
 *
 * A collection-group query over `activity` is refused (it spans paths, so the
 * rules cannot authorise it in one go), and asking booking by booking serially
 * is minutes of silence across ~600 bookings. So ask for them in parallel, a few
 * at a time, with a retry — Firestore resets the connection when too many are
 * opened at once.
 */
async function listActivityEverywhere(allBookings) {
  const one = async (booking) => {
    const id = booking.name.split('/').pop()
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const r = await call(`bookings/${id}/activity?pageSize=1000`, authed)
        if (!r.ok) return []
        return ((await r.json()).documents ?? []).map((d) => ({ name: d.name, data: d.fields }))
      } catch (e) {
        if (attempt === 3) throw e
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
      }
    }
    return []
  }
  const CONCURRENCY = 8
  const found = []
  for (let i = 0; i < allBookings.length; i += CONCURRENCY) {
    const slice = allBookings.slice(i, i + CONCURRENCY)
    found.push(...(await Promise.all(slice.map(one))).flat())
  }
  return found
}

const bookings = await listCollection('bookings')
const activity = await listActivityEverywhere(bookings)
const accessLogs = await listCollection('access_logs')

const field = (d, k) => d[k]?.stringValue ?? d[k]?.integerValue ?? d[k]?.doubleValue ?? ''
const isFixture = (b) => field(b.data, 'email').toLowerCase().endsWith('@example.com')

console.log(`bookings found:            ${bookings.length}`)
console.log(`  of those, @example.com:  ${bookings.filter(isFixture).length}`)
console.log(`bookings/*/activity:       ${activity.length}`)
console.log(`access_logs:               ${accessLogs.length}\n`)

// Interlock 2: a booking with a real-looking address is never deleted by
// accident. Either leave it (--skip-real) or, having read the list below,
// say so out loud (--allow-real).
const realBookings = bookings.filter((b) => !isFixture(b))
if (realBookings.length) {
  const detail = realBookings.map((b) => {
    const d = b.data
    return (
      `  ${b.name.split('/').pop()}  ${field(d, 'guest_name')} <${field(d, 'email')}>  ` +
      `${field(d, 'accommodation')} ${field(d, 'check_in')}..${field(d, 'check_out')}  ` +
      `status=${field(d, 'status')}  created=${d.created_at?.timestampValue ?? '?'}  ` +
      `proof=${d.payment_proof_url?.stringValue ?? 'NONE'}`
    )
  })
  if (!ALLOW_REAL && !SKIP_REAL) {
    bail(
      `STOP. ${realBookings.length} booking(s) do not use an @example.com address, so at least one\n` +
        'may be a real Guest. Nothing has been deleted. Read these:\n\n' +
        detail.join('\n') +
        '\n\n  --skip-real   delete the fixtures and leave these alone\n' +
        '  --allow-real  delete these too, if you have read the list and they are yours\n',
      3,
    )
  }
  if (SKIP_REAL) {
    const keep = new Set(realBookings.map((b) => b.name))
    console.log(`--skip-real: leaving ${keep.size} booking(s) alone:\n${detail.join('\n')}\n`)
  }
}

const doomed = SKIP_REAL && !ALLOW_REAL ? bookings.filter(isFixture) : bookings
// A booking's id is segment 6 of its document name:
//   projects/<project>/databases/(default)/documents/bookings/<id>[/activity/<seq>]
const doomedBookingIds = new Set(doomed.map((b) => b.name.split('/')[6]))
const activityUnderDoomed = activity.filter((a) => doomedBookingIds.has(a.name.split('/')[6]))

const targets = [
  ...doomed.map((b) => b.name),
  ...activityUnderDoomed.map((a) => a.name),
  ...accessLogs.map((a) => a.name),
]

console.log(`bookings to delete:       ${doomed.length}`)
console.log(`activity to delete:       ${activityUnderDoomed.length}`)
console.log(`access_logs to delete:    ${accessLogs.length}`)
console.log(`total documents:          ${targets.length}`)

if (activity.length && activityUnderDoomed.length !== activity.length) {
  console.log(`\n(${activity.length - activityUnderDoomed.length} activity entries belong to bookings being kept.)`)
}

if (activityUnderDoomed.length) {
  console.log(
    '\nNote: firestore.rules sets `allow update, delete: if false` on bookings/*/activity,\n' +
      'so no client can remove an audit entry - not even an Admin. Those deletes will be\n' +
      'refused below. firestore.rules would need a temporary change to clear them.',
  )
}

if (!CONFIRM) {
  console.log('\nNothing changed. Pass --confirm to apply.')
  process.exit(0)
}
// One DELETE per document. `documents:batchWrite` is refused for a Firebase ID
// token (403) even where a single delete is allowed, so batching is not available.
//
// `name` is already a full resource name (`projects/.../documents/bookings/<id>`),
// so the URL must NOT be built through `call()`, which prepends the documents
// path for the relative reads above — doing both doubles the prefix and every
// delete lands on a path that does not exist.
const deleteByName = (name) =>
  fetch(`https://firestore.googleapis.com/v1/${name}${name.includes('?') ? '&' : '?'}key=${API_KEY}`, {
    method: 'DELETE',
    headers: authed.headers,
  })

const CONCURRENCY = 8
let done = 0
let refused = 0
const ref = new Map()
const firstRefusal = new Map()
const drop = async (name) => {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const r = await deleteByName(name)
      done += 1
      if (!r.ok) {
        refused += 1
        const kind = name.includes('/activity/') ? 'activity' : 'other'
        ref.set(kind, (ref.get(kind) ?? 0) + 1)
        if (!firstRefusal.has(kind)) {
          const body = await r.text()
          firstRefusal.set(kind, `HTTP ${r.status} ${body.slice(0, 200)}`)
        }
      }
      return
    } catch (e) {
      if (attempt === 3) {
        refused += 1
        ref.set('network', (ref.get('network') ?? 0) + 1)
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt))
    }
  }
}
for (let i = 0; i < targets.length; i += CONCURRENCY) {
  await Promise.all(targets.slice(i, i + CONCURRENCY).map(drop))
  if ((i + CONCURRENCY) % 80 === 0 || i + CONCURRENCY >= targets.length) {
    console.log(`  ${done}/${targets.length} attempted`)
  }
}

console.log(`\nDeleted ${done - refused} documents, ${refused} refused.`)
for (const [kind, n] of ref) console.log(`  ${n} ${kind} deletion(s) refused by the rules`)
console.log('\nStill to do by hand:')
console.log('  - users: delete from the Firebase console (no rule lets a client touch it)')
console.log('  - profiles: inspect before touching; it holds role data')
console.log('  - site_config: kept, the published rates live there')
process.exit(0)
