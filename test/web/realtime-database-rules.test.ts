// ----------------------------------------------------------------------------
// `database.rules.json` — the rules that guard the ephemeral position stream.
//
// This repository's offline evaluator reads Firestore's and Storage's rules; the
// Realtime Database has its own JSON rule language, and its canonical check is
// the Emulator Suite (`test/emulator/realtime-rules.emulator.test.ts`, run by
// `npm run test:emulator`). What this suite can do offline is read the rules
// file and hold it to the claims the rest of the feature makes about it, the way
// `auth-firestore-rules.test.ts` holds `firestore.rules`.
//
// Every assertion below is a claim the code, the UI or the ADR depends on, so a
// later edit that loosens the rules fails here first.
// ----------------------------------------------------------------------------
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { BOOTSTRAP_ROLES } from '../../src/lib/auth'
import { LIVE_LOCATION_PATH, LOCATION_SESSIONS_COLLECTION } from '../../src/lib/liveLocation'
import { MAX_SHARE_MINUTES } from '../../src/lib/liveLocationPolicy'

/** A rule value is either a literal `false` (deny) or an expression string. */
type RuleValue = false | string
type Rules = { rules: Record<string, Record<string, RuleValue | Record<string, RuleValue>>> }

const rules: Rules = JSON.parse(
  readFileSync(join(__dirname, '../../database.rules.json'), 'utf8'),
) as Rules

const live = rules.rules[LIVE_LOCATION_PATH] as Record<string, Record<string, RuleValue>>
const conversation = live['$conversationId'] as unknown as Record<string, RuleValue>
const guest = conversation['$guestUid'] as unknown as Record<string, RuleValue>
const write = guest['.write'] as string
const validate = guest['.validate'] as string
const read = conversation['.read'] as string

describe('the root of the Realtime Database is closed', () => {
  it('refuses a read and a write to anybody who did not name a path', () => {
    expect(rules.rules['.read']).toBe(false)
    expect(rules.rules['.write']).toBe(false)
  })

  it('refuses everything nobody wrote a rule for', () => {
    // The mirror of Firestore's `match /{document=**} { allow read, write: if false; }`:
    // a new collection does not become readable because nobody thought about it.
    expect(rules.rules['$other']['.read']).toBe(false)
    expect(rules.rules['$other']['.write']).toBe(false)
    expect(rules.rules['$other']['.validate']).toBe(false)
  })
})

describe('only a Guest may write, and only into their own path', () => {
  it('binds the writer to the uid in the path', () => {
    expect(write).toBe('auth != null && auth.uid == $guestUid')
  })

  it('binds the body of the fix to that same uid and to this conversation', () => {
    expect(validate).toContain("newData.child('guest_uid').val() == auth.uid")
    expect(validate).toContain("newData.child('conversation_id').val() == $conversationId")
  })
})

describe('the stream is a position, and nothing else', () => {
  it('accepts only the nine fields a fix is made of', () => {
    const required = validate.match(/hasChildren\(\[([^\]]*)\]\)/)?.[1] ?? ''
    expect(required.split(',').map((f) => f.trim().replace(/'/g, '')).sort()).toEqual([
      'accuracy_m',
      'at_ms',
      'conversation_id',
      'expires_at_ms',
      'guest_uid',
      'lat',
      'lng',
      'seq',
      'session_secret',
    ])
  })

  it('keeps a position inside the Philippines, where the hacienda is', () => {
    expect(validate).toContain("newData.child('lat').val() >= 4.0")
    expect(validate).toContain("newData.child('lat').val() <= 21.5")
    expect(validate).toContain("newData.child('lng').val() >= 116.0")
    expect(validate).toContain("newData.child('lng').val() <= 126.5")
  })

  it('refuses a fix whose window has closed, or claims to outlive its own', () => {
    expect(validate).toContain("newData.child('expires_at_ms').val() > now")
    // A client cannot stamp a node with an hour-long life: the window it claims
    // has to be the session's, and the session's is capped at an hour.
    expect(validate).toContain('newData.child(\'expires_at_ms\').val() <= now + 90000')
    expect(MAX_SHARE_MINUTES).toBe(60)
  })

  it('refuses a fix carrying a free-form field', () => {
    // Every accepted field is a number, a uid or a secret — nothing a client
    // could use to park an unbounded payload in the database.
    expect(validate).toContain("newData.child('session_secret').isString()")
    expect(validate).toContain("newData.child('accuracy_m').isNumber()")
    expect(validate).toContain("newData.child('seq').val() >= 0")
  })
})

describe('only the Admin may read a position', () => {
  it('names the same bootstrap addresses firestore.rules names', () => {
    const emails = [...read.matchAll(/'([^']+@[^']+)'/g)].map((m) => m[1]).sort()
    expect(emails).toEqual(BOOTSTRAP_ROLES.map((r) => r.email).sort())
  })

  it('lets a Profile-promoted Admin in through a mirror the allowlist Admin writes', () => {
    // The allowlist is the anchor because it needs no document of its own to
    // exist; a role held only in a Profile cannot be read from a token, so it is
    // mirrored here by an address that is already on the list.
    expect(read).toContain("root.child('live_location_admins').child(auth.uid).val() == true")
    const admins = rules.rules.live_location_admins['$uid'] as unknown as Record<string, RuleValue>
    expect(admins['.write'] as string).toContain('auth.token.email in [')
    expect(admins['.read']).toBe(false)
  })

  it('refuses a signed-out reader outright', () => {
    expect(read.startsWith('auth != null &&')).toBe(true)
  })
})

describe('the two stores are not interchangeable', () => {
  it('keeps the consent in Firestore and the position here', () => {
    expect(LOCATION_SESSIONS_COLLECTION).toBe('location_sessions')
    expect(Object.keys(rules.rules)).not.toContain(LOCATION_SESSIONS_COLLECTION)
  })

  it('is registered as the database rules of this project, not left unfiled', () => {
    const firebase = JSON.parse(readFileSync(join(__dirname, '../../firebase.json'), 'utf8'))
    expect(firebase.database.rules).toBe('database.rules.json')
  })
})
