import {
  BOOKING_STATUSES,
  canTransition,
  datesOverlap,
  effectiveStatus,
  findDateConflicts,
  holdMsRemaining,
  type HoldBearingBooking,
  holdsDates,
  isHoldExpired,
  nightsBetween,
  normalizeStatus,
  paymentOptions,
  quoteStay,
  suggestAlternativeDates,
  settleRefund,
  type RateCard,
  type RefundPolicy,
  type BookingStatus,
} from '../../src/lib/booking'

describe('Booking status vocabulary', () => {
  it('is the canonical set from CONTEXT.md, in lifecycle order', () => {
    expect(BOOKING_STATUSES).toEqual([
      'Pending',
      'KYC Submitted',
      'Approved',
      'Payment Pending',
      'Payment Verified',
      'Reserved',
      'Checked-In',
      'Staying',
      'Checked-Out',
      'Completed',
      'Rejected',
      'Cancelled',
      'Expired',
    ])
  })

  it('does not include the retired status Confirmed', () => {
    expect(BOOKING_STATUSES).not.toContain('Confirmed')
  })
})

// Spec #9: "Existing stored values migrate on read (Confirmed → Reserved) so no
// data rewrite is needed."
describe('normalizeStatus migrates stored Booking statuses on read', () => {
  it('reads a stored Confirmed Booking as Reserved', () => {
    expect(normalizeStatus('Confirmed')).toBe('Reserved')
  })

  it('reads a canonical status as itself', () => {
    expect(normalizeStatus('Pending')).toBe('Pending')
    expect(normalizeStatus('KYC Submitted')).toBe('KYC Submitted')
    expect(normalizeStatus('Reserved')).toBe('Reserved')
  })

  it('tolerates the casing and separators used by the Flutter guest app', () => {
    expect(normalizeStatus('kyc_submitted')).toBe('KYC Submitted')
    expect(normalizeStatus('CHECKED-IN')).toBe('Checked-In')
    expect(normalizeStatus('  payment verified ')).toBe('Payment Verified')
    expect(normalizeStatus('confirmed')).toBe('Reserved')
  })

  it('reads a missing or unrecognised status as Pending, the start of the lifecycle', () => {
    expect(normalizeStatus(undefined)).toBe('Pending')
    expect(normalizeStatus('')).toBe('Pending')
    expect(normalizeStatus('Sold')).toBe('Pending')
  })
})

// CONTEXT.md § Booking status: Pending → KYC Submitted → Approved → Payment
// Pending → Payment Verified → Reserved → Checked-In → Staying → Checked-Out →
// Completed, with the terminal branches Rejected, Cancelled and Expired.
describe('canTransition', () => {
  it('walks the main lifecycle one step at a time', () => {
    const mainFlow: BookingStatus[] = [
      'Pending',
      'KYC Submitted',
      'Approved',
      'Payment Pending',
      'Payment Verified',
      'Reserved',
      'Checked-In',
      'Staying',
      'Checked-Out',
      'Completed',
    ]

    for (let i = 0; i < mainFlow.length - 1; i++) {
      expect(canTransition(mainFlow[i], mainFlow[i + 1])).toBe(true)
    }
  })

  it('refuses to skip the Host review or the payment verification', () => {
    // ADR-0001: approval happens before any money moves.
    expect(canTransition('Pending', 'Approved')).toBe(false)
    expect(canTransition('Pending', 'Payment Pending')).toBe(false)
    expect(canTransition('KYC Submitted', 'Payment Pending')).toBe(false)
    // Money is only ever trusted once the Host has verified the proof.
    expect(canTransition('Approved', 'Reserved')).toBe(false)
    expect(canTransition('Payment Pending', 'Reserved')).toBe(false)
    // No self-service arrival: Checked-In comes out of Reserved only.
    expect(canTransition('Approved', 'Checked-In')).toBe(false)
  })

  it('reaches every terminal branch from the statuses that are still live', () => {
    expect(canTransition('Pending', 'Expired')).toBe(true)
    expect(canTransition('Pending', 'Rejected')).toBe(true)
    expect(canTransition('Pending', 'Cancelled')).toBe(true)
    expect(canTransition('KYC Submitted', 'Rejected')).toBe(true)
    expect(canTransition('Approved', 'Rejected')).toBe(true)
    expect(canTransition('Approved', 'Cancelled')).toBe(true)
    expect(canTransition('Payment Pending', 'Cancelled')).toBe(true)
    expect(canTransition('Reserved', 'Cancelled')).toBe(true)
  })

  it('never leaves a terminal status, and never expires a Booking the Host has acted on', () => {
    for (const terminal of ['Completed', 'Rejected', 'Cancelled', 'Expired'] as BookingStatus[]) {
      for (const next of BOOKING_STATUSES) {
        expect(canTransition(terminal, next)).toBe(false)
      }
    }
    // ADR-0002: the Date hold is the claim a Booking places on its dates *while
    // it waits for review*. Once approved, the dates are firmly held.
    expect(canTransition('Approved', 'Expired')).toBe(false)
    expect(canTransition('Payment Pending', 'Expired')).toBe(false)
    expect(canTransition('Reserved', 'Expired')).toBe(false)
  })

  it('refuses an unknown status', () => {
    expect(canTransition('Sold' as BookingStatus, 'Reserved')).toBe(false)
  })
})

