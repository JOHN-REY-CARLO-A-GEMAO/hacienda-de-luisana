import { applyAction, holdsDates, type BookingState } from '../../src/lib/booking'

// A Booking as stored, mid-review: submitted an hour ago, so its Date hold has
// 23 hours left, and the Guest has not uploaded their ID yet.
const NOW = '2026-09-20T01:00:00.000Z'
const HOLD_EXPIRY = '2026-09-21T00:00:00.000Z'

const pendingBooking = (): BookingState => ({
  id: 'book-1',
  ref_id: 'HDL-4821',
  accommodation: 'main-house',
  check_in: '2026-10-01',
  check_out: '2026-10-04',
  guests: 4,
  status: 'Pending',
  kyc_status: 'required',
  hold_expires_at: HOLD_EXPIRY,
  created_at: '2026-09-20T00:00:00.000Z',
})

const guest = { actor: 'guest', actor_id: 'guest-1', actor_name: 'Maria Santos' } as const
const admin = { actor: 'admin', actor_id: 'admin-1', actor_name: 'Ana Luisana' } as const
const system = { actor: 'system', actor_id: 'system', actor_name: 'System' } as const

// The Main House is free for these dates, as far as the stored Bookings know.
const noConflicts = { unitsAvailable: 1, bookings: [] }

function expectOk(result: ReturnType<typeof applyAction>) {
  if (!result.ok) throw new Error(`expected the action to be accepted, got: ${result.reason}`)
  return result
}

function expectRefused(result: ReturnType<typeof applyAction>) {
  if (result.ok) throw new Error(`expected the action to be refused, got: ${JSON.stringify(result.patch)}`)
  return result
}

describe('applyAction — the journey from submission to a completed stay', () => {
  it('moves a Booking through the whole lifecycle, one legal step at a time', () => {
    let booking = pendingBooking()

    const kyc = expectOk(
      applyAction(booking, { type: 'UploadKyc', kyc_id_url: 'gs://ids/maria.jpg' }, { ...guest, now: NOW }),
    )
    expect(kyc.patch.status).toBe('KYC Submitted')
    booking = { ...booking, ...kyc.patch }

    const approval = expectOk(
      applyAction(booking, { type: 'Approve', availability: noConflicts }, { ...admin, now: NOW }),
    )
    expect(approval.patch.status).toBe('Approved')
    booking = { ...booking, ...approval.patch }

    const plan = expectOk(
      applyAction(
        booking,
        { type: 'ChoosePaymentPlan', plan: 'full', rateCard: { nightlyRate: 10000, securityDeposit: 500 } },
        { ...guest, now: NOW },
      ),
    )
    expect(plan.patch.status).toBe('Payment Pending')
    booking = { ...booking, ...plan.patch }

    const proof = expectOk(
      applyAction(
        booking,
        { type: 'UploadPaymentProof', payment_proof_url: 'gs://proofs/transfer.jpg', amount_claimed: 10500 },
        { ...guest, now: NOW },
      ),
    )
    booking = { ...booking, ...proof.patch }

    const verification = expectOk(
      applyAction(
        booking,
        { type: 'VerifyPayment', amount_verified: booking.amount_due! + booking.security_deposit! },
        { ...admin, now: NOW },
      ),
    )
    expect(verification.patch.status).toBe('Reserved')
    booking = { ...booking, ...verification.patch }

    const checkIn = expectOk(applyAction(booking, { type: 'CheckIn' }, { ...system, now: NOW }))
    expect(checkIn.patch.status).toBe('Checked-In')
    booking = { ...booking, ...checkIn.patch }

    const staying = expectOk(applyAction(booking, { type: 'BeginStay' }, { ...system, now: NOW }))
    expect(staying.patch.status).toBe('Staying')
    booking = { ...booking, ...staying.patch }

    const checkOut = expectOk(applyAction(booking, { type: 'CheckOut' }, { ...admin, now: NOW }))
    expect(checkOut.patch.status).toBe('Checked-Out')
    booking = { ...booking, ...checkOut.patch }

    const completed = expectOk(applyAction(booking, { type: 'Complete' }, { ...admin, now: NOW }))
    expect(completed.patch.status).toBe('Completed')
  })

  it('writes an Activity log entry for every step, naming the actor, the time and both statuses', () => {
    const booking = pendingBooking()

    const kyc = expectOk(
      applyAction(booking, { type: 'UploadKyc', kyc_id_url: 'gs://ids/maria.jpg' }, { ...guest, now: NOW }),
    )
    expect(kyc.entries).toEqual([
      {
        booking_id: 'book-1',
        action: 'UploadKyc',
        from_status: 'Pending',
        to_status: 'KYC Submitted',
        actor: 'guest',
        actor_id: 'guest-1',
        actor_name: 'Maria Santos',
        at: NOW,
      },
    ])

    const approved = expectOk(
      applyAction(
        { ...booking, ...kyc.patch },
        { type: 'Approve', availability: noConflicts },
        { ...admin, now: NOW },
      ),
    )
    expect(approved.entries[0]).toMatchObject({
      action: 'Approve',
      from_status: 'KYC Submitted',
      to_status: 'Approved',
      actor: 'admin',
      actor_name: 'Ana Luisana',
      at: NOW,
    })
  })

  it('records the reason a Booking was refused, so the Guest knows what to fix', () => {
    const booking: BookingState = { ...pendingBooking(), status: 'KYC Submitted', kyc_status: 'submitted' }

    const rejected = expectOk(
      applyAction(
        booking,
        { type: 'Reject', reason: 'Government ID is expired — please upload a current one' },
        { ...admin, now: NOW },
      ),
    )

    expect(rejected.patch.status).toBe('Rejected')
    expect(rejected.patch.kyc_status).toBe('rejected')
    expect(rejected.patch.kyc_reject_reason).toBe('Government ID is expired — please upload a current one')
    expect(rejected.entries[0]).toMatchObject({
      to_status: 'Rejected',
      reason: 'Government ID is expired — please upload a current one',
    })
  })

  it('changes nothing it was given: the patch is returned, never applied', () => {
    const booking = pendingBooking()
    const before = JSON.stringify(booking)

    applyAction(booking, { type: 'Approve', availability: noConflicts }, { ...admin, now: NOW })

    expect(JSON.stringify(booking)).toBe(before)
  })
})

