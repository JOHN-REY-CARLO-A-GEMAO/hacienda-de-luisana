import { applyAction, holdsDates, type BookingState } from '../../src/lib/booking'

// A Booking as stored, mid-review: submitted an hour ago, so its Date hold has
// 23 hours left, and the Admin has not reviewed it yet.
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
  hold_expires_at: HOLD_EXPIRY,
  created_at: '2026-09-20T00:00:00.000Z',
  payment_proof_url: 'payments/guest-1/HDL-4821/proof.jpg',
  payment_plan: 'down-payment',
  payment_status: 'pending',
  amount_claimed: 15000,
  amount_due: 15000,
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

    // The Admin accepts the downpayment screenshot. That confirms the Booking
    // and firms the dates by dropping the hold.
    const approval = expectOk(
      applyAction(booking, { type: 'Approve', availability: noConflicts }, { ...admin, now: NOW }),
    )
    expect(approval.patch.status).toBe('Approved')
    expect(approval.patch.payment_status).toBe('verified')
    expect(approval.patch.hold_expires_at).toBeNull()
    booking = { ...booking, ...approval.patch }

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

    const approved = expectOk(
      applyAction(booking, { type: 'Approve', availability: noConflicts }, { ...admin, now: NOW }),
    )
    expect(approved.entries).toEqual([
      {
        booking_id: 'book-1',
        action: 'Approve',
        from_status: 'Pending',
        to_status: 'Approved',
        actor: 'admin',
        actor_id: 'admin-1',
        actor_name: 'Ana Luisana',
        at: NOW,
      },
    ])

    const plan = expectOk(
      applyAction(
        { ...pendingBooking(), status: 'Payment Pending', hold_expires_at: null },
        { type: 'ChoosePaymentPlan', plan: 'full', rateCard: { nightlyRate: 10000, securityDeposit: 500 } },
        { ...guest, now: NOW },
      ),
    )
    expect(plan.entries[0]).toMatchObject({
      action: 'ChoosePaymentPlan',
      from_status: 'Payment Pending',
      to_status: 'Payment Pending',
      actor: 'guest',
      actor_name: 'Maria Santos',
      at: NOW,
    })
  })

  it('records the reason a Booking was refused, so the Guest knows what to fix', () => {
    const booking: BookingState = { ...pendingBooking(), status: 'Payment Pending' }

    const rejected = expectOk(
      applyAction(
        booking,
        { type: 'Reject', reason: 'The Guest stopped replying — the dates go back into the pool' },
        { ...admin, now: NOW },
      ),
    )

    expect(rejected.patch.status).toBe('Rejected')
    expect(rejected.patch.rejection_reason).toBe('The Guest stopped replying — the dates go back into the pool')
    expect(rejected.entries[0]).toMatchObject({
      to_status: 'Rejected',
      reason: 'The Guest stopped replying — the dates go back into the pool',
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
  it('refuses to approve a Booking that has already passed review', () => {
    const refused = expectRefused(
      applyAction(
        { ...pendingBooking(), status: 'Payment Pending' },
        { type: 'Approve', availability: noConflicts },
        { ...admin, now: NOW },
      ),
    )

    expect(refused.reason).toMatch(/Approve needs a Booking in Pending/)
  })

  it('refuses to approve into dates another Booking already holds', () => {
    const booking: BookingState = { ...pendingBooking() }

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

  it('lets the Guest resend a payment proof inside the same Payment Pending stage', () => {
    const booking: BookingState = {
      ...pendingBooking(),
      status: 'Payment Pending',
      payment_plan: 'full',
      payment_status: 'rejected',
      payment_reject_reason: 'Photo was blurred',
      payment_proof_url: 'gs://proofs/blurry.jpg',
      hold_expires_at: null,
    }

    const resent = expectOk(
      applyAction(
        booking,
        {
          type: 'UploadPaymentProof',
          payment_proof_url: 'gs://proofs/clear.jpg',
          payment_reference: '1234567890123',
          amount_claimed: 10500,
        },
        { ...guest, now: NOW },
      ),
    )

    expect(resent.patch.status).toBe('Payment Pending')
    expect(resent.patch.payment_status).toBe('pending')
    // The Admin's rejection is cleared: the Guest has answered it.
    expect(resent.patch.payment_reject_reason).toBeNull()
    expect(resent.patch.payment_proof_url).toBe('gs://proofs/clear.jpg')
    // The dates stay put: an approval already stopped the hold countdown.
    expect(resent.patch.hold_expires_at).toBeUndefined()
  })

  it('refuses to verify money for a Booking the Admin has not approved', () => {
    const refused = expectRefused(
      applyAction(pendingBooking(), { type: 'VerifyPayment', amount_verified: 10500 }, { ...admin, now: NOW }),
    )

    expect(refused.reason).toMatch(/Payment Pending/)
  })

  it('refuses every action on a Booking that has already finished', () => {
    const cancelled: BookingState = { ...pendingBooking(), status: 'Cancelled' }

    expectRefused(
      applyAction(cancelled, { type: 'UploadPaymentProof', payment_proof_url: 'x' }, { ...guest, now: NOW }),
    )
    expectRefused(applyAction(cancelled, { type: 'Approve', availability: noConflicts }, { ...admin, now: NOW }))
    expectRefused(applyAction(cancelled, { type: 'Cancel' }, { ...guest, now: NOW }))
    expectRefused(applyAction(cancelled, { type: 'Expire' }, { ...system, now: NOW }))
  })

  it('refuses an action from somebody who cannot take it', () => {
    const booking: BookingState = { ...pendingBooking() }

    // A Guest cannot approve their own Booking; the Admin's review is the point.
    const refused = expectRefused(
      applyAction(booking, { type: 'Approve', availability: noConflicts }, { ...guest, now: NOW }),
    )
    expect(refused.reason).toMatch(/cannot/i)

    // And a Guest cannot verify their own money — that is the Admin's call.
    expectRefused(
      applyAction(
        { ...booking, status: 'Payment Pending', payment_proof_url: 'gs://proofs/x.jpg' },
        { type: 'VerifyPayment', amount_verified: 100 },
        { ...guest, now: NOW },
      ),
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
    const booking: BookingState = { ...pendingBooking(), status: 'Payment Pending', hold_expires_at: null }

    expectRefused(applyAction(booking, { type: 'Expire' }, { ...system, now: '2026-09-25T00:00:00.000Z' }))
  })
})

// Flow §2 steps 7–11 and ADR-0001: the Admin approves first, money moves last,
// and verified money only ever leaves through the Refund pipeline.
const RATE_CARD = { nightlyRate: 10000, securityDeposit: 500, downPaymentPercent: 50 }

/** A Booking the Admin has approved — parked in Payment Pending, its hold stopped. */
function approvedBooking(): BookingState {
  return {
    ...pendingBooking(),
    status: 'Payment Pending',
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
      {
        type: 'UploadPaymentProof',
        payment_proof_url: 'gs://proofs/transfer.jpg',
        payment_reference: '1234567890123',
        amount_claimed: 10500,
      },
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

  it('does not add a policy stamp when no policy snapshot was supplied', () => {
    const chosen = expectOk(
      applyAction(
        approvedBooking(),
        { type: 'ChoosePaymentPlan', plan: 'full', rateCard: RATE_CARD },
        { ...guest, now: NOW },
      ),
    )

    expect(chosen.patch).not.toHaveProperty('policy_version')
    expect(chosen.patch).not.toHaveProperty('policy_effective_date')
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

  it('takes a Payment proof only when the Guest has submitted all of it', () => {
    // A Payment proof is three things the Admin cannot supply: the photo, the
    // reference read off it and the amount it claims. Any one of them missing
    // leaves the Admin a Verify Payment button with nothing to check, so the
    // Payment proof is refused whole rather than stored as a photo and a hope.
    const booking: BookingState = { ...approvedBooking(), status: 'Payment Pending', payment_plan: 'full' }
    const whole = {
      payment_proof_url: 'gs://proofs/transfer.jpg',
      payment_reference: '1234567890123',
      amount_claimed: 10500,
    }

    for (const partial of [
      { ...whole, payment_proof_url: '  ' },
      { ...whole, payment_reference: undefined },
      { ...whole, payment_reference: '   ' },
      { ...whole, amount_claimed: undefined },
    ]) {
      expectRefused(applyAction(booking, { type: 'UploadPaymentProof', ...partial }, { ...guest, now: NOW }))
    }

    const accepted = expectOk(applyAction(booking, { type: 'UploadPaymentProof', ...whole }, { ...guest, now: NOW }))
    // A whole receipt lands all three, so the Admin reads the Booking and finds
    // the reference and the amount already on it.
    expect(accepted.patch).toMatchObject(whole)
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
        {
          type: 'UploadPaymentProof',
          payment_proof_url: 'gs://proofs/clear.jpg',
          payment_reference: '1234567890123',
          amount_claimed: 10500,
        },
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

  it('uses the saved rate, deposit and refund-policy snapshot after rates are republished', () => {
    const booking = {
      ...reserve(approvedBooking()),
      refund_policy_snapshot: { refund_percent: 25, deposit_refund_percent: 50 },
    }
    const cancelled = expectOk(applyAction(
      booking,
      {
        type: 'Cancel',
        refund: {
          rateCard: { nightlyRate: 99000, securityDeposit: 99000 },
          policy: { refundPercent: 100, depositRefundPercent: 100 },
        },
      },
      { ...guest, now: NOW },
    ))
    expect(cancelled.patch.refund_breakdown).toEqual({
      stayTotal: 30000,
      stayRefund: 7500,
      depositHeld: 500,
      damageDeduction: 0,
      depositRefund: 250,
      refundTotal: 7750,
    })
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
      applyAction(pendingBooking(), { type: 'Cancel', reason: 'Plans changed' }, { ...guest, now: tooLate }),
    )

    expect(refused.reason).toMatch(/Date hold ran out/)
  })

  it('refuses the Admin approval on a Booking whose hold expired mid-review', () => {
    expectRefused(
      applyAction(
        pendingBooking(),
        { type: 'Approve', availability: noConflicts },
        { ...admin, now: '2026-09-22T00:00:00.000Z' },
      ),
    )
  })

  it('materialises Expired for a Booking stored before holds existed, so it cannot hold dates forever', () => {
    const legacy: BookingState = { ...pendingBooking(), hold_expires_at: null }

    const expired = expectOk(applyAction(legacy, { type: 'Expire' }, { ...system, now: NOW }))
    expect(expired.patch.status).toBe('Expired')
  })

  it('still lets the Admin review a Booking with no hold recorded, so a legacy Booking is not stranded', () => {
    const legacy: BookingState = { ...pendingBooking(), hold_expires_at: null }

    // The read-time rule stops actions only where a hold actually ran out.
    const approved = expectOk(
      applyAction(legacy, { type: 'Approve', availability: noConflicts }, { ...admin, now: '2027-01-01T00:00:00.000Z' }),
    )
    expect(approved.patch.status).toBe('Approved')
  })
})

// Flow §2 step 6b: refusing the Booking outright releases the dates, so it is a
// decision with its own guard rails — a reason, and the Admin's to make.
describe('applyAction — the review decision', () => {
  it('needs a reason, because a Guest who is not told why cannot fix it', () => {
    expectRefused(applyAction(pendingBooking(), { type: 'Reject', reason: '   ' }, { ...admin, now: NOW }))
  })

  it('is the Admin’s decision, not the Guest’s', () => {
    expectRefused(applyAction(pendingBooking(), { type: 'Reject', reason: 'nope' }, { ...guest, now: NOW }))
  })

  it('can be taken while the Booking waits for review and while it waits for payment', () => {
    expect(applyAction(pendingBooking(), { type: 'Reject', reason: 'x' }, { ...admin, now: NOW }).ok).toBe(true)
    expect(
      applyAction(
        { ...pendingBooking(), status: 'Payment Pending' },
        { type: 'Reject', reason: 'x' },
        { ...admin, now: NOW },
      ).ok,
    ).toBe(true)
    // Once the money is verified the Booking is Reserved — a pre-money refusal
    // no longer fits; cancellation with its Refund pipeline does.
    expect(
      applyAction(
        { ...pendingBooking(), status: 'Reserved', hold_expires_at: null },
        { type: 'Reject', reason: 'x' },
        { ...admin, now: NOW },
      ).ok,
    ).toBe(false)
  })

  it('still refuses a Booking outright, releasing its dates', () => {
    const rejected = expectOk(
      applyAction(
        { ...pendingBooking(), status: 'Payment Pending' },
        { type: 'Reject', reason: 'Dates can no longer be offered' },
        { ...admin, now: NOW },
      ),
    )

    expect(rejected.patch.status).toBe('Rejected')
    // Rejected is terminal, so the dates go back into the pool (G1).
    expect(holdsDates('Rejected')).toBe(false)
  })
})

describe('applyAction — the Admin refusing dates that are already taken', () => {
  it('names the Booking in the way, so the Admin can offer alternatives', () => {
    const booking: BookingState = { ...pendingBooking() }

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

// A Booking parked at whatever status the test names.
// The Date hold was released at approval, so nothing here can read as Expired.
function bookingAt(status: string, overrides: Partial<BookingState> = {}): BookingState {
  return {
    ...pendingBooking(),
    status: status as BookingState['status'],
    hold_expires_at: null,
    ...overrides,
  }
}

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