// Spec #9 / G2: availability is enforced by the system, not the eyeball. The
// same overlap rule is what the guest's date check, the Host's list and the
// approval-time re-check all apply.
describe('datesOverlap', () => {
  it('is true when two stays share a night', () => {
    expect(datesOverlap('2026-10-01', '2026-10-05', '2026-10-04', '2026-10-08')).toBe(true)
    expect(datesOverlap('2026-10-04', '2026-10-08', '2026-10-01', '2026-10-05')).toBe(true)
    expect(datesOverlap('2026-10-01', '2026-10-05', '2026-10-02', '2026-10-03')).toBe(true)
  })

  it('is false when the stays only touch at a check-out / check-in handover', () => {
    // Check-out is 12:00 NN and check-in is 2:00 PM on the same day: the
    // departing Guest's last night is the night before, so the dates do not clash.
    expect(datesOverlap('2026-10-01', '2026-10-05', '2026-10-05', '2026-10-08')).toBe(false)
    expect(datesOverlap('2026-10-05', '2026-10-08', '2026-10-01', '2026-10-05')).toBe(false)
    expect(datesOverlap('2026-10-01', '2026-10-02', '2026-10-06', '2026-10-07')).toBe(false)
  })

  it('treats an unparseable or empty date as no overlap, so a bad read cannot block the calendar', () => {
    expect(datesOverlap('2026-10-01', 'not-a-date', '2026-10-01', '2026-10-05')).toBe(false)
    expect(datesOverlap('', '2026-10-05', '2026-10-01', '2026-10-05')).toBe(false)
  })
})

// ADR-0002: nothing in the backend ever releases a hold. Expiry is applied when
// availability is read, by every surface that reads it, so a Guest view and the
// Host view can never disagree about a hold.
const HOLD = '2026-10-01T00:00:00.000Z'
const HOUR = 60 * 60 * 1000

describe('holdsDates', () => {
  it('is true for every status that still claims its dates', () => {
    for (const status of [
      'Pending',
      'KYC Submitted',
      'Approved',
      'Payment Pending',
      'Payment Verified',
      'Reserved',
      'Checked-In',
      'Staying',
      'Checked-Out',
    ] as BookingStatus[]) {
      expect(holdsDates(status)).toBe(true)
    }
  })

  it('is false for the terminal statuses, which release the dates', () => {
    for (const status of ['Completed', 'Rejected', 'Cancelled', 'Expired'] as BookingStatus[]) {
      expect(holdsDates(status)).toBe(false)
    }
  })
})