describe('applyAction — the rules that protect the Guest and the Admin', () => {
  it('refuses to approve a Booking whose Guest has not submitted an ID', () => {
    const refused = expectRefused(
      applyAction(pendingBooking(), { type: 'Approve', availability: noConflicts }, { ...admin, now: NOW }),
    )

    expect(refused.reason).toMatch(/KYC/)
  })

  it('refuses to approve into dates another Booking already holds', () => {
    const booking: BookingState = { ...pendingBooking(), status: 'KYC Submitted', kyc_status: 'submitted' }

    const refused = expectRefused(
      applyAction(
        booking,
        {
          type: 'Approve',
          availability: {
            unitsAvailable: 1,
            bookings: [
              {
                id: 'book-2',
                accommodation: 'main-house',
                check_in: '2026-10-02',
                check_out: '2026-10-06',
                status: 'Reserved',
              },
            ],
          },
        },
        { ...admin, now: NOW },
      ),
    )

    // The Admin needs to know exactly which Booking is standing in the way.
    expect(refused.conflicts?.map((c) => c.id)).toEqual(['book-2'])
    expect(refused.reason).toMatch(/already held/)
  })

  it('lets the Guest resubmit an ID inside the same Date hold', () => {
    const booking: BookingState = {
      ...pendingBooking(),
      status: 'KYC Submitted',
      kyc_status: 'rejected',
      kyc_reject_reason: 'Photo was blurred',
    }

    const resubmitted = expectOk(
      applyAction(booking, { type: 'UploadKyc', kyc_id_url: 'gs://ids/maria-2.jpg' }, { ...guest, now: NOW }),
    )

    expect(resubmitted.patch.status).toBe('KYC Submitted')
    expect(resubmitted.patch.kyc_status).toBe('submitted')
    // The Admin's rejection is cleared: the Guest has answered it.
    expect(resubmitted.patch.kyc_reject_reason).toBeNull()
    // The dates are still held by the same booking: no new hold is placed.
    expect(resubmitted.patch.hold_expires_at).toBeUndefined()
  })

  it('refuses to verify money for a Booking the Admin has not approved', () => {
    const refused = expectRefused(
      applyAction(pendingBooking(), { type: 'VerifyPayment', amount_verified: 10500 }, { ...admin, now: NOW }),
    )

    expect(refused.reason).toMatch(/Payment Pending/)
  })

  it('refuses every action on a Booking that has already finished', () => {
    const cancelled: BookingState = { ...pendingBooking(), status: 'Cancelled' }

    expectRefused(applyAction(cancelled, { type: 'UploadKyc', kyc_id_url: 'x' }, { ...guest, now: NOW }))
    expectRefused(applyAction(cancelled, { type: 'Approve', availability: noConflicts }, { ...admin, now: NOW }))
    expectRefused(applyAction(cancelled, { type: 'Cancel' }, { ...guest, now: NOW }))
    expectRefused(applyAction(cancelled, { type: 'Expire' }, { ...system, now: NOW }))
  })

  it('refuses an action from somebody who cannot take it', () => {
    const booking: BookingState = { ...pendingBooking(), status: 'KYC Submitted', kyc_status: 'submitted' }

    // A Guest cannot approve their own Booking; the Admin's review is the point.
    const refused = expectRefused(
      applyAction(booking, { type: 'Approve', availability: noConflicts }, { ...guest, now: NOW }),
    )
    expect(refused.reason).toMatch(/cannot/i)

    // And the Admin cannot upload the Guest's ID for them.
    expectRefused(
      applyAction(pendingBooking(), { type: 'UploadKyc', kyc_id_url: 'x' }, { ...admin, now: NOW }),
    )
  })

  it('expires a Booking that waited too long for review, and releases its dates', () => {
    const expired = expectOk(
      applyAction(pendingBooking(), { type: 'Expire' }, { ...system, now: '2026-09-21T00:00:01.000Z' }),
    )

    expect(expired.patch.status).toBe('Expired')
    expect(expired.entries[0]).toMatchObject({ actor: 'system', to_status: 'Expired' })
  })

  it('refuses to expire a Booking the Admin has already approved', () => {
    const booking: BookingState = { ...pendingBooking(), status: 'Approved', kyc_status: 'approved' }

    expectRefused(applyAction(booking, { type: 'Expire' }, { ...system, now: '2026-09-25T00:00:00.000Z' }))
  })
})

