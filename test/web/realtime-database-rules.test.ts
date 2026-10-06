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
const conversation = live['$conversationId'] as unknown as Record<string, Record<string, RuleValue>>
const guest = conversation['$guestUid'] as unknown as Record<string, RuleValue>
const write = guest['.write'] as string
const validate = guest['.validate'] as string
// The Admin's read grant lives on the LEAF, not on the conversation subtree.
// A `.read` cascades downward in Realtime Database and a deeper rule cannot
// revoke a shallower one, so an expired position is only unreadable if the grant
// was never made at the parent. `database.rules.json` is the canonical check; the
// emulator suite (`test/emulator/realtime-rules.emulator.test.ts`) evaluates it.
const read = guest['.read'] as string
const conversationRead = conversation['.read'] as unknown as RuleValue | undefined

/**
 * The Admin addresses a rule names, however it names them.
 *
 * The Realtime Database has no `in` operator, so the allowlist is written as
 * explicit `==` comparisons rather than a list literal — which means "the
 * addresses in this rule" is a question about the text, not about a parsed list.
 */
function emailsIn(rule: string): string[] {
  return [...rule.matchAll(/'([^']+@[^']+)'/g)].map((m) => m[1]).sort()
}

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

  it('refuses a fix whose window has closed, or outlives the longest session', () => {
    expect(validate).toContain("newData.child('expires_at_ms').val() > now")
    // The bound is the longest session the Guest may start, and nothing longer.
    //
    // This used to read `now + 90000`, which no session the Guest can choose ever
    // fits inside: `publishFix` sends the session's own expiry on every fix, and
    // the shortest window `firestore.rules` will accept is a minute while the
    // choices offered are 15/30/60. So the *first* fix of *every* share was
    // refused, `useLiveLocation` read that as "the server ended the session", and
    // the panel said the hacienda refused the update. Nothing had ever published
    // a position. The figure that belongs here is the cap, which is what
    // `firestore.rules` already enforces on the consent with
    // `request.time + duration.value(1, 'h')`.
    expect(validate).toContain('newData.child(\'expires_at_ms\').val() <= now + 3600000')
    expect(MAX_SHARE_MINUTES).toBe(60)
    // Held against the whole maximum, so the two stores cannot drift apart again:
    // the cap is the policy module's, written out in the rule language's units.
    expect(3600000).toBe(MAX_SHARE_MINUTES * 60_000)
  })

  it('refuses a fix that would push the node\'s window out past the one already there', () => {
    // The other half of "a client cannot extend its own session". `data` is the
    // node as it stands and `newData` is what this write would leave behind, so
    // the first fix sets the ceiling and every later fix may only shorten it or
    // restate it. Without this clause the 60-minute cap above is only a cap on
    // any *one* write: a client could re-stamp `now + 3600000` every thirty
    // seconds and keep a node readable forever, which is a strictly longer
    // life than the session the Firestore consent ended.
    //
    // `data.child(...)` is absent on the creating write, which is what the
    // `.exists()` guard is for — comparing a number against a missing child would
    // refuse the very first fix of a share. And `.validate` is not applied to
    // deletes at all, so this clause cannot stand in the way of `stopSharing`
    // removing the node.
    expect(validate).toContain(
      "!data.child('expires_at_ms').exists() || newData.child('expires_at_ms').val() <= data.child('expires_at_ms').val()",
    )
  })

  it('refuses a fix carrying a movement log beside the position', () => {
    // `hasChildren` is a floor, not a ceiling, and the Realtime Database rules
    // language has no "only these keys" primitive — Firebase's own data-validation
    // guide documents `hasChildren` as a floor and `!newData.hasChild(x)` as the
    // way to refuse something. (An earlier attempt here used
    // `newData.numChildren()`, which does not exist; the emulator refused to
    // compile the file.) So this is a denylist of the accumulation shapes, and it
    // is the same shape of defence as Firestore's `location_sessions` rule.
    //
    // It is not airtight, and ADR-0013 says so rather than claiming otherwise: the
    // writer is the owning Guest and only the owning Guest, so the residual is a
    // Guest parking bytes in their own node under a name nobody thought to list.
    for (const key of ['trail', 'points', 'history', 'track', 'path']) {
      expect(validate).toContain(`!newData.hasChild('${key}')`)
    }
    // Every accepted field is a number, a uid or a secret.
    expect(validate).toContain("newData.child('session_secret').isString()")
    expect(validate).toContain("newData.child('accuracy_m').isNumber()")
    expect(validate).toContain("newData.child('seq').val() >= 0")
  })

  it('reads a missing claim as null here, which is why it needs no tokenEmail()', () => {
    // The two rule languages disagree about the same expression, and the
    // difference is why firestore.rules needed a guard this file must not grow.
    // Firestore treats reading an absent key as an *evaluation error* — a rule
    // written `request.auth.token.email in [...]` refuses every anonymous Guest by
    // crashing rather than deciding, which is what `tokenEmail()` in firestore.rules
    // and the guard in storage.rules are for. The Realtime Database returns null
    // for an absent key, so `auth.token.email != null && auth.token.email == ...`
    // is an ordinary false and needs nothing beside it.
    const raw = readFileSync(join(__dirname, '../../database.rules.json'), 'utf8')
    expect(raw).not.toContain('tokenEmail')

    // Both places the claim is read guard it first, and guard it *before* the
    // comparisons rather than alongside them.
    const admins = rules.rules.live_location_admins['$uid'] as unknown as Record<string, RuleValue>
    const adminsWrite = admins['.write'] as string
    for (const rule of [read, adminsWrite]) {
      expect(rule).toContain('auth.token.email != null')
      expect(rule.indexOf('auth.token.email != null')).toBeLessThan(rule.indexOf('auth.token.email =='))
    }
  })

  it('names no server expiry anywhere, because there is none to name', () => {
    // Realtime Database has no per-node TTL on any plan. An earlier revision
    // wrote a `'.ttl'` field on every fix; a key containing `.` is rejected by
    // the client SDK before the write leaves the browser, so every fix threw.
    // Nothing in the rules may imply a server deletes a position for us.
    const raw = readFileSync(join(__dirname, '../../database.rules.json'), 'utf8')
    expect(raw).not.toMatch(/ttl|expireAt/i)
  })

  it('uses no operator the Realtime Database does not have', () => {
    // `in` is a Firestore rules operator. The Realtime Database has no list
    // membership test, so a rule using it does not compile — and when it does
    // not compile the emulator refuses to start and the rules are never
    // enforced at all. The emulator is what caught this (2026-09-30:
    // `database.rules.json:9:64`); this assertion is here so the next person
    // finds out in two seconds rather than after a 200 MB download.
    const raw = readFileSync(join(__dirname, '../../database.rules.json'), 'utf8')
    const offenders = [...raw.matchAll(/[)\s](in)\s/g)].map((m) => m[1])
    expect(offenders).toEqual([])
    // The allowlist is written as explicit comparisons, which is the only way
    // to say "one of these addresses" in this rule language.
    expect(raw).toContain("auth.token.email == 'haciendadeluisiana@gmail.com' || auth.token.email ==")
  })
})

