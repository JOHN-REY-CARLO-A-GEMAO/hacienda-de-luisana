// Actual web adapter under a controllable SDK double. Not canonical rules or
// transaction/retry evidence; local emulators have a separate companion.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sdk, putCloud, documentSnapshot, resetCloudDouble, lostResponseThenRetry, lastUnitSchedule } from './doubles/cloud'
import { cloudBookingsDB, activityLogDB, lastCloudWriteFailure } from '../../src/lib/firestoreBookings'
import { bookingsDB, activityLogStorage } from '../../src/lib/storage'
import { booking, actor, request, NOW, scenarios } from './fixtures'

beforeEach(resetCloudDouble)

describe('deterministic actual-adapter race schedule, SDK double', () => {
  it('F06-LAST-UNIT: a fresh Approved rival is read but ignored after a stale outside-transaction query', async () => {
    const a = booking()
    const b = booking({ id: 'phase0-booking-b', uid: scenarios.identities.secondGuest.uid })
    const observed = await lastUnitSchedule(cloudBookingsDB, a, b, actor(), actor('adminB'))
    expect(observed.results.map(result => result.ok)).toEqual([true, true])
    expect(observed.approvedCount).toBe(2)
    expect(sdk.transactionReads).toContainEqual({ path: `bookings/${a.id}`, data: expect.objectContaining({ status: 'Approved' }) })
  })
})

describe('cloud response versus local persistence is observable', () => {
  it('F12/F13-CLOUD-SUCCESS: a successful create returns cloud and does not insert a local Booking', async () => {
    const result = await cloudBookingsDB.add(request(), actor('anonymousGuest'))
    expect(result).toMatchObject({ status: 'Pending', storage: 'cloud' })
    expect(localStorage.getItem('hdl:bookings')).toBeNull()
    expect(lastCloudWriteFailure()).toBeNull()
    expect(sdk.records.get(`bookings/${result.id}/activity/0`)).toMatchObject({ action: 'Submit', actor_id: scenarios.identities.anonymousGuest.uid })
  })
  it.each(['permission-denied', 'unauthenticated'])('F13-CREATE-DENIAL-CONTROL: %s is not replayed as a local booking', async code => {
    sdk.addDoc.mockRejectedValue(Object.assign(new Error('synthetic server denial'), { code }))
    await expect(cloudBookingsDB.add(request())).rejects.toThrow('could not be submitted')
    expect(localStorage.getItem('hdl:bookings')).toBeNull()
  })
  it('F13-NONDECISION-PATCH: a cloud permission refusal still resolves and mutates a browser-local record', async () => {
    const state = booking()
    putCloud(state)
    localStorage.setItem('hdl:bookings', JSON.stringify([state]))
    sdk.updateDoc.mockRejectedValue(Object.assign(new Error('synthetic denial'), { code: 'permission-denied' }))
    await expect(cloudBookingsDB.update(state.id, { amount_due: 1 })).resolves.toBeUndefined()
    expect(sdk.records.get(`bookings/${state.id}`)?.amount_due).toBe(12000)
    expect(bookingsDB.get(state.id)?.amount_due).toBe(1)
    expect(lastCloudWriteFailure()?.code).toBe('permission-denied')
  })
  it('F13-DECISION-PATCH-CONTROL: refused approval-like writes already throw instead of fabricating a local approval', async () => {
    const state = booking(); putCloud(state)
    localStorage.setItem('hdl:bookings', JSON.stringify([state]))
    sdk.updateDoc.mockRejectedValue(Object.assign(new Error('synthetic denied decision'), { code: 'permission-denied' }))
    await expect(cloudBookingsDB.update(state.id, { status: 'Approved' })).rejects.toMatchObject({ code: 'permission-denied' })
    expect(bookingsDB.get(state.id)?.status).toBe('Pending')
  })
  it('F14-EMPTY-CONTROL: valid empty cloud list stays empty even with local demo data', async () => {
    localStorage.setItem('hdl:bookings', JSON.stringify([booking()]))
    expect(await cloudBookingsDB.list()).toEqual([])
  })
  it('F14-LIST-DENIAL: web list collapses permission failure into an indistinguishable empty result', async () => {
    sdk.getDocs.mockRejectedValue(Object.assign(new Error('synthetic query denial'), { code: 'permission-denied' }))
    expect(await cloudBookingsDB.list()).toEqual([])
  })
  it('F14-LISTENER-DENIAL: a failed cloud subscription emits built-in demo records, not a valid empty snapshot', () => {
    const next = vi.fn(); const error = vi.fn()
    cloudBookingsDB.subscribe(next, error)
    sdk.listeners[0].error(Object.assign(new Error('synthetic denial'), { code: 'permission-denied' }))
    expect(error).toHaveBeenCalled()
    expect(next.mock.calls[0][0].map((state: { id: string }) => state.id)).toContain('book-sample-1')
  })
  it('F14-MALFORMED-WEB-DATA: web parser passes a nonnumeric guest count rather than quarantining the document', async () => {
    sdk.records.set('bookings/phase0-malformed', { ...booking(), guests: 'malformed-synthetic-count' })
    const list = await cloudBookingsDB.list()
    expect(list[0].guests).toBe('malformed-synthetic-count')
    // Dart whole-list fallback is a separate native test, not inferred here.
  })
  it('F14-DEMO-EMPTY: explicitly empty local persistence repopulates samples on read', () => {
    localStorage.setItem('hdl:bookings', '[]')
    expect(bookingsDB.list().map(state => state.id)).toContain('book-sample-1')
  })
  it('F13-REFRESH: local success after denied mutation does not become server success on a later read', async () => {
    const state = booking(); putCloud(state)
    localStorage.setItem('hdl:bookings', JSON.stringify([state]))
    sdk.updateDoc.mockRejectedValue(Object.assign(new Error('synthetic refusal'), { code: 'permission-denied' }))
    await cloudBookingsDB.update(state.id, { amount_due: 1 })
    sdk.getDoc.mockImplementation(async ref => documentSnapshot(ref.path))
    expect((await cloudBookingsDB.get(state.id))?.amount_due).toBe(12000)
    expect(bookingsDB.get(state.id)?.amount_due).toBe(1)
  })
})