// Flow §2 steps 7–11 and ADR-0001: the Admin approves first, money moves last,
// and verified money only ever leaves through the Refund pipeline.
const RATE_CARD = { nightlyRate: 10000, securityDeposit: 500, downPaymentPercent: 50 }

/** A Booking the Admin has approved, with three nights quoted off the rate card. */
function approvedBooking(): BookingState {
  return {
    ...pendingBooking(),
    status: 'Approved',
    kyc_status: 'approved',
    hold_expires_at: null,
  }
}

function reserve(booking: BookingState): BookingState {
  const plan = expectOk(
    applyAction(booking, { type: 'ChoosePaymentPlan', plan: 'full', rateCard: RATE_CARD }, { ...guest, now: NOW }),
  )
  const proof = expectOk(
    applyAction(
      { ...booking, ...plan.patch },
      { type: 'UploadPaymentProof', payment_proof_url: 'gs://proofs/transfer.jpg', amount_claimed: 10500 },
      { ...guest, now: NOW },
    ),
  )
  const afterPlan = { ...booking, ...plan.patch, ...proof.patch }
  // The Admin verifies the whole of what the Guest was asked for.
  const paidInFull = afterPlan.amount_due! + afterPlan.security_deposit!
  const verified = expectOk(
    applyAction(afterPlan, { type: 'VerifyPayment', amount_verified: paidInFull }, { ...admin, now: NOW }),
  )
  return { ...booking, ...plan.patch, ...proof.patch, ...verified.patch }
}

