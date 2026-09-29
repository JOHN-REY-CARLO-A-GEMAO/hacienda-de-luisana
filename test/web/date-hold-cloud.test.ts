/**
 * A Guest must never be refused their own dates.
 *
 * `checkAvailability` read `list()`, and in cloud mode that query is *always*
 * refused for a Guest - `firestore.rules` allows a read only when `isOwnDoc()`
 * (their own Booking) or `isAdmin()`, and `isOwnDoc()` is per-document, so an
 * unscoped collection query cannot be authorised for a Guest. `list()` therefore
 * always took its fallback branch and answered with whatever that one browser
 * happened to be holding. A Guest was then told their dates were held by a
 * Booking no other Guest can see, including fixtures the test suite wrote into
 * localStorage before `vitest.config.ts` was made hermetic.
 *
 * The real gate is the Admin re-check, run inside the approval transaction
 * (G2, ADR-0006). The demo-mode half of the decision is covered behaviourally
 * in `date-hold.test.ts` ("makes the dates unavailable to another Guest the
 * moment they are held"), which is why nothing is repeated here.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(__dirname, '../../src/lib/firestoreBookings.ts'), 'utf8')

describe('list() in cloud mode', () => {
  // Asserted against the source, because `isCloud` is fixed at module load
  // (`isFirebaseConfigured && Boolean(db)`) so the cloud branch cannot be reached
  // from a test. What is worth pinning is that the fallback is gone: it is the
  // thing that made a Guest's own booking look like somebody else's claim.
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
  it('short-circuits in cloud mode rather than inventing a conflict', () => {
    const body = source.slice(
      source.indexOf('async checkAvailability('),
      source.indexOf('async materialiseExpiry('),
    )
    expect(body).toMatch(/if \(this\.isCloud\) return \{ available: true, conflicts: \[\] \}/)
    // And it must reach the real check *after* that guard, not instead of it.
    expect(body.indexOf('if (this.isCloud)')).toBeLessThan(body.indexOf('findDateConflicts('))
  })
})
