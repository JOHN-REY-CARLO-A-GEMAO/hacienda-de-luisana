// The Firestore rules: the enforcement that actually matters.
//
// Everything the app refuses, the rules refuse again — because a person can open
// a console and call Firestore without going through a single line of `src/`.
// There is no Firestore emulator in this repository's test run, so what is
// asserted here is the rules file itself: that it resolves a role the way
// `src/lib/auth` does, that it keeps the same bootstrap addresses, and that no
// role is ever taken from the body of a request. (activity-log.test.ts reads this
// file the same way, for the same reason.)
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BOOTSTRAP_ROLES } from '../../src/lib/auth'

const rules = readFileSync(join(__dirname, '../../firestore.rules'), 'utf8')
const storageRules = readFileSync(join(__dirname, '../../storage.rules'), 'utf8')

/** The text of a block, from its header to its matching closing brace. */
function block(source: string, header: string): string {
  const start = source.indexOf(header)
  if (start < 0) throw new Error(`the rules have no "${header}"`)
  // Past the header's own braces: `match /bookings/{bookingId}` has one in the
  // path, and counting from there would close the block before it opened.
  const open = source.indexOf('{', start + header.length)
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  throw new Error(`unbalanced braces after "${header}"`)
}

/** Whitespace flattened, so an assertion reads like the rule it checks. */
const squash = (text: string) => text.replace(/\s+/g, ' ').trim()

/**
 * One `allow …;` statement out of a block, comments removed and whitespace
 * flattened, so an assertion can quote the rule it is checking.
 */
function allow(source: string, verb: string): string {
  const statement = `allow ${verb}`
  const chunk = source
    .replace(/\/\/[^\n]*/g, ' ')
    .split(';')
    .map(squash)
    .find((candidate) => candidate.includes(statement))
  if (!chunk) throw new Error(`no "${statement}" rule found`)
  return `${squash(chunk.slice(chunk.indexOf(statement)))};`
}

function emailsIn(source: string): string[] {
  return [...source.matchAll(/'([^']+@[^']+)'/g)].map((match) => match[1])
}

const bookings = block(rules, 'match /bookings/{bookingId}')
const activity = block(bookings, 'match /activity/{entryId}')
const profiles = block(rules, 'match /profiles/{userId}')
const accessLogs = block(rules, 'match /access_logs/{logId}')
const trackingSessions = block(rules, 'match /tracking_sessions/{sessionId}')

describe('how the rules decide who is asking', () => {
  it('reads the bootstrap allowlist before the Profile, and lands on Guest', () => {
    const role = block(rules, 'function role()')
    const signedOut = role.indexOf("!isSignedIn() ? 'none'")
    const adminList = role.indexOf('adminEmails()')
    const stored = role.indexOf('storedRole()')

    // The order is the point: an allowlisted address is the Admin whatever any
    // Profile says, so the owner can never be locked out by a document.
    expect(signedOut).toBeGreaterThanOrEqual(0)
    expect(adminList).toBeGreaterThan(signedOut)
    expect(stored).toBeGreaterThan(adminList)
  })

  it('treats a missing or invented Profile role as Guest', () => {
    const stored = squash(block(rules, 'function storedRole()'))
    const known = squash(block(rules, 'function knownRole(value)'))

    expect(stored).toContain("data.get('role', 'guest')")
    expect(stored).toContain(": 'guest'")
    expect(known).toBe("function knownRole(value) { return value in ['guest', 'admin'] ? value : 'guest'; }")
  })

  it('keeps the same Admin addresses the website and the app resolve roles from', () => {
    // Three sources, one truth: if any list moves without the others, a screen
    // offers what the database refuses. The Flutter app's copy is checked by
    // its own test (test/auth_store_test.dart).
    const expected = BOOTSTRAP_ROLES.filter((entry) => entry.role === 'admin').map((entry) => entry.email)

    expect(emailsIn(block(rules, 'function adminEmails()'))).toEqual(expected)
    expect(emailsIn(block(storageRules, 'function isAdminEmail()'))).toEqual(expected)
    expect(BOOTSTRAP_ROLES.every((entry) => entry.role === 'admin')).toBe(true)
  })

  it('knows no Host or Staff role', () => {
    const code = rules.replace(/\/\/[^\n]*/g, '')
    expect(code).not.toMatch(/isHost|isStaff|hostEmails|staffEmails|'host'|'staff'/)
    const storageCode = storageRules.replace(/\/\/[^\n]*/g, '')
    expect(storageCode).not.toMatch(/isHostEmail|isAnak|staff/i)
  })

  it('never reads a role out of the body of a request', () => {
    // `request.resource.data.role` is a thing only inside the Profiles
    // collection, where the whole point of the rule is to constrain it. Anywhere
    // else it would be a client telling the database what it is.
    const outsideProfiles = rules.replace(profiles, '')
    expect(outsideProfiles).not.toContain('request.resource.data.role')
  })
})

