import { applyAction, type BookingState } from '../../src/lib/booking'

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
const host = { actor: 'host', actor_id: 'host-1', actor_name: 'Ana Luisana' } as const
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
      applyAction(booking, { type: 'Approve', availability: noConflicts }, { ...host, now: NOW }),
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
        { ...host, now: NOW },
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

    const checkOut = expectOk(applyAction(booking, { type: 'CheckOut' }, { ...host, now: NOW }))
    expect(checkOut.patch.status).toBe('Checked-Out')
    booking = { ...booking, ...checkOut.patch }

    const completed = expectOk(applyAction(booking, { type: 'Complete' }, { ...host, now: NOW }))
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
        { ...host, now: NOW },
      ),
    )
    expect(approved.entries[0]).toMatchObject({
      action: 'Approve',
      from_status: 'KYC Submitted',
      to_status: 'Approved',
      actor: 'host',
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
        { ...host, now: NOW },
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

    applyAction(booking, { type: 'Approve', availability: noConflicts }, { ...host, now: NOW })

    expect(JSON.stringify(booking)).toBe(before)
  })
})

describe('applyAction — the rules that protect the Guest and the Host', () => {
  it('refuses to approve a Booking whose Guest has not submitted an ID', () => {
    const refused = expectRefused(
      applyAction(pendingBooking(), { type: 'Approve', availability: noConflicts }, { ...host, now: NOW }),
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
        { ...host, now: NOW },
      ),
    )

    // The Host needs to know exactly which Booking is standing in the way.
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
    // The Host's rejection is cleared: the Guest has answered it.
    expect(resubmitted.patch.kyc_reject_reason).toBeNull()
    // The dates are still held by the same booking: no new hold is placed.
    expect(resubmitted.patch.hold_expires_at).toBeUndefined()
  })

  it('refuses to verify money for a Booking the Host has not approved', () => {
    const refused = expectRefused(
      applyAction(pendingBooking(), { type: 'VerifyPayment', amount_verified: 10500 }, { ...host, now: NOW }),
    )

    expect(refused.reason).toMatch(/Payment Pending/)
  })

  it('refuses every action on a Booking that has already finished', () => {
    const cancelled: BookingState = { ...pendingBooking(), status: 'Cancelled' }

    expectRefused(applyAction(cancelled, { type: 'UploadKyc', kyc_id_url: 'x' }, { ...guest, now: NOW }))
    expectRefused(applyAction(cancelled, { type: 'Approve', availability: noConflicts }, { ...host, now: NOW }))
    expectRefused(applyAction(cancelled, { type: 'Cancel' }, { ...guest, now: NOW }))
    expectRefused(applyAction(cancelled, { type: 'Expire' }, { ...system, now: NOW }))
  })

  it('refuses an action from somebody who cannot take it', () => {
    const booking: BookingState = { ...pendingBooking(), status: 'KYC Submitted', kyc_status: 'submitted' }

    // A Guest cannot approve their own Booking; the Host's review is the point.
    const refused = expectRefused(
      applyAction(booking, { type: 'Approve', availability: noConflicts }, { ...guest, now: NOW }),
    )
    expect(refused.reason).toMatch(/cannot/i)

    // And the Host cannot upload the Guest's ID for them.
    expectRefused(
      applyAction(pendingBooking(), { type: 'UploadKyc', kyc_id_url: 'x' }, { ...host, now: NOW }),
    )
  })

  it('expires a Booking that waited too long for review, and releases its dates', () => {
    const expired = expectOk(
      applyAction(pendingBooking(), { type: 'Expire' }, { ...system, now: '2026-09-21T00:00:01.000Z' }),
    )

    expect(expired.patch.status).toBe('Expired')
    expect(expired.entries[0]).toMatchObject({ actor: 'system', to_status: 'Expired' })
  })

  it('refuses to expire a Booking the Host has already approved', () => {
    const booking: BookingState = { ...pendingBooking(), status: 'Approved', kyc_status: 'approved' }

    expectRefused(applyAction(booking, { type: 'Expire' }, { ...system, now: '2026-09-25T00:00:00.000Z' }))
  })
})