describe('applyAction — money', () => {
  it('records what the Guest owes the moment they choose a payment plan', () => {
    const chosen = expectOk(
      applyAction(
        approvedBooking(),
        { type: 'ChoosePaymentPlan', plan: 'down-payment', rateCard: RATE_CARD },
        { ...guest, now: NOW },
      ),
    )

    expect(chosen.patch).toMatchObject({
      status: 'Payment Pending',
      payment_plan: 'down-payment',
      payment_status: 'pending',
      stay_total: 30000,
      amount_due: 15000,
      security_deposit: 500,
      balance_due: 15000,
    })
  })

  it('quotes from the recorded total when the Admin has published no card for the stay', () => {
    const chosen = expectOk(
      applyAction(
        approvedBooking(),
        {
          type: 'ChoosePaymentPlan',
          plan: 'down-payment',
          stayTotal: 30000,
          rate: { securityDeposit: 500, downPaymentPercent: 50 },
        },
        { ...guest, now: NOW },
      ),
    )

    expect(chosen.patch).toMatchObject({
      status: 'Payment Pending',
      payment_plan: 'down-payment',
      payment_status: 'pending',
      stay_total: 30000,
      amount_due: 15000,
      security_deposit: 500,
      balance_due: 15000,
    })
  })

  it('refuses a choice the Admin has published nothing to quote', () => {
    const refused = expectRefused(
      applyAction(approvedBooking(), { type: 'ChoosePaymentPlan', plan: 'full' }, { ...guest, now: NOW }),
    )

    expect(refused.reason).toMatch(/has not published/)
  })

  it('refuses a recorded total with no deposit and no down payment percent to apply', () => {
    // A total without any published figures is not a price the Guest can be
    // committed to: nothing is owed, nothing is held, nothing is promised.
    const refused = expectRefused(
      applyAction(approvedBooking(), { type: 'ChoosePaymentPlan', plan: 'down-payment', stayTotal: 30000 }, { ...guest, now: NOW }),
    )

    expect(refused.reason).toMatch(/has not published/)
  })

  it('stamps the published policy in force on the Booking at choice time', () => {
    const chosen = expectOk(
      applyAction(
        approvedBooking(),
        {
          type: 'ChoosePaymentPlan',
          plan: 'full',
          rateCard: RATE_CARD,
          policy: { version: 'v2026-09', effectiveDate: '2026-09-01' },
        },
        { ...guest, now: NOW },
      ),
    )

    expect(chosen.patch).toMatchObject({
      policy_version: 'v2026-09',
      policy_effective_date: '2026-09-01',
    })
  })

  it('stamps nulls when the Admin had published no policy, so the stay refunds nothing', () => {
    const chosen = expectOk(
      applyAction(
        approvedBooking(),
        { type: 'ChoosePaymentPlan', plan: 'full', rateCard: RATE_CARD },
        { ...guest, now: NOW },
      ),
    )

    expect(chosen.patch).toMatchObject({ policy_version: null, policy_effective_date: null })
  })

  it('refuses a payment plan the Admin has not published', () => {
    const refused = expectRefused(
      applyAction(
        approvedBooking(),
        { type: 'ChoosePaymentPlan', plan: 'down-payment', rateCard: { nightlyRate: 10000, securityDeposit: 500 } },
        { ...guest, now: NOW },
      ),
    )

    expect(refused.reason).toMatch(/has not published/)
  })

  it('refuses to verify less than the Guest was asked to send', () => {
    const booking: BookingState = {
      ...approvedBooking(),
      status: 'Payment Pending',
      payment_plan: 'full',
      payment_proof_url: 'gs://proofs/transfer.jpg',
      amount_due: 30000,
      security_deposit: 500,
    }

    const refused = expectRefused(
      applyAction(booking, { type: 'VerifyPayment', amount_verified: 10500 }, { ...admin, now: NOW }),
    )

    expect(refused.reason).toMatch(/30500 is due/)
  })

  it('refuses to verify a Payment proof nobody uploaded, or a zero amount', () => {
    const booking: BookingState = { ...approvedBooking(), status: 'Payment Pending', payment_plan: 'full' }

    expectRefused(applyAction(booking, { type: 'VerifyPayment', amount_verified: 10500 }, { ...admin, now: NOW }))
    expectRefused(
      applyAction(
        { ...booking, payment_proof_url: 'gs://proofs/transfer.jpg' },
        { type: 'VerifyPayment', amount_verified: 0 },
        { ...admin, now: NOW },
      ),
    )
  })

  it('lets the Admin reject a blurry proof and the Guest send another inside the same stage', () => {
    const booking: BookingState = {
      ...approvedBooking(),
      status: 'Payment Pending',
      payment_plan: 'full',
      payment_proof_url: 'gs://proofs/blurry.jpg',
    }

    const rejected = expectOk(
      applyAction(
        booking,
        { type: 'RejectPaymentProof', reason: 'Screenshot is cut off — resend the full confirmation', guestResubmits: true },
        { ...admin, now: NOW },
      ),
    )

    expect(rejected.patch.status).toBe('Payment Pending')
    expect(rejected.patch.payment_status).toBe('rejected')
    expect(rejected.patch.payment_proof_url).toBeNull()
    expect(rejected.entries[0]).toMatchObject({
      from_status: 'Payment Pending',
      to_status: 'Payment Pending',
      reason: 'Screenshot is cut off — resend the full confirmation',
    })

    const resent = expectOk(
      applyAction(
        { ...booking, ...rejected.patch },
        { type: 'UploadPaymentProof', payment_proof_url: 'gs://proofs/clear.jpg' },
        { ...guest, now: NOW },
      ),
    )
    expect(resent.patch.payment_status).toBe('pending')
    expect(resent.patch.payment_reject_reason).toBeNull()
  })

  it('cancels the Booking when a rejected proof is never resent — no verified money, nothing to refund', () => {
    const booking: BookingState = {
      ...approvedBooking(),
      status: 'Payment Pending',
      payment_plan: 'full',
      payment_proof_url: 'gs://proofs/blurry.jpg',
    }

    const cancelled = expectOk(
      applyAction(
        booking,
        { type: 'RejectPaymentProof', reason: 'No matching transfer found', guestResubmits: false },
        { ...admin, now: NOW },
      ),
    )

    expect(cancelled.patch.status).toBe('Cancelled')
    expect(cancelled.patch.refund_status).toBe('none')
    expect(cancelled.patch.refund_total).toBeUndefined()
  })
})

