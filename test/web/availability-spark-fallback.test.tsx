import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OFFICIAL_ACCOMMODATION_RATES } from '../../src/config/officialBusiness'
import { bookingsDB } from '../../src/lib/storage'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mockState = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  bookings: new Map<string, Record<string, unknown>>(),
  addedBookings: [] as Array<{ id: string; data: Record<string, unknown> }>,
  addedActivities: [] as Array<{ path: string; data: Record<string, unknown> }>,
  currentUid: 'guest-j' as string | null,
  policyOffline: false,
  callableHandlers: new Map<string, (input: unknown) => Promise<{ data: unknown }>>(),
}))

vi.mock('../../src/lib/firebase', () => ({
  app: { sparkAppMock: true },
  db: { sparkCloudMock: true },
  auth: {
    get currentUser() {
      return mockState.currentUid ? { uid: mockState.currentUid, isAnonymous: false } : null
    },
  },
  isFirebaseConfigured: true,
  isUsingEmulators: false,
  googleProvider: null,
}))

vi.mock('firebase/functions', () => ({
  getFunctions: () => ({ sparkFunctionsMock: true }),
  httpsCallable: (_fns: unknown, name: string) => (input: unknown) => {
    const handler = mockState.callableHandlers.get(name)
    if (!handler) {
      return Promise.reject(Object.assign(new Error('internal'), { code: 'functions/internal' }))
    }
    return handler(input)
  },
}))

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ kind: 'collection', path: segments.join('/') }),
  doc: (first: unknown, ...segments: string[]) => ({
    kind: 'doc',
    path:
      typeof first === 'object' && first !== null && 'path' in first
        ? [String((first as { path: string }).path), ...segments, 'auto-doc-id'].join('/')
        : segments.join('/'),
  }),
  where: (field: string, op: string, value: unknown) => ({ kind: 'where', field, op, value }),
  orderBy: (field: string, dir = 'asc') => ({ kind: 'orderBy', field, dir }),
  query: (target: { path: string }, ...constraints: Array<Record<string, unknown>>) => ({
    kind: 'query',
    path: target.path,
    constraints,
  }),
  serverTimestamp: () => '2026-10-22T05:38:00.000Z',
  Timestamp: class MockTimestamp {
    toDate() { return new Date('2026-10-22T05:38:00.000Z') }
  },
  getDocFromServer: async (ref: { path: string }) => {
    if (mockState.policyOffline) {
      throw Object.assign(new Error('Failed to get document because the client is offline.'), {
        code: 'unavailable',
      })
    }
    const found = mockState.docs.get(ref.path)
    return {
      exists: () => Boolean(found),
      data: () => (found ? structuredClone(found) : undefined),
    }
  },
  getDoc: async (ref: { path: string }) => {
    if (ref.path.startsWith('bookings/')) {
      const id = ref.path.slice('bookings/'.length)
      const found = mockState.bookings.get(id)
      return {
        id,
        exists: () => Boolean(found),
        data: () => (found ? structuredClone(found) : undefined),
      }
    }
    const found = mockState.docs.get(ref.path)
    return {
      id: ref.path.split('/').pop() ?? '',
      exists: () => Boolean(found),
      data: () => (found ? structuredClone(found) : undefined),
    }
  },
  getDocs: async (target: { path: string; constraints?: Array<Record<string, unknown>> }) => {
    if (mockState.policyOffline) {
      throw Object.assign(new Error('offline'), { code: 'unavailable' })
    }
    if (target.path !== 'bookings') return { docs: [] }
    const uidFilter = target.constraints?.find((c) => c.kind === 'where' && c.field === 'uid')
    const rows = [...mockState.bookings.entries()].filter(([, value]) => {
      if (!uidFilter) return true
      return value.uid === uidFilter.value
    })
    return {
      docs: rows.map(([id, data]) => ({
        id,
        data: () => structuredClone(data),
      })),
    }
  },
  addDoc: async (target: { path: string }, data: Record<string, unknown>) => {
    if (target.path === 'bookings') {
      const id = `spark-booking-${mockState.addedBookings.length + 1}`
      const stored = structuredClone(data)
      mockState.addedBookings.push({ id, data: stored })
      mockState.bookings.set(id, stored)
      return { id }
    }
    const id = `spark-doc-${mockState.addedActivities.length + 1}`
    mockState.addedActivities.push({ path: target.path, data: structuredClone(data) })
    return { id }
  },
  runTransaction: async (_db: unknown, updateFn: (tx: Record<string, unknown>) => Promise<unknown>) =>
    updateFn({
      get: async (ref: { path: string }) => {
        const found = mockState.docs.get(ref.path)
        return {
          exists: () => Boolean(found),
          data: () => (found ? structuredClone(found) : undefined),
        }
      },
      set: (ref: { path: string }, data: Record<string, unknown>) => {
        if (ref.path.includes('/activity')) {
          mockState.addedActivities.push({ path: ref.path, data: structuredClone(data) })
        } else {
          mockState.docs.set(ref.path, structuredClone(data))
        }
      },
      update: (ref: { path: string }, patch: Record<string, unknown>) => {
        const current = mockState.docs.get(ref.path) ?? {}
        mockState.docs.set(ref.path, { ...structuredClone(current), ...structuredClone(patch) })
      },
    }),
  setDoc: async () => undefined,
  updateDoc: async () => undefined,
  deleteDoc: async () => undefined,
  onSnapshot: () => () => undefined,
}))

