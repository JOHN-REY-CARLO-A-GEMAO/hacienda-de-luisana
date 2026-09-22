// Ticket #14: every money step is written to the Activity log, and the Host
// reads it back in words. Pure seam (describeActivity over stored entries) —
// no Firebase, no fallback needed.
import { applyAction, describeActivity, type ActivityLogEntry } from '../../src/lib/booking'

function entry(over: Partial<ActivityLogEntry> = {}): ActivityLogEntry {
  return {
    booking_id: 'b1',
    action: 'VerifyPayment',
    from_status: 'Payment Pending',
    to_status: 'Reserved',
    actor: 'host',
    actor_id: 'host-1',
    actor_name: 'Host',
    at: '2026-10-05T10:00:00.000Z',
    ...over,
  }
}

describe('payment history the Host reads', () => {
  it('names the verified payment that made the Reservation', () => {
    const line = describeActivity(entry())
    expect(line.headline).toBe('Payment proof verified — Booking Reserved')
    expect(line.change).toBe('Payment Pending → Reserved')
    expect(line.actor).toBe('Host (Host)')
  })

  it('reads a rejected proof with the reason the Guest was given', () => {
    const line = describeActivity(
      entry({
        action: 'RejectPaymentProof',
        from_status: 'Payment Pending',
        to_status: 'Payment Pending',
        reason: 'The screenshot is cut off.',
      }),
    )
    expect(line.headline).toBe('Payment proof rejected')
    expect(line.reason).toBe('The screenshot is cut off.')
  })

  it('reads the plan choice and the proof upload that led there', () => {
    expect(describeActivity(entry({ action: 'ChoosePaymentPlan' })).headline).toBe('Payment plan chosen')
    expect(describeActivity(entry({ action: 'UploadPaymentProof' })).headline).toBe('Payment proof uploaded')
  })

  it('logs the whole money path in order, through the lifecycle', () => {
    const booking = {
      id: 'b1',
      accommodation: 'main-house',
      check_in: '2026-10-10',
      check_out: '2026-10-12',
      status: 'Approved',
    }
    const host = { actor: 'host' as const, actor_id: 'host-1' }
    const guest = { actor: 'guest' as const, actor_id: 'g-1' }

    const chosen = applyAction(booking, { type: 'ChoosePaymentPlan', plan: 'full', stayTotal: 17000, rate: { securityDeposit: 2000 } }, guest)
    expect(chosen.ok).toBe(true)
    if (!chosen.ok) return

    const proof = applyAction(
      { ...booking, ...chosen.patch },
      { type: 'UploadPaymentProof', payment_proof_url: 'https://x/proof.jpg', amount_claimed: 19000 },
      guest,
    )
    expect(proof.ok).toBe(true)
    if (!proof.ok) return

    const verified = applyAction(
      { ...booking, ...chosen.patch, ...proof.patch },
      { type: 'VerifyPayment', amount_verified: 19000 },
      host,
    )
    expect(verified.ok).toBe(true)
    if (!verified.ok) return

    const lines = verified.entries.map(describeActivity)
    expect(lines[0]?.headline).toBe('Payment proof verified — Booking Reserved')
    expect(verified.patch.status).toBe('Reserved')
  })
})