describe('applyAction — cancellation and the Refund pipeline', () => {
  it('cancels for free while no money has been verified', () => {
    const cancelled = expectOk(
      applyAction(approvedBooking(), { type: 'Cancel', reason: 'Plans changed' }, { ...guest, now: NOW }),
    )

    expect(cancelled.patch.status).toBe('Cancelled')
    expect(cancelled.patch.refund_status).toBe('none')
    expect(cancelled.patch.cancellation_reason).toBe('Plans changed')
    expect(cancelled.entries[0]).toMatchObject({ to_status: 'Cancelled', reason: 'Plans changed' })
  })

  it('starts the Refund pipeline when a paid Reservation is cancelled, settling the deposit and the policy', () => {
    const booking = reserve(approvedBooking())
    expect(booking.status).toBe('Reserved')

    const cancelled = expectOk(
      applyAction(
        booking,
        {
          type: 'Cancel',
          reason: 'Family emergency',
          refund: { rateCard: RATE_CARD, policy: { refundPercent: 50 } },
        },
        { ...guest, now: NOW },
      ),
    )

    expect(cancelled.patch.status).toBe('Cancelled')
    expect(cancelled.patch.refund_status).toBe('initiated')
    // Half of the ₱30,000 stay, plus the whole ₱500 deposit: no damage claimed.
    expect(cancelled.patch.refund_total).toBe(15500)
    expect(booking.amount_verified).toBe(30500)
    expect(cancelled.patch.refund_breakdown).toEqual({
      stayTotal: 30000,
      stayRefund: 15000,
      depositHeld: 500,
      damageDeduction: 0,
      depositRefund: 500,
      refundTotal: 15500,
    })
  })

  it('settles a verified damage claim out of the deposit before refunding the remainder', () => {
    const booking = reserve(approvedBooking())

    const cancelled = expectOk(
      applyAction(
        booking,
        {
          type: 'Cancel',
          refund: { rateCard: RATE_CARD, policy: { refundPercent: 100 }, damageDeduction: 200 },
        },
        { ...admin, now: NOW },
      ),
    )

    expect(cancelled.patch.refund_total).toBe(30300)
  })

  it('refunds nothing beyond the money the Admin verified', () => {
    const booking = reserve(approvedBooking())

    const cancelled = expectOk(
      applyAction(
        booking,
        { type: 'Cancel', refund: { rateCard: RATE_CARD, policy: { refundPercent: 100 } } },
        { ...guest, now: NOW },
      ),
    )

    // ₱10,500 was verified against a ₱30,500 quote, so ₱10,500 is the most
    // that can come back: the system never returns money it never took.
    const partPaid: BookingState = { ...booking, amount_verified: 10500 }
    const partRefund = expectOk(
      applyAction(
        partPaid,
        { type: 'Cancel', refund: { rateCard: RATE_CARD, policy: { refundPercent: 100 } } },
        { ...guest, now: NOW },
      ),
    )
    expect(partRefund.patch.refund_total).toBe(10500)
  })

  it('records the Refund as returned once the money is back with the Guest', () => {
    const booking = reserve(approvedBooking())
    const cancelled = expectOk(
      applyAction(booking, { type: 'Cancel', refund: { policy: { refundPercent: 100 } } }, { ...guest, now: NOW }),
    )

    const refunded = expectOk(
      applyAction({ ...booking, ...cancelled.patch }, { type: 'MarkRefunded' }, { ...admin, now: NOW }),
    )

    expect(refunded.patch.status).toBe('Cancelled')
    expect(refunded.patch.refund_status).toBe('refunded')
    expect(refunded.entries[0]).toMatchObject({
      action: 'MarkRefunded',
      from_status: 'Cancelled',
      to_status: 'Cancelled',
      actor: 'admin',
    })
  })

  it('refuses to mark a Refund returned when none was ever initiated', () => {
    const booking: BookingState = { ...approvedBooking(), status: 'Cancelled', refund_status: 'none' }

    expectRefused(applyAction(booking, { type: 'MarkRefunded' }, { ...admin, now: NOW }))
  })
})