describe('only the Admin may read a position', () => {
  it('names the same bootstrap addresses firestore.rules names', () => {
    expect(emailsIn(read)).toEqual(BOOTSTRAP_ROLES.map((r) => r.email).sort())
  })

  it('lets a Profile-promoted Admin in through a mirror the allowlist Admin writes', () => {
    // The allowlist is the anchor because it needs no document of its own to
    // exist; a role held only in a Profile cannot be read from a token, so it is
    // mirrored here by an address that is already on the list.
    expect(read).toContain("root.child('live_location_admins').child(auth.uid).val() == true")
    const admins = rules.rules.live_location_admins['$uid'] as unknown as Record<string, RuleValue>
    const adminsWrite = admins['.write'] as string
    expect(emailsIn(adminsWrite)).toEqual(BOOTSTRAP_ROLES.map((r) => r.email).sort())
    expect(admins['.read']).toBe(false)
  })

  it('refuses a signed-out reader outright', () => {
    expect(read.startsWith('auth != null &&')).toBe(true)
  })

  it('refuses a read of a position whose window has closed', () => {
    // The guarantee that replaced the server-side TTL Realtime Database never
    // had: expiry is enforced by the rules, so the position is unreadable the
    // instant `expires_at_ms` passes, whether or not anything deleted the node.
    expect(read).toContain("data.child('expires_at_ms').val() > now")
    expect(read).toContain('data.exists()')
  })

  it('grants the read on the leaf, and nowhere shallower', () => {
    // If a `.read` came back at the conversation node it would cover every guest
    // node below it and no leaf rule could take it away — which is exactly the
    // shape that makes an expired position readable.
    expect(conversationRead).toBeUndefined()
  })

  it('parenthesises the two ways in, so neither skips the auth check', () => {
    // `auth != null && a || b` parses as `(auth != null && a) || b`, which would
    // let the admins mirror be reached by a reader the guard was meant to refuse.
    const guard = read.indexOf('auth != null &&')
    const alternative = read.indexOf('||')
    expect(alternative).toBeGreaterThan(-1)
    expect(read.slice(0, alternative)).toContain('&&')
    expect(read.indexOf('(', guard)).toBeGreaterThan(-1)
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