describe('the Profiles collection', () => {
  it('lets a person write their own Profile only as a Guest', () => {
    const create = allow(profiles, 'create:')
    expect(create).toContain('isProfileShape()')
    expect(create).toContain("request.auth.uid == userId && request.resource.data.role == 'guest'")
  })

  it('lets the Admin write anybody’s, with one of the two roles and nothing else', () => {
    const create = allow(profiles, 'create:')
    const shape = squash(block(profiles, 'function isProfileShape()'))

    expect(create).toContain('|| isAdmin()')
    expect(shape).toContain("request.resource.data.role in ['guest', 'admin']")
    expect(shape).toContain("hasOnly(['uid', 'role', 'email', 'display_name', 'created_at', 'updated_at'")
    expect(shape).toContain("'terms_accepted_at'")
  })

  it('lets a person change their own name but never their own role', () => {
    const update = allow(profiles, 'update:')
    expect(update).toContain('isAdmin()')
    expect(update).toContain("'display_name'")
    expect(update).toContain("'terms_accepted_at'")
  })

  it('lets only the Admin remove a Profile, and never their own', () => {
    expect(allow(profiles, 'delete:')).toBe('allow delete: if isAdmin() && request.auth.uid != userId;')
  })

  it('is readable by its owner and by the Admin, and by nobody else', () => {
    expect(allow(profiles, 'read:')).toBe(
      'allow read: if isSignedIn() && (request.auth.uid == userId || isAdmin());',
    )
  })
})

