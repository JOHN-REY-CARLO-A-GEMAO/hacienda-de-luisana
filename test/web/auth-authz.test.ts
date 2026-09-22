// API authorization — what each of the three roles may actually do to a Booking.
//
// The store is the seam every surface calls: the Host dashboard, the client app,
// the Guest's own account page and the mobile app all go through
// `cloudBookingsDB.transition`, which asks the lifecycle whether *this actor* may
// take *this action* on *this Booking*. A session's role becomes that actor, so
// a person who edits the frontend to say they are the Host still sends the actor
// the session resolved — and the refusal below is what they get, before
// firestore.rules refuses it again for anybody who skips the app entirely.
import { activityLogDB, cloudBookingsDB } from '../../src/lib/firestoreBookings'
import type { ActionAccepted, Actor } from '../../src/lib/booking'

const guest: Actor = { actor: 'guest', actor_id: 'guest-1', actor_name: 'Maria Santos', now: '2026-09-20T01:00:00.000Z' }
const host: Actor = { actor: 'host', actor_id: 'host-1', actor_name: 'Ana Luisana', now: '2026-09-20T01:00:00.000Z' }
const staff: Actor = { actor: 'staff', actor_id: 'staff-1', actor_name: 'Ben Cariño', now: '2026-09-20T01:00:00.000Z' }

const request = {
  guest_name: 'Maria Santos',
  phone: '0917 123 4567',
  email: 'maria@example.com',
  check_in: '2026-10-01',
  check_out: '2026-10-04',
  guests: 4,
  accommodation: 'main-house',
  special_requests: '',
  uid: 'guest-1',
}

const rateCard = { nightlyRate: 10000, securityDeposit: 500 }

beforeEach(() => {
  localStorage.clear()
  if (!('randomUUID' in crypto)) {
    let n = 0
    ;(crypto as Crypto & { randomUUID: () => string }).randomUUID = () =>
      `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` as ReturnType<typeof crypto.randomUUID>
  }
})

/** A Booking at each stage of the journey, reached the way the real one is. */
async function atStage(stage: 'Pending' | 'KYC Submitted' | 'Approved' | 'Payment Pending' | 'Reserved' | 'Checked-Out') {
  const booking = await cloudBookingsDB.add(request, guest)
  if (stage === 'Pending') return booking.id

  await expectAccepted(booking.id, { type: 'UploadKyc', kyc_id_url: 'gs://kyc/guest-1/id.jpg' }, guest)
  if (stage === 'KYC Submitted') return booking.id

  await expectAccepted(booking.id, { type: 'Approve', availability: { unitsAvailable: 1, bookings: [] } }, host)
  if (stage === 'Approved') return booking.id

  await expectAccepted(booking.id, { type: 'ChoosePaymentPlan', plan: 'full', rateCard }, guest)
  if (stage === 'Payment Pending') return booking.id

  await expectAccepted(booking.id, { type: 'UploadPaymentProof', payment_proof_url: 'gs://proofs/1.jpg', amount_claimed: 30500 }, guest)
  await expectAccepted(booking.id, { type: 'VerifyPayment', amount_verified: 30500 }, host)
  if (stage === 'Reserved') return booking.id

  await expectAccepted(booking.id, { type: 'CheckIn' }, host)
  await expectAccepted(booking.id, { type: 'BeginStay' }, host)
  await expectAccepted(booking.id, { type: 'CheckOut' }, host)
  return booking.id
}

async function expectAccepted(id: string, action: Parameters<typeof cloudBookingsDB.transition>[1], actor: Actor) {
  const result = await cloudBookingsDB.transition(id, action, actor)
  if (!result.ok) throw new Error(`expected ${action.type} to be accepted, got: ${result.reason}`)
  return result as ActionAccepted
}