describe('hold expiry at read time', () => {
  it('expires a hold that has run past its 24 hours', () => {
    // The hold is alive up to its expiry instant and gone the moment it passes.
    expect(isHoldExpired({ status: 'Pending', hold_expires_at: HOLD }, HOLD)).toBe(false)
    expect(isHoldExpired({ status: 'Pending', hold_expires_at: HOLD }, Date.parse(HOLD) + 1)).toBe(true)
    expect(
      isHoldExpired({ status: 'Pending', hold_expires_at: HOLD }, new Date(Date.parse(HOLD) + 24 * HOUR).toISOString()),
    ).toBe(true)
  })

  it('expires a Booking still waiting for review that carries no hold expiry at all', () => {
    // A legacy document from before holds existed must not claim dates forever.
    expect(isHoldExpired({ status: 'Pending' }, HOLD)).toBe(true)
    expect(isHoldExpired({ status: 'KYC Submitted' }, HOLD)).toBe(true)
  })

  it('never expires a Booking the Host has already acted on', () => {
    const longPast = '2030-01-01T00:00:00.000Z'
    for (const status of [
      'Approved',
      'Payment Pending',
      'Reserved',
      'Checked-In',
      'Staying',
      'Checked-Out',
      'Completed',
      'Rejected',
      'Cancelled',
      'Expired',
    ] as BookingStatus[]) {
      expect(isHoldExpired({ status, hold_expires_at: HOLD }, longPast)).toBe(false)
    }
  })

  it('reports the hold a Guest has left, and zero once it has run out', () => {
    expect(holdMsRemaining({ status: 'Pending', hold_expires_at: HOLD }, Date.parse(HOLD) - 6 * HOUR)).toBe(6 * HOUR)
    expect(holdMsRemaining({ status: 'Pending', hold_expires_at: HOLD }, Date.parse(HOLD) + HOUR)).toBe(0)
  })

  it('reads an expired hold-bearing Booking as Expired, and leaves every other status alone', () => {
    expect(
      effectiveStatus({ status: 'Pending', hold_expires_at: HOLD }, Date.parse(HOLD) + 25 * HOUR),
    ).toBe('Expired')
    expect(
      effectiveStatus({ status: 'Reserved', hold_expires_at: HOLD }, Date.parse(HOLD) + 25 * HOUR),
    ).toBe('Reserved')
    expect(effectiveStatus({ status: 'Pending', hold_expires_at: HOLD }, Date.parse(HOLD) - HOUR)).toBe(
      'Pending',
    )
  })
})

