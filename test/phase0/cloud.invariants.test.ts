import { beforeEach, expect, it } from 'vitest'
import { sdk, putCloud, resetCloudDouble, lostResponseThenRetry, lastUnitSchedule } from './doubles/cloud'
import { cloudBookingsDB } from '../../src/lib/firestoreBookings'
import { booking, actor, request } from './fixtures'

beforeEach(resetCloudDouble)
it('F06 DESIRED: last-unit schedule has exactly one committed approval', async () => {
  const observed = await lastUnitSchedule(cloudBookingsDB, booking(), booking({ id: 'phase0-booking-b' }), actor(), actor('adminB'))
  expect(observed.approvedCount).toBe(1)
})
it('F13 DESIRED: a denied cloud mutation is not reported as success', async () => {
  const state = booking(); putCloud(state)
  localStorage.setItem('hdl:bookings', JSON.stringify([state]))
  sdk.updateDoc.mockRejectedValue(Object.assign(new Error('synthetic refusal'), { code: 'permission-denied' }))
  await expect(cloudBookingsDB.update(state.id, { amount_due: 1 })).rejects.toMatchObject({ code: 'permission-denied' })
})
it('F14 DESIRED: a failed cloud subscription does not emit demonstration bookings', () => {
  const emitted: unknown[] = []
  cloudBookingsDB.subscribe(list => emitted.push(list))
  sdk.listeners[0].error(Object.assign(new Error('synthetic denial'), { code: 'permission-denied' }))
  expect(emitted).toEqual([])
})
it('F17 DESIRED: retry after unknown commit identifies the original request instead of a second cloud Booking', async () => {
  const result = await lostResponseThenRetry(() => cloudBookingsDB.add(request(), actor('anonymousGuest')))
  expect(result.cloudCount).toBe(1)
})
it('F17 DESIRED: duplicate submission of one intent cannot create two authoritative request identities', async () => {
  const results = await Promise.all([cloudBookingsDB.add(request()), cloudBookingsDB.add(request())])
  expect(new Set(results.map(result => result.id)).size).toBe(1)
})