// Flow §2 steps 7–11 and ADR-0001: the Host approves first, money moves last,
// and verified money only ever leaves through the Refund pipeline.
const RATE_CARD = { nightlyRate: 10000, securityDeposit: 500, downPaymentPercent: 50 }

/** A Booking the Host has approved, with three nights quoted off the rate card. */
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
  // The Host verifies the whole of what the Guest was asked for.
  const paidInFull = afterPlan.amount_due! + afterPlan.security_deposit!
  const verified = expectOk(
    applyAction(afterPlan, { type: 'VerifyPayment', amount_verified: paidInFull }, { ...host, now: NOW }),
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

  it('refuses a payment plan the Host has not published', () => {
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
      applyAction(booking, { type: 'VerifyPayment', amount_verified: 10500 }, { ...host, now: NOW }),
    )

    expect(refused.reason).toMatch(/30500 is due/)
  })

  it('refuses to verify a Payment proof nobody uploaded, or a zero amount', () => {
    const booking: BookingState = { ...approvedBooking(), status: 'Payment Pending', payment_plan: 'full' }

    expectRefused(applyAction(booking, { type: 'VerifyPayment', amount_verified: 10500 }, { ...host, now: NOW }))
    expectRefused(
      applyAction(
        { ...booking, payment_proof_url: 'gs://proofs/transfer.jpg' },
        { type: 'VerifyPayment', amount_verified: 0 },
        { ...host, now: NOW },
      ),
    )
  })

  it('lets the Host reject a blurry proof and the Guest send another inside the same stage', () => {
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
        { ...host, now: NOW },
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
        { ...host, now: NOW },
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
        { ...host, now: NOW },
      ),
    )

    expect(cancelled.patch.refund_total).toBe(30300)
  })

  it('refunds nothing beyond the money the Host verified', () => {
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
      applyAction({ ...booking, ...cancelled.patch }, { type: 'MarkRefunded' }, { ...host, now: NOW }),
    )

    expect(refunded.patch.status).toBe('Cancelled')
    expect(refunded.patch.refund_status).toBe('refunded')
    expect(refunded.entries[0]).toMatchObject({
      action: 'MarkRefunded',
      from_status: 'Cancelled',
      to_status: 'Cancelled',
      actor: 'host',
    })
  })

  it('refuses to mark a Refund returned when none was ever initiated', () => {
    const booking: BookingState = { ...approvedBooking(), status: 'Cancelled', refund_status: 'none' }

    expectRefused(applyAction(booking, { type: 'MarkRefunded' }, { ...host, now: NOW }))
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

  it('refuses the Host approval on a Booking whose hold expired mid-review', () => {
    const booking: BookingState = { ...pendingBooking(), status: 'KYC Submitted', kyc_status: 'submitted' }

    expectRefused(
      applyAction(booking, { type: 'Approve', availability: noConflicts }, { ...host, now: '2026-09-22T00:00:00.000Z' }),
    )
  })

  it('materialises Expired for a Booking stored before holds existed, so it cannot hold dates forever', () => {
    const legacy: BookingState = { ...pendingBooking(), hold_expires_at: null }

    const expired = expectOk(applyAction(legacy, { type: 'Expire' }, { ...system, now: NOW }))
    expect(expired.patch.status).toBe('Expired')
  })

  it('still lets the Host review a Booking with no hold recorded, so a legacy Booking is not stranded', () => {
    const legacy: BookingState = {
      ...pendingBooking(),
      hold_expires_at: null,
      status: 'KYC Submitted',
      kyc_status: 'submitted',
    }

    // The read-time rule stops actions only where a hold actually ran out.
    const approved = expectOk(
      applyAction(legacy, { type: 'Approve', availability: noConflicts }, { ...host, now: '2027-01-01T00:00:00.000Z' }),
    )
    expect(approved.patch.status).toBe('Approved')
  })
})