describe('findDateConflicts', () => {
  const held = (
    id: string,
    checkIn: string,
    checkOut: string,
    extra: Partial<HoldBearingBooking> = {},
  ): HoldBearingBooking => ({
    id,
    accommodation: 'main-house',
    check_in: checkIn,
    check_out: checkOut,
    status: 'Pending',
    ...extra,
  })

  it('returns the stored Bookings whose nights a new request would take', () => {
    const bookings = [
      held('a', '2026-10-01', '2026-10-05', {
        status: 'Pending',
        hold_expires_at: new Date(Date.parse('2026-09-20T00:00:00.000Z') + 24 * HOUR).toISOString(),
      }),
      held('b', '2026-10-20', '2026-10-22', {
        status: 'Pending',
        hold_expires_at: new Date(Date.parse('2026-09-20T00:00:00.000Z') + 24 * HOUR).toISOString(),
      }),
    ]

    const conflicts = findDateConflicts(
      { accommodation: 'main-house', check_in: '2026-10-04', check_out: '2026-10-06' },
      bookings,
      { unitsAvailable: 1, now: '2026-09-20T00:00:00.000Z' },
    )

    expect(conflicts.map((c) => c.id)).toEqual(['a'])
  })

  it('ignores another Accommodation, terminal Bookings, and holds that have already expired', () => {
    const request = { accommodation: 'main-house', check_in: '2026-10-01', check_out: '2026-10-05' }
    const now = Date.parse(HOLD) + 25 * HOUR
    const bookings = [
      held('other-unit', '2026-10-01', '2026-10-05', { status: 'Reserved', accommodation: 'house-a-camping' }),
      held('cancelled', '2026-10-01', '2026-10-05', { status: 'Cancelled' }),
      held('expired-hold', '2026-10-01', '2026-10-05', { status: 'Pending', hold_expires_at: HOLD }),
      held('live', '2026-10-01', '2026-10-05', { status: 'Pending', hold_expires_at: new Date(now + HOUR).toISOString() }),
    ]

    const conflicts = findDateConflicts(request, bookings, {
      unitsAvailable: 1,
      now: new Date(now).toISOString(),
    })

    expect(conflicts.map((c) => c.id)).toEqual(['live'])
  })

  it('excludes the Booking being re-checked, so approving a Booking never conflicts with itself', () => {
    const bookings = [
      held('self', '2026-10-01', '2026-10-05', { status: 'KYC Submitted' }),
      held('other', '2026-10-03', '2026-10-06', { status: 'Reserved' }),
    ]

    // With two units the re-check has room: its own hold must not count against it.
    expect(
      findDateConflicts(
        { accommodation: 'main-house', check_in: '2026-10-01', check_out: '2026-10-05' },
        bookings,
        { unitsAvailable: 2, now: HOLD, excludeId: 'self' },
      ),
    ).toEqual([])

    // With one unit the other Booking is what stands in the way, never 'self'.
    expect(
      findDateConflicts(
        { accommodation: 'main-house', check_in: '2026-10-01', check_out: '2026-10-05' },
        bookings,
        { unitsAvailable: 1, now: HOLD, excludeId: 'self' },
      ).map((c) => c.id),
    ).toEqual(['other'])
  })

  it('only conflicts once every unit of a multi-unit Accommodation is taken', () => {
    const request = { accommodation: 'house-a-camping', check_in: '2026-10-01', check_out: '2026-10-03' }
    const first = held('first', '2026-10-01', '2026-10-03', {
      status: 'Reserved',
      accommodation: 'house-a-camping',
    })

    expect(findDateConflicts(request, [first], { unitsAvailable: 2, now: HOLD })).toEqual([])
    expect(findDateConflicts(request, [first], { unitsAvailable: 1, now: HOLD }).map((c) => c.id)).toEqual([
      'first',
    ])

    const second = held('second', '2026-10-01', '2026-10-03', {
      status: 'Pending',
      accommodation: 'house-a-camping',
      hold_expires_at: new Date(Date.parse(HOLD) + HOUR).toISOString(),
    })
    expect(
      findDateConflicts(request, [first, second], { unitsAvailable: 2, now: HOLD }).map((c) => c.id),
    ).toEqual(['first', 'second'])
  })

  it('counts the waiting queue for a Guest, but only committed Bookings at approval', () => {
    const request = { accommodation: 'main-house', check_in: '2026-10-01', check_out: '2026-10-05' }
    const bookings = [
      held('waiting', '2026-10-01', '2026-10-05', {
        status: 'KYC Submitted',
        hold_expires_at: new Date(Date.parse(HOLD) + HOUR).toISOString(),
      }),
      held('committed', '2026-10-01', '2026-10-05', { status: 'Reserved' }),
    ]

    // A Guest asking "are these dates free?" is told the truth: one unit, and
    // both Bookings are holding it.
    expect(
      findDateConflicts(request, bookings, { unitsAvailable: 1, now: HOLD }).map((c) => c.id).sort(),
    ).toEqual(['committed', 'waiting'])

    // Approving one of them is only blocked by the dates the Host has already
    // committed, so two Guests can queue for the same one-unit Accommodation.
    expect(
      findDateConflicts(request, bookings, {
        unitsAvailable: 1,
        now: HOLD,
        forApproval: true,
        excludeId: 'waiting',
      }).map((c) => c.id),
    ).toEqual(['committed'])
    expect(
      findDateConflicts(request, [bookings[0]], {
        unitsAvailable: 1,
        now: HOLD,
        forApproval: true,
        excludeId: 'waiting',
      }),
    ).toEqual([])
  })

  it('reports no conflict when there is no rate of units to compare against', () => {
    expect(
      findDateConflicts(
        { accommodation: 'other', check_in: '2026-10-01', check_out: '2026-10-03' },
        [held('a', '2026-10-01', '2026-10-03', { status: 'Reserved' })],
        { now: HOLD },
      ),
    ).toEqual([])
  })
})