describe('retry, unknown commit and Activity side effects', () => {
  it('F17-LOST-RESPONSE: cloud commit followed by a lost response creates local copy; retry creates a second cloud Booking', async () => {
    const result = await lostResponseThenRetry(() => cloudBookingsDB.add(request(), actor('anonymousGuest')))
    expect(result.first).toMatchObject({ storage: 'local', status: 'Pending' })
    expect(result.second).toMatchObject({ storage: 'cloud', status: 'Pending' })
    expect(result.cloudCount).toBe(2)
    expect(bookingsDB.list().filter(state => state.guest_name === scenarios.booking.guest_name)).toHaveLength(1)
  })
  it('F17-DOUBLE-SUBMIT: identical requests have distinct generated document identities', async () => {
    const results = await Promise.all([cloudBookingsDB.add(request()), cloudBookingsDB.add(request())])
    expect(new Set(results.map(result => result.id)).size).toBe(2)
    expect([...sdk.records.keys()].filter(path => /^bookings\/[^/]+$/.test(path))).toHaveLength(2)
  })
  it('F18-ANCILLARY-FAILURE: create succeeds while cloud Activity failure is silently recorded only locally', async () => {
    sdk.runTransaction.mockRejectedValue(Object.assign(new Error('synthetic Activity denial'), { code: 'permission-denied' }))
    const result = await cloudBookingsDB.add(request(), actor('anonymousGuest'))
    expect(result.storage).toBe('cloud')
    expect(sdk.records.has(`bookings/${result.id}`)).toBe(true)
    expect(sdk.records.has(`bookings/${result.id}/activity/0`)).toBe(false)
    expect(activityLogStorage.list(result.id)).toMatchObject([{ action: 'Submit', actor_id: scenarios.identities.anonymousGuest.uid }])
    expect(lastCloudWriteFailure()).toBeNull()
  })
  it('F18-CLIENT-SIGNATURE: Activity actor binding uses the connected UID, not caller-supplied impersonation', async () => {
    await activityLogDB.append([{ booking_id: booking().id, action: 'Cancel', from_status: 'Pending', to_status: 'Cancelled', actor: 'guest', actor_id: 'phase0-forged-uid', at: NOW }])
    expect(sdk.records.get(`bookings/${booking().id}/activity/0`)?.actor_id).toBe(scenarios.identities.anonymousGuest.uid)
  })
})