describe('applyAction — nothing happens after the hold runs out', () => {
  it('refuses a Guest action on a Booking whose Date hold has already expired', () => {
    const tooLate = '2026-09-21T00:00:01.000Z'

    const refused = expectRefused(
      applyAction(pendingBooking(), { type: 'UploadKyc', kyc_id_url: 'gs://ids/maria.jpg' }, { ...guest, now: tooLate }),
    )

    expect(refused.reason).toMatch(/Date hold ran out/)
  })

  it('refuses the Admin approval on a Booking whose hold expired mid-review', () => {
    const booking: BookingState = { ...pendingBooking(), status: 'KYC Submitted', kyc_status: 'submitted' }

    expectRefused(
      applyAction(booking, { type: 'Approve', availability: noConflicts }, { ...admin, now: '2026-09-22T00:00:00.000Z' }),
    )
  })

  it('materialises Expired for a Booking stored before holds existed, so it cannot hold dates forever', () => {
    const legacy: BookingState = { ...pendingBooking(), hold_expires_at: null }

    const expired = expectOk(applyAction(legacy, { type: 'Expire' }, { ...system, now: NOW }))
    expect(expired.patch.status).toBe('Expired')
  })

  it('still lets the Admin review a Booking with no hold recorded, so a legacy Booking is not stranded', () => {
    const legacy: BookingState = {
      ...pendingBooking(),
      hold_expires_at: null,
      status: 'KYC Submitted',
      kyc_status: 'submitted',
    }

    // The read-time rule stops actions only where a hold actually ran out.
    const approved = expectOk(
      applyAction(legacy, { type: 'Approve', availability: noConflicts }, { ...admin, now: '2027-01-01T00:00:00.000Z' }),
    )
    expect(approved.patch.status).toBe('Approved')
  })
})

// Flow §2 step 6b: refusing an ID asks the Guest for another one inside the
// remaining hold, so it must not be terminal — while refusing the Booking
// outright releases the dates. Two decisions, two actions.
describe('applyAction — the KYC decision', () => {
  const submitted = (): BookingState => ({
    ...pendingBooking(),
    status: 'KYC Submitted',
    kyc_status: 'submitted',
    kyc_id_url: 'gs://kyc/anon/HDL-4821/id.jpg',
  })

  it('refuses an ID without ending the Booking, so the Guest can send another', () => {
    const refusedId = expectOk(
      applyAction(submitted(), { type: 'RejectKyc', reason: 'The photo is cut off at the edges' }, { ...admin, now: NOW }),
    )

    expect(refusedId.patch.status).toBe('KYC Submitted')
    expect(refusedId.patch.kyc_status).toBe('rejected')
    expect(refusedId.patch.kyc_reject_reason).toBe('The photo is cut off at the edges')
    // The Date hold is untouched: the Guest still has the time they had left.
    expect(refusedId.patch.hold_expires_at).toBeUndefined()
    expect(refusedId.entries[0]).toMatchObject({
      action: 'RejectKyc',
      from_status: 'KYC Submitted',
      to_status: 'KYC Submitted',
      reason: 'The photo is cut off at the edges',
    })
  })

  it('lets the Guest resubmit inside the same hold, clearing the rejection', () => {
    const refusedId = expectOk(
      applyAction(submitted(), { type: 'RejectKyc', reason: 'Expired ID' }, { ...admin, now: NOW }),
    )
    const resubmitted = expectOk(
      applyAction(
        { ...submitted(), ...refusedId.patch },
        { type: 'UploadKyc', kyc_id_url: 'gs://kyc/anon/HDL-4821/id-2.jpg' },
        { ...guest, now: NOW },
      ),
    )

    expect(resubmitted.patch.status).toBe('KYC Submitted')
    expect(resubmitted.patch.kyc_status).toBe('submitted')
    expect(resubmitted.patch.kyc_id_url).toBe('gs://kyc/anon/HDL-4821/id-2.jpg')
    expect(resubmitted.patch.kyc_reject_reason).toBeNull()
  })

  it('needs a reason, because a Guest who is not told why cannot fix it', () => {
    expectRefused(applyAction(submitted(), { type: 'RejectKyc', reason: '   ' }, { ...admin, now: NOW }))
  })

  it('is the Admin’s decision, not the Guest’s', () => {
    expectRefused(
      applyAction(submitted(), { type: 'RejectKyc', reason: 'nope' }, { ...guest, now: NOW }),
    )
  })

  it('cannot be taken before an ID has been submitted', () => {
    expectRefused(applyAction(pendingBooking(), { type: 'RejectKyc', reason: 'nope' }, { ...admin, now: NOW }))
  })

  it('still refuses a Booking outright, releasing its dates', () => {
    const rejected = expectOk(
      applyAction(submitted(), { type: 'Reject', reason: 'Dates can no longer be offered' }, { ...admin, now: NOW }),
    )

    expect(rejected.patch.status).toBe('Rejected')
    // Rejected is terminal, so the dates go back into the pool (G1).
    expect(holdsDates('Rejected')).toBe(false)
  })
})

