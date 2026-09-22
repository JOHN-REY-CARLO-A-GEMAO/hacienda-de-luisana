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

describe('how the rules decide who is asking', () => {
  it('reads the bootstrap allowlist before the Profile, and lands on Guest', () => {
    const role = block(rules, 'function role()')
    const signedOut = role.indexOf("!isSignedIn() ? 'none'")
    const hostList = role.indexOf('hostEmails()')
    const staffList = role.indexOf('staffEmails()')
    const stored = role.indexOf('storedRole()')

    // The order is the point: an allowlisted address is the Host whatever any
    // Profile says, so the owner can never be locked out by a document.
    expect(signedOut).toBeGreaterThanOrEqual(0)
    expect(hostList).toBeGreaterThan(signedOut)
    expect(staffList).toBeGreaterThan(hostList)
    expect(stored).toBeGreaterThan(staffList)
  })

  it('treats a missing or invented Profile role as Guest', () => {
    const stored = squash(block(rules, 'function storedRole()'))
    const known = squash(block(rules, 'function knownRole(value)'))

    expect(stored).toContain("data.get('role', 'guest')")
    expect(stored).toContain(": 'guest'")
    expect(known).toBe("function knownRole(value) { return value in ['guest', 'host', 'staff'] ? value : 'guest'; }")
  })

  it('keeps the same two addresses the app resolves roles from', () => {
    // Two sources, one truth: if either list moves without the other, the pages
    // offer what the database refuses.
    const expected = (role: string) => BOOTSTRAP_ROLES.filter((entry) => entry.role === role).map((entry) => entry.email)

    expect(emailsIn(block(rules, 'function hostEmails()'))).toEqual(expected('host'))
    expect(emailsIn(block(rules, 'function staffEmails()'))).toEqual(expected('staff'))
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

  it('lets the Host write anybody’s, with one of the three roles and nothing else', () => {
    const create = allow(profiles, 'create:')
    const shape = squash(block(profiles, 'function isProfileShape()'))

    expect(create).toContain('|| isHost()')
    expect(shape).toContain("request.resource.data.role in ['guest', 'host', 'staff']")
    expect(shape).toContain(
      "hasOnly(['uid', 'role', 'email', 'display_name', 'created_at', 'updated_at'])",
    )
  })

  it('lets a person change their own name but never their own role', () => {
    const update = allow(profiles, 'update:')
    expect(update).toContain('isHost()')
    expect(update).toContain("hasOnly(['display_name', 'email', 'updated_at'])")
  })

  it('lets only the Host remove a Profile, and never their own', () => {
    expect(allow(profiles, 'delete:')).toBe('allow delete: if isHost() && request.auth.uid != userId;')
  })

  it('is readable by its owner and by the Host, and by nobody else', () => {
    expect(allow(profiles, 'read:')).toBe(
      'allow read: if isSignedIn() && (request.auth.uid == userId || isHost());',
    )
  })
})

describe('Bookings', () => {
  it('are readable by their own Guest, the Host and Staff — not by the world', () => {
    const read = allow(bookings, 'read:')
    expect(read).toBe('allow read: if isOwnDoc() || isHost() || isStaff();')
  })

  it('still let anybody submit a Pending inquiry, and nothing else', () => {
    const create = allow(bookings, 'create:')
    expect(create).toContain("request.resource.data.status == 'Pending'")
    expect(create).toContain("hasAll(['guest_name','phone','email','check_in','check_out','guests','accommodation','status','created_at'])")
  })

  it('give Staff exactly one move: a checked-out stay becomes Completed', () => {
    const update = allow(bookings, 'update:')
    expect(update).toContain("isStaff() && resource.data.status == 'Checked-Out' && request.resource.data.status == 'Completed'")
    expect(update).toContain("hasOnly(['status'])")
  })

  it('let the Host do anything, and delete', () => {
    expect(allow(bookings, 'update:')).toContain('if isHost()')
    expect(allow(bookings, 'delete:')).toBe('allow delete: if isHost();')
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

  it('let a Guest share their own location, which is what /track writes', () => {
    const update = allow(bookings, 'update:')
    for (const key of ['pickup_lat', 'pickup_lng', 'pickup_area', 'distance_km', 'eta_minutes', 'is_live_sharing']) {
      expect(update, `${key} is a Guest's own to write`).toContain(`'${key}'`)
    }
  })
})

describe('the Activity log', () => {
  it('refuses an entry that is not written in the writer’s own name', () => {
    const create = allow(activity, 'create:')
    expect(create).toContain('request.resource.data.actor == role()')
    // A Date hold expiring is the system's doing, recorded by a Host or Staff
    // surface; a public inquiry with no identity at all can only write a Guest's.
    expect(create).toContain("request.resource.data.actor == 'system' && (isHost() || isStaff())")
    expect(create).toContain("!isSignedIn() && request.resource.data.actor == 'guest'")
  })

  it('is readable by the Guest it belongs to, the Host and Staff', () => {
    expect(allow(activity, 'read:')).toBe('allow read: if isOwnDoc() || isHost() || isStaff();')
  })

  it('is append-only, including for the Host', () => {
    expect(allow(activity, 'update, delete:')).toBe('allow update, delete: if false;')
  })
})

describe('the Access log', () => {
  it('is read by the Host and by Staff, because locks are Staff work', () => {
    expect(allow(accessLogs, 'read:')).toBe('allow read: if isHost() || isStaff();')
  })

  it('is corrected by the Host alone, and written by any signed-in client', () => {
    expect(allow(accessLogs, 'update, delete:')).toBe('allow update, delete: if isHost();')
    expect(allow(accessLogs, 'create:')).toContain('isSignedIn()')
    expect(allow(accessLogs, 'create:')).toContain("request.resource.data.result in ['granted', 'denied']")
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

  it('keeps site images and site config to the Host', () => {
    expect(allow(block(rules, 'match /gallery/{imageId}'), 'write:')).toBe('allow write: if isHost();')
    expect(allow(block(rules, 'match /site_config/{docId}'), 'write:')).toBe('allow write: if isHost();')
  })
})

describe('Storage, where the government IDs live', () => {
  it('shows an ID to the Guest it belongs to and to the Host, and to nobody else', () => {
    const kyc = block(storageRules, 'match /kyc/{userId}/{allPaths=**}')
    expect(allow(kyc, 'read:')).toContain('request.auth.uid == userId || isHostEmail()')
    expect(allow(kyc, 'write:')).toContain('request.auth.uid == userId')
  })

  it('has no Staff address in it at all — the absence is the decision', () => {
    expect(storageRules).not.toContain('isAnak')
    expect(storageRules).not.toMatch(/function\s+staffEmails/)
    // The one Staff address the Firestore rules know is not granted anything here.
    const staffAddress = BOOTSTRAP_ROLES.find((entry) => entry.role === 'staff')?.email ?? ''
    const code = storageRules.replace(/\/\/.*$/gm, '')
    expect(code).not.toContain(staffAddress)
  })
})
