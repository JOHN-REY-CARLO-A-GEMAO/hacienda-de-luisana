import { useState } from 'react'
import { cloudBookingsDB } from '../../lib/firestoreBookings'
import { effectiveStatus, type Actor } from '../../lib/booking'
import type { Booking } from '../../lib/storage'
import { ROLE_LABELS, can, isRole } from '../../lib/auth'

/**
 * The Host's review of a payment proof: verify it into a Reservation, or
 * refuse it with a reason the Guest can act on.
 *
 * Every button here goes through the lifecycle (`cloudBookingsDB.transition`),
 * never a bare status write. Verifying records Payment Verified and lands the
 * Booking on Reserved in the same action, because Payment Verified is a fact
 * the Host recorded rather than a place a Booking rests (ticket #14). Refusing
 * either loops the Guest back to upload again, or cancels cleanly with nothing
 * owed when there is nothing to resubmit for.
 */
export function PaymentReview({
  booking,
  actor,
  onDone,
}: {
  booking: Booking
  actor?: Actor
  /** Called after a decision lands, so the caller can refresh or close. */
  onDone?: (message: string) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)
  const [amountVerified, setAmountVerified] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [guestResubmits, setGuestResubmits] = useState(true)

  const status = effectiveStatus(booking)
  const host = actor ?? { actor: 'host', actor_id: 'host', actor_name: 'Host' }

  // Like BookingReview's KYC gate: a session handed this component gets the
  // read-only version without the caller having to remember. Verifying money
  // is the Host's alone (CONTEXT.md § People).
  const role = isRole(host.actor) ? host.actor : null
  const mayVerify = can(role, 'payments:verify')

  if (status !== 'Payment Pending') return null

  const owed = (booking.amount_due ?? 0) + (booking.security_deposit ?? 0)

  const verify = async () => {
    const verified = amountVerified.trim() === '' ? owed : Number(amountVerified)
    if (!(verified > 0)) {
      setNotice({ tone: 'bad', text: 'The verified amount has to be more than zero.' })
      return
    }
    setBusy('verify')
    setNotice(null)
    try {
      const result = await cloudBookingsDB.transition(
        booking.id,
        { type: 'VerifyPayment', amount_verified: verified },
        host,
      )
      if (result.ok) {
        setNotice({ tone: 'good', text: `Verified — the Booking is now ${result.patch.status ?? 'Reserved'}.` })
        onDone?.('Verified')
        return
      }
      setNotice({ tone: 'bad', text: result.reason })
    } catch (e) {
      console.warn('[PaymentReview] verify failed', e)
      setNotice({
        tone: 'bad',
        text: 'That did not save — the booking is unchanged. Check the connection and try again.',
      })
    } finally {
      setBusy(null)
    }
  }

  const reject = async () => {
    const trimmed = reason.trim()
    if (!trimmed) {
      setNotice({
        tone: 'bad',
        text: 'Say why the proof was rejected — a Guest who is not told why cannot send the right one.',
      })
      return
    }
    setBusy('reject')
    setNotice(null)
    try {
      const result = await cloudBookingsDB.transition(
        booking.id,
        { type: 'RejectPaymentProof', reason: trimmed, guestResubmits },
        host,
      )
      if (result.ok) {
        setRejecting(false)
        setReason('')
        setNotice({
          tone: 'good',
          text: guestResubmits
            ? 'Rejected — the Guest was told why and can upload another proof.'
            : 'Rejected — the Booking is cancelled cleanly, with no refund owed.',
        })
        onDone?.('Rejected')
        return
      }
      setNotice({ tone: 'bad', text: result.reason })
    } catch (e) {
      console.warn('[PaymentReview] reject failed', e)
      setNotice({
        tone: 'bad',
        text: 'That did not save — the booking is unchanged. Check the connection and try again.',
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="rounded-2xl border border-forest-900/10 bg-cream-50/60 p-4">
      <div className="text-[10px] uppercase tracking-eyebrow text-forest-600 font-semibold">
        {mayVerify ? 'Payment review' : `${role ? ROLE_LABELS[role] : 'Read-only'} view`} · {status}
      </div>

      {!mayVerify && (
        <p className="mt-2 text-xs text-forest-700/80 leading-relaxed">
          Only the Host verifies a payment. What you can do here is read the request.
        </p>
      )}

      {/* The proof. Shown only where it can be verified. */}
      <div className="mt-3">
        {booking.payment_proof_url && mayVerify ? (
          <a href={booking.payment_proof_url} target="_blank" rel="noreferrer" className="block w-32">
            <img
              src={booking.payment_proof_url}
              alt="Payment proof"
              loading="lazy"
              className="h-20 w-32 rounded-xl object-cover border border-forest-900/10 bg-white"
            />
            <span className="mt-1 block text-[10px] uppercase tracking-eyebrow text-forest-600">
              Receipt ↗
            </span>
          </a>
        ) : booking.payment_proof_url ? (
          <p className="text-xs text-forest-700/80 leading-relaxed">
            A payment proof is on file. It is the Host who verifies it.
          </p>
        ) : (
          <p className="text-xs text-forest-700/80 leading-relaxed">
            No payment proof uploaded yet. The Guest sends it from their own account page once they
            have paid externally.
          </p>
        )}
      </div>

      {/* Claimed vs owed, so an underpayment is refused rather than quietly accepted. */}
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl bg-white border border-forest-900/10 px-3 py-2">
          <dt className="text-[10px] uppercase tracking-eyebrow text-forest-600">Guest claims</dt>
          <dd className="font-semibold text-forest-900">
            {booking.amount_claimed !== undefined ? peso(booking.amount_claimed) : '—'}
          </dd>
        </div>
        <div className="rounded-xl bg-white border border-forest-900/10 px-3 py-2">
          <dt className="text-[10px] uppercase tracking-eyebrow text-forest-600">Owed now</dt>
          <dd className="font-semibold text-forest-900">
            {peso(owed)}
            {booking.amount_due !== undefined && booking.security_deposit !== undefined && (
              <span className="block font-normal text-forest-700/70">
                {peso(booking.amount_due)} + {peso(booking.security_deposit)} deposit
              </span>
            )}
          </dd>
        </div>
      </dl>

      {booking.payment_status === 'rejected' && booking.payment_reject_reason && (
        <p className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          Last verdict — the Guest was told: “{booking.payment_reject_reason}”.
        </p>
      )}

      {mayVerify && (
        <div className="mt-4 space-y-3">
          <label className="block max-w-xs">
            <span className="block text-xs font-medium text-forest-900">Amount verified (₱)</span>
            <input
              value={amountVerified}
              onChange={(e) => setAmountVerified(e.target.value)}
              inputMode="decimal"
              placeholder={owed > 0 ? String(owed) : 'e.g. 10500'}
              className="mt-1 block w-full text-xs rounded-xl border border-forest-900/15 bg-white px-3 py-2 text-forest-900 focus:outline-none focus:ring-2 focus:ring-forest-700/30"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void verify()}
              disabled={busy !== null}
              className="px-3 py-2 rounded-xl text-xs font-medium bg-emerald-700 hover:bg-emerald-800 text-white transition disabled:opacity-50"
            >
              {busy === 'verify' ? 'Verifying…' : 'Verify → Reserved'}
            </button>
            <button
              onClick={() => setRejecting(!rejecting)}
              disabled={busy !== null}
              className="px-3 py-2 rounded-xl text-xs bg-white border border-red-200 text-red-700 hover:bg-red-50 transition disabled:opacity-50"
            >
              Reject proof
            </button>
          </div>

          {rejecting && (
            <div>
              <label className="block text-[10px] uppercase tracking-eyebrow text-forest-600 font-semibold mb-1">
                Why was this proof rejected? The Guest reads this.
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="e.g. The screenshot is cut off — please resend showing the full receipt and amount."
                className="w-full text-xs rounded-xl border border-forest-900/15 bg-white px-3 py-2 text-forest-900 focus:outline-none focus:ring-2 focus:ring-forest-700/30"
              />
              <label className="mt-2 flex items-center gap-2 text-xs text-forest-800">
                <input
                  type="checkbox"
                  checked={guestResubmits}
                  onChange={(e) => setGuestResubmits(e.target.checked)}
                />
                The Guest may send another proof (unticked: the Booking is cancelled, nothing owed)
              </label>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => void reject()}
                  disabled={busy !== null}
                  className="px-3 py-2 rounded-xl text-xs font-medium bg-forest-800 text-cream-50 hover:bg-forest-900 transition disabled:opacity-50"
                >
                  {busy === 'reject' ? 'Saving…' : 'Reject this proof'}
                </button>
                <button
                  onClick={() => {
                    setRejecting(false)
                    setReason('')
                  }}
                  className="px-3 py-2 rounded-xl text-xs text-forest-700 hover:bg-cream-100 transition"
                >
                  Never mind
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {notice && (
        <p
          className={`mt-3 text-xs rounded-xl px-3 py-2 leading-relaxed border ${
            notice.tone === 'good'
              ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
              : 'bg-red-50 text-red-800 border-red-200'
          }`}
        >
          {notice.text}
        </p>
      )}
    </div>
  )
}

function peso(n: number): string {
  return `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