// Ticket #10 / spec #9: the rate card, the Security deposit amount and the
// cancellation percentages are the Host's to publish, and this module invents
// none of them. Every number below is a test literal, and every function takes
// the policy as an argument.
describe('nightsBetween', () => {
  it('counts the nights a Guest occupies the Accommodation', () => {
    expect(nightsBetween('2026-10-01', '2026-10-04')).toBe(3)
    expect(nightsBetween('2026-10-01', '2026-10-02')).toBe(1)
  })

  it('is never zero or negative, matching the length-of-stay the site already shows', () => {
    expect(nightsBetween('2026-10-04', '2026-10-01')).toBe(1)
    expect(nightsBetween('2026-10-01', '2026-10-01')).toBe(1)
    expect(nightsBetween('2026-10-01', 'garbage')).toBe(1)
  })
})

describe('quoteStay', () => {
  const rateCard: RateCard = { nightlyRate: 10000, securityDeposit: 500 }

  it('is the nightly rate times the nights', () => {
    expect(quoteStay({ check_in: '2026-10-01', check_out: '2026-10-04' }, rateCard)).toBe(30000)
    expect(quoteStay({ check_in: '2026-10-01', check_out: '2026-10-02' }, rateCard)).toBe(10000)
  })
})

describe('paymentOptions', () => {
  // Flow §2 step 7: [50% Down Payment + Refundable Security Deposit] or
  // [Full Payment + Refundable Security Deposit].
  it('offers the Host a down payment and a full payment, both plus the deposit', () => {
    const options = paymentOptions(
      { check_in: '2026-10-01', check_out: '2026-10-04' },
      { nightlyRate: 10000, securityDeposit: 500, downPaymentPercent: 50 },
    )

    expect(options).toEqual([
      { plan: 'down-payment', stayTotal: 30000, dueNow: 15000, securityDeposit: 500, balance: 15000 },
      { plan: 'full', stayTotal: 30000, dueNow: 30000, securityDeposit: 500, balance: 0 },
    ])
  })

  it('quotes whole centavos, and the down payment and balance always re-add to the quote', () => {
    const options = paymentOptions(
      { check_in: '2026-10-01', check_out: '2026-10-02' },
      { nightlyRate: 1234.5678, securityDeposit: 0, downPaymentPercent: 50 },
    )

    // A rate card with a fraction of a centavo still quotes a sendable amount.
    expect(options[0]).toEqual({
      plan: 'down-payment',
      stayTotal: 1234.57,
      dueNow: 617.29,
      securityDeposit: 0,
      balance: 617.28,
    })
    expect(options[0].dueNow + options[0].balance).toBe(options[0].stayTotal)
  })

  it('offers full payment only when the Host has published no down payment percentage', () => {
    const options = paymentOptions(
      { check_in: '2026-10-01', check_out: '2026-10-02' },
      { nightlyRate: 10000, securityDeposit: 500 },
    )

    expect(options).toEqual([
      { plan: 'full', stayTotal: 10000, dueNow: 10000, securityDeposit: 500, balance: 0 },
    ])
  })
})