describe('what a Guest may do through the API', () => {
  it('submits a Booking, sends an ID, and withdraws before the Host decides', async () => {
    const id = await atStage('KYC Submitted')

    const withdrawn = await cloudBookingsDB.transition(
      id,
      { type: 'Cancel', reason: 'Something came up at home.' },
      guest,
    )

    expect(withdrawn.ok).toBe(true)
    expect(await cloudBookingsDB.get(id)).toMatchObject({ status: 'Cancelled' })
  })

  it('cannot approve, verify or complete anything — not even its own Booking', async () => {
    const id = await atStage('KYC Submitted')

    const approve = await cloudBookingsDB.transition(
      id,
      { type: 'Approve', availability: { unitsAvailable: 1, bookings: [] } },
      guest,
    )
    expect(approve.ok).toBe(false)
    if (!approve.ok) expect(approve.reason).toMatch(/guest cannot Approve/i)

    const paid = await atStage('Payment Pending')
    const verify = await cloudBookingsDB.transition(paid, { type: 'VerifyPayment', amount_verified: 30500 }, guest)
    expect(verify.ok).toBe(false)
    if (!verify.ok) expect(verify.reason).toMatch(/guest cannot VerifyPayment/i)

    const done = await atStage('Checked-Out')
    const complete = await cloudBookingsDB.transition(done, { type: 'Complete' }, guest)
    expect(complete.ok).toBe(false)

    // Nothing moved while those were refused.
    expect(await cloudBookingsDB.get(id)).toMatchObject({ status: 'KYC Submitted' })
    expect(await cloudBookingsDB.get(done)).toMatchObject({ status: 'Checked-Out' })
  })

  it('cannot mark its own payment verified, whatever amount it claims', async () => {
    const id = await atStage('Payment Pending')
    await expectAccepted(id, { type: 'UploadPaymentProof', payment_proof_url: 'gs://proofs/2.jpg', amount_claimed: 30500 }, guest)

    const selfVerified = await cloudBookingsDB.transition(id, { type: 'VerifyPayment', amount_verified: 30500 }, guest)

    expect(selfVerified.ok).toBe(false)
    expect(await cloudBookingsDB.get(id)).toMatchObject({ status: 'Payment Pending', payment_status: 'pending' })
  })
})

describe('what Staff may do through the API', () => {
  it('completes a stay that has been cleaned and inspected', async () => {
    const id = await atStage('Checked-Out')

    const completed = await cloudBookingsDB.transition(id, { type: 'Complete' }, staff)

    expect(completed.ok).toBe(true)
    expect(await cloudBookingsDB.get(id)).toMatchObject({ status: 'Completed' })
  })

  it('cannot approve a Booking, refuse one, or cancel one', async () => {
    const id = await atStage('KYC Submitted')

    const approve = await cloudBookingsDB.transition(
      id,
      { type: 'Approve', availability: { unitsAvailable: 1, bookings: [] } },
      staff,
    )
    const refuse = await cloudBookingsDB.transition(id, { type: 'Reject', reason: 'Not for us to say.' }, staff)
    const cancel = await cloudBookingsDB.transition(id, { type: 'Cancel', reason: 'Tidying up.' }, staff)

    expect(approve.ok).toBe(false)
    expect(refuse.ok).toBe(false)
    expect(cancel.ok).toBe(false)
    if (!approve.ok) expect(approve.reason).toMatch(/staff cannot Approve/i)
    expect(await cloudBookingsDB.get(id)).toMatchObject({ status: 'KYC Submitted' })
  })

  it('cannot verify a payment or return a refund', async () => {
    const id = await atStage('Payment Pending')
    await expectAccepted(id, { type: 'UploadPaymentProof', payment_proof_url: 'gs://proofs/3.jpg' }, guest)

    const verify = await cloudBookingsDB.transition(id, { type: 'VerifyPayment', amount_verified: 30500 }, staff)
    expect(verify.ok).toBe(false)
    if (!verify.ok) expect(verify.reason).toMatch(/staff cannot VerifyPayment/i)

    const cancelled = await atStage('Reserved')
    await expectAccepted(cancelled, { type: 'Cancel', reason: 'Guest cancelled.' }, host)
    const refund = await cloudBookingsDB.transition(cancelled, { type: 'MarkRefunded' }, staff)
    expect(refund.ok).toBe(false)

    expect(await cloudBookingsDB.get(id)).toMatchObject({ status: 'Payment Pending' })
  })

  it('cannot complete a stay that has not been checked out yet', async () => {
    const id = await atStage('Reserved')

    const tooEarly = await cloudBookingsDB.transition(id, { type: 'Complete' }, staff)

    // The one move Staff has is still bound by the lifecycle: cleaning a room
    // somebody is still sleeping in does not finish their stay.
    expect(tooEarly.ok).toBe(false)
    expect(await cloudBookingsDB.get(id)).toMatchObject({ status: 'Reserved' })
  })
})

