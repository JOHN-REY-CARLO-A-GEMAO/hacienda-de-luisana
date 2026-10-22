/**
 * Cloud availability must preserve Booking privacy without guessing.
 *
 * A Guest cannot query everybody's private `bookings` documents through the
 * browser SDK. The regional callable now performs that read and returns only
 * day states. Local Browser data must never be substituted for a failed cloud
 * read, and a failed callable must never become `available: true`.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(__dirname, '../../src/lib/firestoreBookings.ts'), 'utf8')

describe('list() in cloud mode', () => {
  it('never answers with the local store when Firestore refuses', () => {
    const list = source.slice(
      source.indexOf('async list(): Promise<Booking[]>'),
      source.indexOf('async listMine('),
    )
    const catchBlock = list.slice(list.indexOf('} catch (e) {'))
    expect(catchBlock).toContain('return []')
    expect(catchBlock).not.toContain('bookingsDB.list()')
  })
})

describe('checkAvailability', () => {
  it('uses the privacy-safe server projection and does not invent cloud availability', () => {
    const body = source.slice(
      source.indexOf('async checkAvailability('),
      source.indexOf('async materialiseExpiry('),
    )
    expect(body).toContain('await this.getAvailabilityCalendar(')
    expect(body).toContain('{ force: true }')
    expect(body).not.toContain('return { available: true, conflicts: [] }')
    // Demo mode still applies the canonical pure conflict function after the
    // cloud branch; it is not used as a cloud failure fallback.
    expect(body.indexOf('if (this.isCloud)')).toBeLessThan(body.indexOf('findDateConflicts('))
  })
})