describe('Bookings', () => {
  it('are readable by their own Guest and the Admin — not by the world', () => {
    const read = allow(bookings, 'read:')
    expect(read).toBe('allow read: if isOwnDoc() || isAdmin();')
  })

  it('still let anybody submit a Pending inquiry, but never without a Guest identity', () => {
    const create = allow(bookings, 'create:')
    expect(create).toContain("request.resource.data.status == 'Pending'")
    expect(create).toContain("hasAll(['guest_name','phone','email','check_in','check_out','guests','accommodation','status','created_at'])")
    // A Booking minted while anonymous sign-in is down is unclaimable forever,
    // so a broken console fails loud: the write is refused, not silently
    // minted (ADR-0004 consequence, amended).
    expect(create).toContain("request.resource.data.get('uid', '') != ''")
  })

  it('keeps the Admin from un-rejecting, and from skipping the two money gates', () => {
    // Three guard lines on the Admin branch: terminals never leave, Approved
    // only from a reviewed ID, Reserved only from verified money. The full
    // table lives in the two lifecycle modules (web and app).
    const update = allow(bookings, 'update:')
    expect(update).toContain(
      "!(resource.data.status in ['Rejected', 'Cancelled', 'Completed', 'Expired'] && request.resource.data.status != resource.data.status)",
    )
    expect(update).toContain(
      "!(request.resource.data.status == 'Approved' && resource.data.status != 'KYC Submitted')",
    )
    expect(update).toContain(
      "!(request.resource.data.status == 'Reserved' && resource.data.status != 'Payment Pending')",
    )
  })

  it('have no Staff branch: completing a stay is the Admin’s, like every other move', () => {
    const update = allow(bookings, 'update:')
    expect(update).not.toContain('isStaff()')
    expect(update).not.toContain("hasOnly(['status'])")
  })

  it('let the Admin move a Booking through the lifecycle, inside the guard lines, and delete', () => {
    // The Admin branch is parenthesised: the three guard lines (terminals,
    // Approved, Reserved) are checked before anything else the Admin may write.
    expect(allow(bookings, 'update:')).toContain('if (isAdmin()')
    expect(allow(bookings, 'delete:')).toBe('allow delete: if isAdmin();')
  })

  it('let a Guest move their own Booking forward or out, never backwards', () => {
    const update = allow(bookings, 'update:')
    expect(update).toContain("resource.data.get('uid', '') == request.auth.uid")
    expect(update).toContain(
      "resource.data.status in ['Pending', 'KYC Submitted'] && request.resource.data.status in ['Pending', 'KYC Submitted', 'Payment Pending', 'Cancelled']",
    )
    expect(update).toContain(
      "resource.data.status == 'Approved' && request.resource.data.status in ['Approved', 'Payment Pending', 'Cancelled']",
    )
    expect(update).toContain(
      "resource.data.status == 'Payment Pending' && request.resource.data.status in ['Payment Pending', 'Cancelled']",
    )
    expect(update).toContain(
      "resource.data.status == 'Reserved' && request.resource.data.status in ['Reserved', 'Cancelled']",
    )
    // The identity a Booking was created with is not theirs to change (ADR-0004).
    expect(update).not.toMatch(/hasOnly\(\[[^\]]*'uid'/)
  })

  it('no longer carry live location: the session is its own document (G6)', () => {
    // The pickup_* / is_live_sharing / eta_share_url family moved off the
    // Booking onto tracking_sessions, so it is no longer a key a Guest may
    // write on their own Booking.
    const update = allow(bookings, 'update:')
    for (const key of ['pickup_lat', 'pickup_lng', 'pickup_area', 'pickup_label', 'pickup_updated_at', 'distance_km', 'eta_minutes', 'is_live_sharing', 'last_speed_kmh', 'eta_share_url']) {
      expect(update, `${key} no longer rides on the Booking`).not.toContain(`'${key}'`)
    }
    // The plan's policy snapshot stays on the Booking, though.
    expect(update).toContain("'policy_version'")
    expect(update).toContain("'policy_effective_date'")
  })
})

describe('the Tracking sessions (retired — location tracker removed)', () => {
  it('refuse create, read and update for everyone', () => {
    expect(allow(trackingSessions, 'read, create, update:')).toBe('allow read, create, update: if false;')
  })

  it('let the Admin delete leftover sessions only', () => {
    expect(allow(trackingSessions, 'delete:')).toBe('allow delete: if isAdmin();')
  })
})

describe('the Activity log', () => {
  it('refuses an entry that is not written in the writer’s own name', () => {
    const create = allow(activity, 'create:')
    expect(create).toContain('request.resource.data.actor == role()')
    // A Date hold expiring is the system's doing, recorded by the Admin app;
    // a public inquiry with no identity at all can only write a Guest's.
    expect(create).toContain("request.resource.data.actor == 'system' && isAdmin()")
    expect(create).toContain("!isSignedIn() && request.resource.data.actor == 'guest'")
  })

  it('is readable by the Guest it belongs to and the Admin', () => {
    expect(allow(activity, 'read:')).toBe('allow read: if isOwnDoc() || isAdmin();')
  })

  it('is append-only, including for the Admin', () => {
    expect(allow(activity, 'update, delete:')).toBe('allow update, delete: if false;')
  })
})

describe('the Access log', () => {
  it('is read by the Admin, on the Smart Lock screen of the app', () => {
    expect(allow(accessLogs, 'read:')).toBe('allow read: if isAdmin();')
  })

  it('is corrected by the Admin alone, and written in the writer’s own name', () => {
    expect(allow(accessLogs, 'update, delete:')).toBe('allow update, delete: if isAdmin();')
    expect(allow(accessLogs, 'create:')).toContain('isSignedIn()')
    expect(allow(accessLogs, 'create:')).toContain("request.resource.data.result in ['granted', 'denied']")
    // A granted row is the Admin's check-in cue, so a row written in somebody
    // else's uid is a cue about the wrong person.
    expect(allow(accessLogs, 'create:')).toContain('request.resource.data.uid == request.auth.uid')
  })
})

describe('everything else', () => {
  it('is denied unless a rule above has spoken for it', () => {
    const fallback = block(rules, 'match /{document=**}')
    expect(squash(fallback)).toContain('allow read, write: if false;')
    // And it is the last thing in the file, so nothing can be added below it
    // that quietly widens it.
    expect(rules.lastIndexOf('match /{document=**}')).toBeGreaterThan(rules.lastIndexOf('match /site_config'))
  })

  it('keeps site images and site config (the published rates) to the Admin', () => {
    expect(allow(block(rules, 'match /gallery/{imageId}'), 'write:')).toBe('allow write: if isAdmin();')
    expect(allow(block(rules, 'match /site_config/{docId}'), 'write:')).toBe('allow write: if isAdmin();')
  })
})

describe('Storage, where the government IDs live', () => {
  it('shows an ID to the Guest it belongs to and to the Admin, and to nobody else', () => {
    const kyc = block(storageRules, 'match /kyc/{userId}/{allPaths=**}')
    expect(allow(kyc, 'read:')).toContain('request.auth.uid == userId || isAdminEmail()')
    expect(allow(kyc, 'write:')).toContain('request.auth.uid == userId')
  })

  it('lets the Admin delete on PurgeKyc, and delete only — a delete carries no resource', () => {
    // The ID's purpose ended at approval, so within 30 days after the stay the
    // Admin erases it. Storage rules have no delete verb and no way to see a
    // check-out date; `request.resource == null` is the only tell that a write
    // is a delete. The Admin still cannot upload or overwrite an ID — the
    // guest-uid write gate above is the only grant that touches a real object.
    const kyc = block(storageRules, 'match /kyc/{userId}/{allPaths=**}')
    expect(kyc).toContain('allow write: if isAdminEmail() && request.resource == null;')
    // The guest write gate must stay size- and type-checked, so it cannot be
    // the rule that accidentally lets the Admin through with a payload.
    const guestWrite = allow(kyc, 'write:')
    expect(guestWrite).toContain('request.resource.size < 5 * 1024 * 1024')
    expect(guestWrite).toContain("request.resource.contentType.matches('image/.*')")
  })

  it('shows payment proof to the Guest it belongs to and to the Admin, and to nobody else', () => {
    const payments = block(storageRules, 'match /payments/{userId}/{allPaths=**}')
    expect(allow(payments, 'read:')).toContain('request.auth.uid == userId || isAdminEmail()')
    expect(allow(payments, 'write:')).toContain('request.auth.uid == userId')
  })
})
