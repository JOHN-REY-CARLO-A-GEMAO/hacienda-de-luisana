// Approval-protocol invariants, exercised through the actual web adapter on a
// controllable SDK double (booking capacity correctness, 2026-10-12).
//
// The emulator companions in test/phase0/emulator/concurrency.*.test.ts are the
// canonical evidence — real Firestore, real conflicts. These pin the parts of
// the protocol that are about *order* and *bounds* rather than about Firestore's
// conflict detection, which a double does not model and should not pretend to.
import { beforeEach, expect, it } from 'vitest'
import { sdk, putCloud, resetCloudDouble, documentSnapshot } from './doubles/cloud'
import { cloudBookingsDB, MAX_APPROVAL_SNAPSHOT_ATTEMPTS } from '../../src/lib/firestoreBookings'
import { booking, actor, scenarios } from './fixtures'

const LOCK = 'site_config/approval_lock_main-house'
const approve = (unitsAvailable?: number) =>
  ({
    type: 'Approve',
    availability: unitsAvailable === undefined ? { bookings: [] } : { bookings: [], unitsAvailable },
  }) as const

beforeEach(resetCloudDouble)

it('F06 DESIRED: the Accommodation lock version is read BEFORE the availability query', async () => {
  // Load-bearing order, and the one a well-meaning refactor breaks: a version
  // read after the query cannot see a rival approved inside the gap.
  const state = booking()
  putCloud(state)
  await cloudBookingsDB.transitionApprove(state.id, approve(1), actor())

  const lockRead = sdk.getDoc.mock.calls.findIndex(args => String(args[0].path) === LOCK)
  const firstQuery = sdk.getDocs.mock.calls.findIndex(args => String(args[0].path) === 'bookings')
  expect(lockRead).toBeGreaterThanOrEqual(0)
  expect(firstQuery).toBeGreaterThanOrEqual(0)
  expect(sdk.getDoc.mock.invocationCallOrder[lockRead]).toBeLessThan(sdk.getDocs.mock.invocationCallOrder[firstQuery])
})

it('F06 DESIRED: an accepted approval bumps the Accommodation lock version', async () => {
  const state = booking()
  putCloud(state)
  const result = await cloudBookingsDB.transitionApprove(state.id, approve(1), actor())
  expect(result.ok).toBe(true)
  expect(sdk.records.get(LOCK)).toMatchObject({ accommodation: 'main-house', version: 1 })
})

it('F06 DESIRED: a stale snapshot is discarded and the availability query is re-run', async () => {
  const state = booking()
  putCloud(state)
  sdk.records.set(LOCK, { accommodation: 'main-house', version: 4 })
  // The non-transactional version read is pinned behind the stored one, so the
  // first attempt looks stale; the second reads it truthfully and proceeds.
  let first = true
  sdk.getDoc.mockImplementation(async (ref: { path: string }) => {
    if (String(ref.path) === LOCK && first) {
      first = false
      return { exists: () => true, data: () => ({ accommodation: 'main-house', version: 3 }) } as ReturnType<typeof documentSnapshot>
    }
    return documentSnapshot(ref.path)
  })

  const result = await cloudBookingsDB.transitionApprove(state.id, approve(1), actor())
  expect(result.ok).toBe(true)
  expect(sdk.records.get(LOCK)).toMatchObject({ version: 5 })
})

it('F06 DESIRED: an approval that can never reach a stable snapshot refuses, does not throw, and is bounded', async () => {
  const state = booking()
  putCloud(state)
  sdk.records.set(LOCK, { accommodation: 'main-house', version: 7 })
  sdk.getDoc.mockImplementation(async (ref: { path: string }) =>
    String(ref.path) === LOCK
      ? ({ exists: () => true, data: () => ({ accommodation: 'main-house', version: 0 }) } as ReturnType<typeof documentSnapshot>)
      : documentSnapshot(ref.path))

  const result = await cloudBookingsDB.transitionApprove(state.id, approve(1), actor())
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.reason).toMatch(/Nothing was approved/)
  expect(sdk.getDocs).toHaveBeenCalledTimes(MAX_APPROVAL_SNAPSHOT_ATTEMPTS)
  // Refused, so nothing was written and nothing was logged.
  expect(sdk.records.get(`bookings/${state.id}`)?.status).toBe('Pending')
})

it.each([
  ['an inflated 999', 999],
  ['a malformed figure', 'many' as unknown as number],
  ['no figure at all', undefined],
])('F06 DESIRED: a caller claiming %s cannot buy a second unit of a one-unit Accommodation', async (_label, claimed) => {
  const first = booking()
  const second = booking({ id: 'phase0-booking-b', uid: scenarios.identities.secondGuest.uid })
  putCloud(first)
  putCloud(second)

  const one = await cloudBookingsDB.transitionApprove(first.id, approve(claimed), actor())
  const two = await cloudBookingsDB.transitionApprove(second.id, approve(claimed), actor())

  expect(one.ok).toBe(true)
  expect(two.ok).toBe(false)
  if (!two.ok) expect(two.conflicts?.map(conflict => conflict.id)).toEqual([first.id])
  expect(sdk.records.get(`bookings/${second.id}`)?.status).toBe('Pending')
})

it('F06 DESIRED: the published rates document, not the caller, decides how many units exist', async () => {
  const first = booking({ accommodation: 'house-a-camping' })
  const second = booking({ id: 'phase0-booking-b', uid: scenarios.identities.secondGuest.uid, accommodation: 'house-a-camping' })
  const third = booking({ id: 'phase0-booking-c', uid: scenarios.identities.secondGuest.uid, accommodation: 'house-a-camping' })
  for (const state of [first, second, third]) putCloud(state)
  // The Admin publishes one unit for the A-House, overriding the catalogue's two.
  sdk.records.set('site_config/rates', { version: 'test', accommodations: { 'house-a-camping': { available_units: 1 } } })

  expect((await cloudBookingsDB.transitionApprove(first.id, approve(999), actor())).ok).toBe(true)
  expect((await cloudBookingsDB.transitionApprove(second.id, approve(999), actor())).ok).toBe(false)
  expect((await cloudBookingsDB.transitionApprove(third.id, approve(999), actor())).ok).toBe(false)
})

it('F06 DESIRED: a malformed published capacity falls back to the catalogue, never to the caller', async () => {
  const first = booking({ accommodation: 'house-a-camping' })
  const second = booking({ id: 'phase0-booking-b', uid: scenarios.identities.secondGuest.uid, accommodation: 'house-a-camping' })
  const third = booking({ id: 'phase0-booking-c', uid: scenarios.identities.secondGuest.uid, accommodation: 'house-a-camping' })
  for (const state of [first, second, third]) putCloud(state)
  // Not a whole number, and below one: both are refused by the publication rule
  // and both must fall through to the catalogue rather than open the door.
  sdk.records.set('site_config/rates', { version: 'test', accommodations: { 'house-a-camping': { available_units: 'two' } } })

  expect((await cloudBookingsDB.transitionApprove(first.id, approve(999), actor())).ok).toBe(true)
  expect((await cloudBookingsDB.transitionApprove(second.id, approve(999), actor())).ok).toBe(true)
  expect((await cloudBookingsDB.transitionApprove(third.id, approve(999), actor())).ok).toBe(false)
})