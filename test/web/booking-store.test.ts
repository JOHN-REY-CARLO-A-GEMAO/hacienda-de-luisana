// The booking store seam, driven end to end with no Firebase configured: the
// same localStorage-backed adapter the website falls back to in demo mode.
// Nothing here reaches past the interface — no peeking into localStorage, no
// asserting on internals (tdd skill: verify through the interface).
import { cloudBookingsDB, activityLogDB } from '../../src/lib/firestoreBookings'
import { DATE_HOLD_MS } from '../../src/lib/booking'

const guest = { actor: 'guest', actor_id: 'guest-1', actor_name: 'Maria Santos' } as const
const admin = { actor: 'admin', actor_id: 'admin-1', actor_name: 'Ana Luisana' } as const
const NOW = '2026-09-20T01:00:00.000Z'

const request = {
  guest_name: 'Maria Santos',
  phone: '0917 123 4567',
  email: 'maria@example.com',
  check_in: '2026-10-01',
  check_out: '2026-10-04',
  guests: 4,
  accommodation: 'main-house',
  special_requests: '',
}

beforeEach(() => {
  localStorage.clear()
  // jsdom implements the Web Crypto interface but not randomUUID.
  if (!('randomUUID' in crypto)) {
    let n = 0
    ;(crypto as Crypto & { randomUUID: () => string }).randomUUID = () =>
      `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` as ReturnType<typeof crypto.randomUUID>
  }
})