describe('settleRefund', () => {
  const rateCard: RateCard = { nightlyRate: 10000, securityDeposit: 500 }
  const stay = { check_in: '2026-10-01', check_out: '2026-10-04' }
  const cancelled = '2026-09-21T00:00:00.000Z'

  it('refunds the whole stay and the whole deposit when the policy is fully refundable', () => {
    expect(settleRefund(stay, { refundPercent: 100 }, { cancelledAt: cancelled, rateCard })).toEqual({
      stayTotal: 30000,
      stayRefund: 30000,
      depositHeld: 500,
      damageDeduction: 0,
      depositRefund: 500,
      refundTotal: 30500,
    })
  })

  it('applies the policy percentage the Host published, including zero', () => {
    expect(settleRefund(stay, { refundPercent: 50 }, { cancelledAt: cancelled, rateCard }).stayRefund).toBe(15000)
    expect(settleRefund(stay, { refundPercent: 50 }, { cancelledAt: cancelled, rateCard }).refundTotal).toBe(15500)
    const none = settleRefund(stay, { refundPercent: 0 }, { cancelledAt: cancelled, rateCard })
    expect(none.stayRefund).toBe(0)
    expect(none.refundTotal).toBe(500)
  })

  it('picks the policy tier by how long before check-in the Guest cancelled', () => {
    const policy: RefundPolicy = {
      tiers: [
        { minDaysBeforeCheckIn: 14, refundPercent: 100 },
        { minDaysBeforeCheckIn: 7, refundPercent: 50 },
        { minDaysBeforeCheckIn: 0, refundPercent: 0 },
      ],
    }

    // 14 days before check-in, to the day: the top tier still applies.
    expect(settleRefund(stay, policy, { cancelledAt: '2026-09-17T00:00:00.000Z', rateCard }).stayRefund).toBe(30000)
    // 13 days before: one day short of the top tier, so the middle one applies.
    expect(settleRefund(stay, policy, { cancelledAt: '2026-09-18T00:00:00.000Z', rateCard }).stayRefund).toBe(15000)
    // Exactly 7 days before: the middle tier's own boundary.
    expect(settleRefund(stay, policy, { cancelledAt: '2026-09-24T00:00:00.000Z', rateCard }).stayRefund).toBe(15000)
    // 6 days before: inside the middle tier's window, so nothing is refunded.
    expect(settleRefund(stay, policy, { cancelledAt: '2026-09-25T00:00:00.000Z', rateCard }).stayRefund).toBe(0)
    // Inside a day of check-in still counts as one day before it.
    expect(settleRefund(stay, policy, { cancelledAt: '2026-09-30T12:00:00.000Z', rateCard }).stayRefund).toBe(0)
    // Cancelling after check-in is the same as the last tier: no tier is skipped.
    expect(settleRefund(stay, policy, { cancelledAt: '2026-10-02T00:00:00.000Z', rateCard }).stayRefund).toBe(0)
  })

  it('settles a verified damage claim out of the Security deposit before refunding the remainder', () => {
    const settled = settleRefund(stay, { refundPercent: 100 }, {
      cancelledAt: cancelled,
      rateCard,
      damageDeduction: 200,
    })

    expect(settled).toEqual({
      stayTotal: 30000,
      stayRefund: 30000,
      depositHeld: 500,
      damageDeduction: 200,
      depositRefund: 300,
      refundTotal: 30300,
    })
  })

  it('never charges the Guest beyond the deposit they actually handed over', () => {
    const settled = settleRefund(stay, { refundPercent: 100 }, {
      cancelledAt: cancelled,
      rateCard,
      damageDeduction: 900,
    })

    expect(settled.damageDeduction).toBe(500)
    expect(settled.depositRefund).toBe(0)
    expect(settled.refundTotal).toBe(30000)
  })

  it('keeps the deposit when the Host has published it as non-refundable', () => {
    const settled = settleRefund(stay, { refundPercent: 100, depositRefundPercent: 0 }, {
      cancelledAt: cancelled,
      rateCard,
    })

    expect(settled.depositRefund).toBe(0)
    expect(settled.refundTotal).toBe(30000)
  })

  it('refunds nothing when no money was ever verified', () => {
    expect(settleRefund(stay, { refundPercent: 100 }, { cancelledAt: cancelled, rateCard, verifiedAmount: 0 })).toEqual({
      stayTotal: 30000,
      stayRefund: 0,
      depositHeld: 0,
      damageDeduction: 0,
      depositRefund: 0,
      refundTotal: 0,
    })
  })

  it('never refunds more than the money the Host actually verified', () => {
    // The Guest paid the deposit but only part of the stay before cancelling.
    const settled = settleRefund(stay, { refundPercent: 100 }, {
      cancelledAt: cancelled,
      rateCard,
      verifiedAmount: 10500,
    })

    expect(settled.refundTotal).toBe(10500)
    expect(settled.stayRefund).toBe(10000)
    expect(settled.depositRefund).toBe(500)
  })
})