describe('applyAction — the Admin refusing dates that are already taken', () => {
  it('names the Booking in the way, so the Admin can offer alternatives', () => {
    const booking: BookingState = { ...pendingBooking(), status: 'KYC Submitted', kyc_status: 'submitted' }

    const refused = expectRefused(
      applyAction(
        booking,
        {
          type: 'Approve',
          availability: {
            unitsAvailable: 1,
            bookings: [
              {
                id: 'book-9',
                accommodation: 'main-house',
                check_in: '2026-10-02',
                check_out: '2026-10-07',
                status: 'Reserved',
              },
            ],
          },
        },
        { ...admin, now: NOW },
      ),
    )

    expect(refused.conflicts).toHaveLength(1)
    expect(refused.conflicts?.[0]).toMatchObject({ check_in: '2026-10-02', check_out: '2026-10-07' })
    // The Booking is untouched, so the Guest keeps their hold while the Admin
    // offers them other dates.
    expect(refused.ok).toBe(false)
  })
})

// The Dart app submits the ID and its receipt in one step
// (lib/models/booking.dart `applyKycSubmitted({idUrl, receiptUrl})`), and
// the Admin app reviews both. The web cannot send only half of what the Admin expects.
describe('applyAction — UploadKyc with a receipt', () => {
  it('records the ID and the receipt together', () => {
    const uploaded = expectOk(
      applyAction(
        pendingBooking(),
        {
          type: 'UploadKyc',
          kyc_id_url: 'https://storage/kyc/u1/HDL-4821/id.jpg',
          kyc_receipt_url: 'https://storage/kyc/u1/HDL-4821/receipt.png',
        },
        { ...guest, now: NOW },
      ),
    )

    expect(uploaded.patch.status).toBe('KYC Submitted')
    expect(uploaded.patch.kyc_id_url).toBe('https://storage/kyc/u1/HDL-4821/id.jpg')
    expect(uploaded.patch.kyc_receipt_url).toBe('https://storage/kyc/u1/HDL-4821/receipt.png')
  })

  it('refuses a receipt on its own, because the ID is what the Admin has to see', () => {
    const refused = expectRefused(
      applyAction(
        pendingBooking(),
        { type: 'UploadKyc', kyc_id_url: '   ', kyc_receipt_url: 'https://storage/receipt.png' },
        { ...guest, now: NOW },
      ),
    )

    expect(refused.reason).toMatch(/government ID/i)
  })

  it('leaves a receipt already on file alone when the Guest resends just the ID', () => {
    const withReceipt = expectOk(
      applyAction(
        pendingBooking(),
        {
          type: 'UploadKyc',
          kyc_id_url: 'https://storage/id.jpg',
          kyc_receipt_url: 'https://storage/receipt.png',
        },
        { ...guest, now: NOW },
      ),
    )
    const resent = expectOk(
      applyAction(
        { ...pendingBooking(), ...withReceipt.patch, kyc_status: 'rejected', kyc_reject_reason: 'The photo was cut off.' },
        { type: 'UploadKyc', kyc_id_url: 'https://storage/id-2.jpg' },
        { ...guest, now: NOW },
      ),
    )

    expect(resent.patch.kyc_id_url).toBe('https://storage/id-2.jpg')
    expect(resent.patch).not.toHaveProperty('kyc_receipt_url')
  })
})