import type { PublishedRefundPolicy } from '../../src/lib/booking/rates'
import { AvailabilityCalendar } from '../../src/components/Booking/AvailabilityCalendar'
import { AvailabilityUnavailableError, clearAvailabilityCache } from '../../src/lib/availabilityApi'
import { cloudBookingsDB } from '../../src/lib/firestoreBookings'

const SCREENSHOT_NOW = '2026-10-22T05:38:00.000Z'

const PUBLISHED_REFUND_POLICY: PublishedRefundPolicy = {
  tiers: [
    { min_days_before_check_in: 30, refund_percent: 100 },
    { min_days_before_check_in: 14, refund_percent: 50 },
    { min_days_before_check_in: 0, refund_percent: 0 },
  ],
  deposit_refund_percent: 100,
}

function seedPublishedRatesWithoutExplicitUnits() {
  const accommodations = Object.fromEntries(
    Object.entries(OFFICIAL_ACCOMMODATION_RATES).map(([id, rate]) => [
      id,
      structuredClone({ ...rate, security_deposit: 1000 }) as Record<string, unknown>,
    ]),
  )
  // Live Spark `site_config/rates` published before PR #88 may omit optional `available_units`.
  delete accommodations['main-house'].available_units
  mockState.docs.set('site_config/rates', {
    version: 'official-v2',
    effective_date: '2026-10-04',
    holiday_dates: [],
    refund: structuredClone(PUBLISHED_REFUND_POLICY),
    accommodations,
  })
}

async function flush() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