// Ticket #13: a clash refuses the approval and offers alternative dates instead,
// so the Host keeps the Guest rather than losing them.
describe('suggestAlternativeDates', () => {
  const stored = (
    id: string,
    checkIn: string,
    checkOut: string,
    extra: Partial<HoldBearingBooking> = {},
  ): HoldBearingBooking => ({
    id,
    accommodation: 'main-house',
    check_in: checkIn,
    check_out: checkOut,
    status: 'Pending',
    ...extra,
  })

  const taken = stored('taken', '2026-10-01', '2026-10-05', { status: 'Reserved' })
  const request = { accommodation: 'main-house', check_in: '2026-10-01', check_out: '2026-10-04' }

  it('offers nothing when the requested dates are already free', () => {
    expect(
      suggestAlternativeDates({ ...request, check_in: '2026-11-01', check_out: '2026-11-04' }, [taken], {
        unitsAvailable: 1,
        now: HOLD,
      }),
    ).toEqual([])
  })

  it('offers the nearest free windows of the same length, soonest first', () => {
    const suggestions = suggestAlternativeDates(request, [taken], { unitsAvailable: 1, now: HOLD, limit: 4 })

    expect(suggestions.length).toBeGreaterThan(0)
    // Same Accommodation, same number of nights as the Guest asked for.
    for (const s of suggestions) {
      expect(s.accommodation).toBe('main-house')
      expect(nightsBetween(s.check_in, s.check_out)).toBe(3)
    }
    // Nearest free window first, in either direction: the Guest asked for
    // 1 Oct, so 28 Sep (three days nearer) beats 5 Oct (four days later).
    expect(suggestions[0]).toEqual({
      accommodation: 'main-house',
      check_in: '2026-09-28',
      check_out: '2026-10-01',
    })
    expect(suggestions[1]).toEqual({
      accommodation: 'main-house',
      check_in: '2026-10-05',
      check_out: '2026-10-08',
    })
    // Equidistant either way, the later window wins: postponing a trip is
    // easier than bringing it forward.
    expect(suggestions[2].check_in).toBe('2026-09-27')
    expect(suggestions[3].check_in).toBe('2026-10-06')
  })

  it('suggests only dates that are genuinely free by the same rule', () => {
    const suggestions = suggestAlternativeDates(request, [taken], { unitsAvailable: 1, now: HOLD, limit: 8 })

    for (const s of suggestions) {
      expect(findDateConflicts(s, [taken], { unitsAvailable: 1, now: HOLD })).toEqual([])
    }
  })

  it('stops at the number of suggestions asked for', () => {
    expect(suggestAlternativeDates(request, [taken], { unitsAvailable: 1, now: HOLD, limit: 2 })).toHaveLength(2)
  })

  it('ignores a hold that has already run out, so the Guest is not pushed off free dates', () => {
    const deadHold = stored('dead', '2026-10-01', '2026-10-05', {
      status: 'Pending',
      hold_expires_at: '2026-09-01T00:00:00.000Z',
    })

    expect(suggestAlternativeDates(request, [deadHold], { unitsAvailable: 1, now: HOLD })).toEqual([])
  })
})