// A Booking with its ID on file, parked at whatever status the test names.
// The Date hold was released at approval, so nothing here can read as Expired.
function bookingAt(status: string, overrides: Partial<BookingState> = {}): BookingState {
  return {
    ...pendingBooking(),
    status: status as BookingState['status'],
    kyc_status: 'approved',
    kyc_id_url: 'gs://ids/maria.jpg',
    kyc_receipt_url: 'gs://ids/maria-receipt.jpg',
    hold_expires_at: null,
    ...overrides,
  }
}

describe('applyAction — PurgeKyc: the ID leaves after the stay', () => {
  it('clears the ID and receipt URLs without moving the Booking, and logs the purge', () => {
    const result = expectOk(applyAction(bookingAt('Staying'), { type: 'PurgeKyc' }, { ...admin, now: NOW }))

    expect(result.patch.kyc_id_url).toBeNull()
    expect(result.patch.kyc_receipt_url).toBeNull()
    expect(result.patch.status).toBe('Staying')
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]).toMatchObject({
      action: 'PurgeKyc',
      from_status: 'Staying',
      to_status: 'Staying',
      actor: 'admin',
      actor_id: 'admin-1',
    })
    expect(result.entries[0].reason).toMatch(/purged/i)
  })

  it('is available from Staying, Checked-Out and Completed — erasure does not wait for the door to close', () => {
    for (const status of ['Staying', 'Checked-Out', 'Completed']) {
      expect(applyAction(bookingAt(status), { type: 'PurgeKyc' }, { ...admin, now: NOW }).ok).toBe(true)
    }
  })

  it('refuses while the ID is still working: before the stay, or once it has ended as a stay', () => {
    // Not yet Reserved — the Admin still needs the ID to trust the person at the door.
    expectRefused(applyAction(bookingAt('Reserved'), { type: 'PurgeKyc' }, { ...admin, now: NOW }))
    expectRefused(applyAction(pendingBooking(), { type: 'PurgeKyc' }, { ...admin, now: NOW }))
  })

  it('is the Admin’s call, not the Guest’s and not the system’s', () => {
    expectRefused(applyAction(bookingAt('Staying'), { type: 'PurgeKyc' }, { ...guest, now: NOW }))
    expectRefused(applyAction(bookingAt('Staying'), { type: 'PurgeKyc' }, { ...system, now: NOW }))
  })

  it('refuses when there is nothing left to erase, so the log never claims a false purge', () => {
    const alreadyGone = bookingAt('Staying', { kyc_id_url: null, kyc_receipt_url: null })
    expectRefused(applyAction(alreadyGone, { type: 'PurgeKyc' }, { ...admin, now: NOW }))
  })
})

describe('applyAction — RevokeKey: the Credential leaves a live stay', () => {
  it('moves the Booking nowhere — an access decision is logged, not a lifecycle step', () => {
    for (const status of ['Reserved', 'Checked-In', 'Staying']) {
      const result = expectOk(applyAction(bookingAt(status), { type: 'RevokeKey' }, { ...admin, now: NOW }))
      expect(result.patch.status).toBe(status)
      expect(result.entries[0]).toMatchObject({ action: 'RevokeKey', from_status: status, to_status: status, actor: 'admin' })
    }
  })

  it('is the Admin’s: a Guest cannot revoke their own way in', () => {
    expectRefused(applyAction(bookingAt('Staying'), { type: 'RevokeKey' }, { ...guest, now: NOW }))
  })

  it('refuses before a Credential exists and after the stay is over', () => {
    // No credential is issued before Reserved, and a Completed stay has none to pull.
    expectRefused(applyAction(pendingBooking(), { type: 'RevokeKey' }, { ...admin, now: NOW }))
    expectRefused(applyAction(bookingAt('Completed'), { type: 'RevokeKey' }, { ...admin, now: NOW }))
    expectRefused(applyAction(bookingAt('Checked-Out'), { type: 'RevokeKey' }, { ...admin, now: NOW }))
  })
})