describe('the booking store seam', () => {
  it('runs on local persistence when Firebase is not configured', () => {
    expect(cloudBookingsDB.isCloud).toBe(false)
  })

  it('submits a Booking that reads back as Pending, holding its dates for 24 hours', async () => {
    const submitted = await cloudBookingsDB.add(request, { ...guest, now: NOW })

    expect(submitted.status).toBe('Pending')

    const stored = await cloudBookingsDB.get(submitted.id)
    expect(stored?.status).toBe('Pending')
    expect(stored?.hold_expires_at).toBe(new Date(Date.parse(NOW) + DATE_HOLD_MS).toISOString())
  })

  it('writes an Activity log entry when a Booking is created', async () => {
    const submitted = await cloudBookingsDB.add(request, { ...guest, now: NOW })

    const history = await activityLogDB.list(submitted.id)
    expect(history).toEqual([
      {
        booking_id: submitted.id,
        action: 'Submit',
        from_status: 'Pending',
        to_status: 'Pending',
        actor: 'guest',
        actor_id: 'guest-1',
        actor_name: 'Maria Santos',
        at: NOW,
        seq: 0,
      },
    ])
  })

  it('moves a Booking through the lifecycle and appends every step to its history', async () => {
    const submitted = await cloudBookingsDB.add(request, { ...guest, now: NOW })

    const kyc = await cloudBookingsDB.transition(
      submitted.id,
      { type: 'UploadKyc', kyc_id_url: 'gs://ids/maria.jpg' },
      { ...guest, now: NOW },
    )
    expect(kyc.ok).toBe(true)

    const approval = await cloudBookingsDB.transition(
      submitted.id,
      { type: 'Approve', availability: { unitsAvailable: 1, bookings: await cloudBookingsDB.list() } },
      { ...admin, now: NOW },
    )
    expect(approval.ok).toBe(true)

    const stored = await cloudBookingsDB.get(submitted.id)
    expect(stored?.status).toBe('Approved')
    expect(stored?.kyc_status).toBe('approved')

    const history = await activityLogDB.list(submitted.id)
    expect(history.map((entry) => [entry.action, entry.from_status, entry.to_status])).toEqual([
      ['Submit', 'Pending', 'Pending'],
      ['UploadKyc', 'Pending', 'KYC Submitted'],
      ['Approve', 'KYC Submitted', 'Approved'],
    ])
    expect(history.map((entry) => entry.actor)).toEqual(['guest', 'guest', 'admin'])
  })

  it('refuses an illegal transition and changes nothing, leaving no entry behind', async () => {
    const submitted = await cloudBookingsDB.add(request, { ...guest, now: NOW })

    // No KYC submitted yet, so the Admin cannot approve.
    const refused = await cloudBookingsDB.transition(
      submitted.id,
      { type: 'Approve', availability: { unitsAvailable: 1, bookings: [] } },
      { ...admin, now: NOW },
    )

    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.reason).toMatch(/KYC/)

    const stored = await cloudBookingsDB.get(submitted.id)
    expect(stored?.status).toBe('Pending')
    expect((await activityLogDB.list(submitted.id))).toHaveLength(1)
  })

  it('refuses to approve a second Booking into a one-unit Accommodation the first already holds', async () => {
    const first = await cloudBookingsDB.add(request, { ...guest, now: NOW })
    const second = await cloudBookingsDB.add(
      { ...request, guest_name: 'JP Santos', email: 'jp@example.com', check_in: '2026-10-03', check_out: '2026-10-06' },
      { ...guest, now: NOW },
    )

    for (const booking of [first, second]) {
      const kyc = await cloudBookingsDB.transition(
        booking.id,
        { type: 'UploadKyc', kyc_id_url: `gs://ids/${booking.id}.jpg` },
        { ...guest, now: NOW },
      )
      expect(kyc.ok).toBe(true)
    }

    // The Main House holds one Booking at a time, and the re-check reads what is
    // stored at the moment of approval — never a list captured earlier.
    const approve = async (id: string) =>
      cloudBookingsDB.transition(
        id,
        {
          type: 'Approve',
          availability: { unitsAvailable: 1, bookings: await cloudBookingsDB.list() },
        },
        { ...admin, now: NOW },
      )

    expect((await approve(first.id)).ok).toBe(true)

    const refused = await approve(second.id)
    expect(refused.ok).toBe(false)
    if (!refused.ok) {
      expect(refused.conflicts?.map((c) => c.id)).toEqual([first.id])
      expect(refused.reason).toMatch(/already held/)
    }

    // The refused Booking is untouched, and a refusal is not logged as a change.
    expect((await cloudBookingsDB.get(second.id))?.status).toBe('KYC Submitted')
    expect((await activityLogDB.list(second.id)).map((entry) => entry.action)).toEqual(['Submit', 'UploadKyc'])
  })

  it('approves up to every unit of a multi-unit Accommodation, and no further', async () => {
    // The camping Accommodation has two units (src/config/site.ts).
    const unitsAvailable = 2
    const submit = async (guestName: string) => {
      const booking = await cloudBookingsDB.add(
        { ...request, accommodation: 'house-a-camping', guest_name: guestName },
        { ...guest, now: NOW },
      )
      const kyc = await cloudBookingsDB.transition(
        booking.id,
        { type: 'UploadKyc', kyc_id_url: `gs://ids/${booking.id}.jpg` },
        { ...guest, now: NOW },
      )
      expect(kyc.ok).toBe(true)
      return booking
    }

    const first = await submit('JP Santos')
    const second = await submit('Bea Reyes')

    const approve = async (id: string) =>
      cloudBookingsDB.transition(
        id,
        {
          type: 'Approve',
          availability: { unitsAvailable, bookings: await cloudBookingsDB.list() },
        },
        { ...admin, now: NOW },
      )

    expect((await approve(first.id)).ok).toBe(true)
    expect((await approve(second.id)).ok).toBe(true)

    // Both units are held now, so a third Booking for the same nights is refused.
    const third = await submit('Rob Mendoza')
    const refused = await approve(third.id)
    expect(refused.ok).toBe(false)
    if (!refused.ok) {
      expect(refused.conflicts?.map((c) => c.id).sort()).toEqual([first.id, second.id].sort())
    }
  })

  it('reads a stored Confirmed Booking as Reserved, without rewriting the document', async () => {
    // The web app wrote Confirmed before the vocabulary changed (spec #9).
    const legacy = await cloudBookingsDB.add(request, { ...guest, now: NOW })
    await cloudBookingsDB.update(legacy.id, { status: 'Confirmed' as never })

    const stored = await cloudBookingsDB.get(legacy.id)
    expect(stored?.status).toBe('Reserved')

    const listed = await cloudBookingsDB.list()
    expect(listed.find((b) => b.id === legacy.id)?.status).toBe('Reserved')
  })

  it('exposes no way to edit or delete an Activity log entry', () => {
    // The Activity log is append-only (CONTEXT.md § Activity log, ticket #11).
    expect(Object.keys(activityLogDB).sort()).toEqual(['append', 'list'])
  })
})