describe('Spark / undeployed Cloud Functions availability and Guest submission fallback', () => {
  let host: HTMLDivElement | null = null
  let root: Root | null = null
  const refundPolicy = PUBLISHED_REFUND_POLICY

  beforeEach(() => {
    mockState.docs.clear()
    mockState.bookings.clear()
    mockState.addedBookings.length = 0
    mockState.addedActivities.length = 0
    mockState.callableHandlers.clear()
    mockState.currentUid = 'guest-j'
    mockState.policyOffline = false
    clearAvailabilityCache()
    window.localStorage.clear()
    seedPublishedRatesWithoutExplicitUnits()
    // The 24-hour Date hold is read-time, so pin "now" to the instant these
    // fixtures were written; otherwise the suite starts failing one day later.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(SCREENSHOT_NOW))
  })

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
      root = null
    }
    host?.remove()
    host = null
    vi.useRealTimers()
  })

  it('renders selectable November 2026 Main House dates instead of Availability unknown when Cloud Functions are undeployed on Spark', async () => {
    const onChange = vi.fn()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)

    await act(async () => {
      root!.render(
        <AvailabilityCalendar
          accommodation="main-house"
          accommodationName="The Main House"
          earliestCheckIn="2026-11-21"
          checkIn=""
          checkOut=""
          onChange={onChange}
        />,
      )
    })
    await flush()

    expect(host.textContent).toContain('November 2026')
    expect(host.textContent).not.toContain('Availability unknown.')
    expect(host.textContent).not.toContain('Availability could not be confirmed right now.')

    const nov20 = host.querySelector('[data-date="2026-11-20"]') as HTMLButtonElement | null
    const nov21 = host.querySelector('[data-date="2026-11-21"]') as HTMLButtonElement | null
    expect(nov20?.disabled).toBe(true)
    expect(nov20?.getAttribute('data-availability')).toBe('invalid')
    expect(nov21?.disabled).toBe(false)
    expect(nov21?.getAttribute('data-availability')).toBe('available')

    await act(async () => {
      nov21!.click()
    })
    expect(onChange).toHaveBeenLastCalledWith('2026-11-21', '')

    await act(async () => {
      root!.render(
        <AvailabilityCalendar
          accommodation="main-house"
          accommodationName="The Main House"
          earliestCheckIn="2026-11-21"
          checkIn="2026-11-21"
          checkOut=""
          onChange={onChange}
        />,
      )
    })
    await flush()
    const nov22 = host.querySelector('[data-date="2026-11-22"]') as HTMLButtonElement
    await act(async () => {
      nov22.click()
    })
    expect(onChange).toHaveBeenLastCalledWith('2026-11-21', '2026-11-22')
  })

  it('submits a signed-in Guest web booking via direct Firestore write on Spark and immediately reflects the 24-hour hold', async () => {
    const submitted = await cloudBookingsDB.add(
      {
        ref_id: 'HDL-SPARK-001',
        uid: 'guest-j',
        source: 'web',
        guest_name: 'Juan Dela Cruz',
        phone: '09171234567',
        email: 'juan@example.com',
        guests: 4,
        accommodation: 'main-house',
        special_requests: '',
        check_in: '2026-11-25',
        check_out: '2026-11-26',
        nights: 1,
        rate_amount: 5000,
        rate_unit: 'standard_stay',
        rate_classification: 'weekday',
        stay_total: 5000,
        amount_due: 2500,
        security_deposit: 1000,
        balance_due: 2500,
        policy_version: 'official-v2',
        policy_effective_date: '2026-10-04',
        refund_policy_snapshot: structuredClone(refundPolicy),
        payment_plan: 'down-payment',
        payment_proof_url: 'payments/guest-j/HDL-SPARK-001/proof-1.png',
        payment_reference: 'GCASH-998877',
        amount_claimed: 2500,
      },
      { actor: 'guest', actor_id: 'guest-j', now: SCREENSHOT_NOW },
    )

    expect(submitted.storage).toBe('cloud')
    expect(mockState.addedBookings).toHaveLength(1)
    expect(mockState.addedActivities.length).toBeGreaterThanOrEqual(1)
    expect(bookingsDB.list().some((b) => b.ref_id === 'HDL-SPARK-001')).toBe(false)

    const calendar = await cloudBookingsDB.getAvailabilityCalendar(
      { accommodation: 'main-house', from: '2026-11-01', to: '2026-12-01' },
      { now: SCREENSHOT_NOW },
    )
    expect(calendar.days.find((d) => d.date === '2026-11-25')?.state).toBe('pending')

    const conflict = await cloudBookingsDB.checkAvailability(
      { accommodation: 'main-house', check_in: '2026-11-25', check_out: '2026-11-26' },
      { now: SCREENSHOT_NOW },
    )
    expect(conflict.available).toBe(false)
  })

  it('deduplicates own bookings against site_config/availability slots for multi-unit A-House inventory', async () => {
    mockState.bookings.set('shared-hold-1', {
      uid: 'guest-j',
      guest_name: 'Juan Dela Cruz',
      phone: '09171234567',
      email: 'juan@example.com',
      accommodation: 'house-a-camping',
      check_in: '2026-11-26',
      check_out: '2026-11-27',
      guests: 2,
      status: 'Pending',
      payment_status: 'pending',
      payment_proof_url: 'payments/guest-j/HDL-1/proof.png',
      hold_expires_at: '2026-10-23T05:38:00.000Z',
    })
    mockState.docs.set('site_config/availability', {
      slots: [
        {
          id: 'shared-hold-1',
          accommodation: 'house-a-camping',
          check_in: '2026-11-26',
          check_out: '2026-11-27',
          status: 'Pending',
          payment_status: 'pending',
          payment_proof_url: 'present',
          hold_expires_at: '2026-10-23T05:38:00.000Z',
        },
      ],
    })

    const singleUnitHeld = await cloudBookingsDB.getAvailabilityCalendar(
      { accommodation: 'house-a-camping', from: '2026-11-01', to: '2026-12-01' },
      { now: SCREENSHOT_NOW, force: true },
    )
    // Without ID deduplication, `shared-hold-1` in both `site_config/availability`
    // and `ownBookings` would exhaust both A-House units and mark the date `pending`.
    expect(singleUnitHeld.days.find((d) => d.date === '2026-11-26')).toEqual({
      date: '2026-11-26',
      state: 'available',
    })

    mockState.docs.set('site_config/availability', {
      slots: [
        {
          id: 'shared-hold-1',
          accommodation: 'house-a-camping',
          check_in: '2026-11-26',
          check_out: '2026-11-27',
          status: 'Pending',
          payment_status: 'pending',
          payment_proof_url: 'present',
          hold_expires_at: '2026-10-23T05:38:00.000Z',
        },
        {
          id: 'other-guest-hold-2',
          accommodation: 'house-a-camping',
          check_in: '2026-11-26',
          check_out: '2026-11-27',
          status: 'Approved',
        },
      ],
    })

    const bothUnitsHeld = await cloudBookingsDB.getAvailabilityCalendar(
      { accommodation: 'house-a-camping', from: '2026-11-01', to: '2026-12-01' },
      { now: SCREENSHOT_NOW, force: true },
    )
    expect(bothUnitsHeld.days.find((d) => d.date === '2026-11-26')).toEqual({
      date: '2026-11-26',
      state: 'pending',
    })
  })

  it('fails closed for both calendar reads and web submissions when site_config/booking sets callable_booking_required: true', async () => {
    mockState.docs.set('site_config/booking', { callable_booking_required: true })

    await expect(
      cloudBookingsDB.getAvailabilityCalendar(
        { accommodation: 'main-house', from: '2026-11-01', to: '2026-12-01' },
        { now: SCREENSHOT_NOW, force: true },
      ),
    ).rejects.toBeInstanceOf(AvailabilityUnavailableError)

    await expect(
      cloudBookingsDB.add({
        ref_id: 'HDL-CLOSED-001',
        uid: 'guest-j',
        source: 'web',
        guest_name: 'Juan Dela Cruz',
        phone: '09171234567',
        email: 'juan@example.com',
        guests: 2,
        accommodation: 'main-house',
        special_requests: '',
        check_in: '2026-11-25',
        check_out: '2026-11-26',
        nights: 1,
        rate_amount: 5000,
        rate_unit: 'standard_stay',
        rate_classification: 'weekday',
        stay_total: 5000,
        amount_due: 2500,
        security_deposit: 1000,
        balance_due: 2500,
        policy_version: 'official-v2',
        policy_effective_date: '2026-10-04',
        refund_policy_snapshot: structuredClone(refundPolicy),
        payment_plan: 'down-payment',
        payment_proof_url: 'payments/guest-j/HDL-CLOSED-001/proof-1.png',
        payment_reference: 'GCASH-111222',
        amount_claimed: 2500,
      }),
    ).rejects.toBeInstanceOf(AvailabilityUnavailableError)

    expect(mockState.addedBookings).toHaveLength(0)
    expect(bookingsDB.list().some((b) => b.ref_id === 'HDL-CLOSED-001')).toBe(false)
  })

  it('never falls back on structured server refusals or real offline / missing-rates states', async () => {
    mockState.callableHandlers.set('bookingAvailability', async () => {
      throw Object.assign(new Error('Stored booking data is unreadable'), {
        code: 'functions/unavailable',
        details: { cause: 'AVAILABILITY_UNKNOWN', message: 'Availability could not be confirmed right now.' },
      })
    })
    await expect(
      cloudBookingsDB.getAvailabilityCalendar(
        { accommodation: 'main-house', from: '2026-11-01', to: '2026-12-01' },
        { now: SCREENSHOT_NOW, force: true },
      ),
    ).rejects.toBeInstanceOf(AvailabilityUnavailableError)

    mockState.callableHandlers.set('submitBooking', async () => {
      throw Object.assign(new Error('Those dates are held'), {
        code: 'functions/failed-precondition',
        details: { cause: 'DATE_UNAVAILABLE', message: 'Those dates are already held for The Main House.' },
      })
    })
    await expect(
      cloudBookingsDB.add({
        ref_id: 'HDL-CONFLICT-001',
        uid: 'guest-j',
        source: 'web',
        guest_name: 'Juan Dela Cruz',
        phone: '09171234567',
        email: 'juan@example.com',
        guests: 2,
        accommodation: 'main-house',
        special_requests: '',
        check_in: '2026-11-25',
        check_out: '2026-11-26',
        nights: 1,
        rate_amount: 5000,
        rate_unit: 'standard_stay',
        rate_classification: 'weekday',
        stay_total: 5000,
        amount_due: 2500,
        security_deposit: 1000,
        balance_due: 2500,
        policy_version: 'official-v2',
        policy_effective_date: '2026-10-04',
        refund_policy_snapshot: structuredClone(refundPolicy),
        payment_plan: 'down-payment',
        payment_proof_url: 'payments/guest-j/HDL-CONFLICT-001/proof-1.png',
        payment_reference: 'GCASH-333444',
        amount_claimed: 2500,
      }),
    ).rejects.toBeInstanceOf(AvailabilityUnavailableError)
    expect(mockState.addedBookings).toHaveLength(0)

    mockState.callableHandlers.clear()
    mockState.policyOffline = true
    await expect(
      cloudBookingsDB.getAvailabilityCalendar(
        { accommodation: 'main-house', from: '2026-11-01', to: '2026-12-01' },
        { now: SCREENSHOT_NOW, force: true },
      ),
    ).rejects.toBeInstanceOf(AvailabilityUnavailableError)

    mockState.policyOffline = false
    mockState.docs.delete('site_config/rates')
    await expect(
      cloudBookingsDB.getAvailabilityCalendar(
        { accommodation: 'main-house', from: '2026-11-01', to: '2026-12-01' },
        { now: SCREENSHOT_NOW, force: true },
      ),
    ).rejects.toBeInstanceOf(AvailabilityUnavailableError)
  })
})