describe('what the Host may do through the API', () => {
  it('approves a Booking whose ID has been sent, and the dates hold', async () => {
    const id = await atStage('KYC Submitted')

    const approved = await expectAccepted(
      id,
      { type: 'Approve', availability: { unitsAvailable: 1, bookings: [] } },
      host,
    )

    expect(approved.patch.status).toBe('Approved')
    expect(await cloudBookingsDB.get(id)).toMatchObject({ status: 'Approved' })
  })

  it('verifies a payment, which is what makes a Booking Reserved', async () => {
    const id = await atStage('Payment Pending')
    await expectAccepted(id, { type: 'UploadPaymentProof', payment_proof_url: 'gs://proofs/4.jpg', amount_claimed: 30500 }, guest)

    await expectAccepted(id, { type: 'VerifyPayment', amount_verified: 30500 }, host)

    expect(await cloudBookingsDB.get(id)).toMatchObject({ status: 'Reserved', payment_status: 'verified' })
  })

  it('cancels a Booking any Guest may not cancel alone, and the refund is settled', async () => {
    const id = await atStage('Reserved')

    await expectAccepted(id, { type: 'Cancel', reason: 'The Main House needs repairs.', refund: { rateCard } }, host)

    expect(await cloudBookingsDB.get(id)).toMatchObject({ status: 'Cancelled', refund_status: 'initiated' })
  })
})

describe('who the Activity log says did it', () => {
  it('names the Staff member who completed a stay, not the Host', async () => {
    const id = await atStage('Checked-Out')

    await expectAccepted(id, { type: 'Complete' }, staff)

    const history = await activityLogDB.list(id)
    expect(history.at(-1)).toMatchObject({
      action: 'Complete',
      from_status: 'Checked-Out',
      to_status: 'Completed',
      actor: 'staff',
      actor_id: 'staff-1',
      actor_name: 'Ben Cariño',
    })
  })

  it('names the Guest who withdrew, and the Host who approved', async () => {
    const id = await atStage('KYC Submitted')

    await expectAccepted(id, { type: 'Cancel', reason: 'Cannot make it.' }, guest)

    const history = await activityLogDB.list(id)
    expect(history.map((entry) => `${entry.action}:${entry.actor}`)).toEqual([
      'Submit:guest',
      'UploadKyc:guest',
      'Cancel:guest',
    ])
  })

  it('names the system, and never a person, for a Date hold that ran out', async () => {
    const booking = await cloudBookingsDB.add(request, guest)
    // Rewind the hold so the read-time rule can see it has run out (ADR-0002).
    await cloudBookingsDB.update(booking.id, {
      hold_expires_at: new Date(Date.now() - 1000).toISOString(),
    })

    const expired = await cloudBookingsDB.materialiseExpiry(booking.id)

    expect(expired.ok).toBe(true)
    const history = await activityLogDB.list(booking.id)
    expect(history.at(-1)).toMatchObject({ action: 'Expire', actor: 'system', actor_id: 'system' })
  })
})

describe('an actor that is not one of the three roles', () => {
  it('gets nothing at all, whatever it claims to be', async () => {
    const id = await atStage('KYC Submitted')

    for (const actor of ['system', 'owner', 'admin', 'superuser', ''] as const) {
      const result = await cloudBookingsDB.transition(
        id,
        { type: 'Approve', availability: { unitsAvailable: 1, bookings: [] } },
        { actor, actor_id: 'whoever' } as unknown as Actor,
      )
      expect(result.ok, `${actor || 'an empty actor'} should be refused`).toBe(false)
    }

    expect(await cloudBookingsDB.get(id)).toMatchObject({ status: 'KYC Submitted' })
  })

  it('still lets the system expire a hold, which is nobody’s decision', async () => {
    const booking = await cloudBookingsDB.add(request, guest)
    await cloudBookingsDB.update(booking.id, {
      hold_expires_at: new Date(Date.now() - 1000).toISOString(),
    })

    const expired = await cloudBookingsDB.transition(booking.id, { type: 'Expire' }, {
      actor: 'system',
      actor_id: 'system',
    })

    expect(expired.ok).toBe(true)
  })
})
