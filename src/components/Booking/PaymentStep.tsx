import { useEffect, useRef, useState } from 'react'
import { BUSINESS } from '../../config/site'
import { cloudBookingsDB } from '../../lib/firestoreBookings'
import { isFirebaseConfigured } from '../../lib/firebase'
import { ratesDB } from '../../lib/ratesDB'
import {
  paymentOptions,
  paymentOptionsForTotal,
  ratesForAccommodation,
  type PaymentPlan,
  type PublishedRates,
} from '../../lib/booking'
import { PROOF_UPLOAD_UNAVAILABLE_MESSAGE, uploadPaymentProof } from '../../lib/payments'
import type { Booking } from '../../lib/storage'

/**
 * The Guest's own payment step: choose a payment plan on an approved Booking,
 * pay outside the system, and upload the proof for the Host to verify.
 *
 * Money moves last (ADR-0001): this renders only once the Host has approved,
 * and every button goes through the lifecycle (`cloudBookingsDB.transition`),
 * never a bare status write. Amounts are quoted from the Host's published
 * rates (`site_config/rates`); when nothing is published for this
 * Accommodation there is no price to commit to, and the choice is not offered.
 *
 * Where there is no Firebase there is no upload: a receipt is never parked in
 * a browser the Host cannot read.
 */
export function PaymentStep({ booking }: { booking: Booking }) {
  const [rates, setRates] = useState<PublishedRates | null>(null)
  const [plan, setPlan] = useState<PaymentPlan>('full')
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [amountClaimed, setAmountClaimed] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)
  const [sent, setSent] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => ratesDB.subscribe(setRates), [])

  const status = cloudBookingsDB.readStatus(booking)
  if (status !== 'Approved' && status !== 'Payment Pending') {
    if (booking.payment_status === 'verified' && (status === 'Reserved' || status === 'Payment Verified')) {
      return (
        <div className="rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-xs text-emerald-900 leading-relaxed">
          <strong className="block">Your payment was verified — your Reservation is confirmed.</strong>
          Show this page at check-in. The refundable Security deposit is settled after inspection.
        </div>
      )
    }
    return null
  }

  const quoted = rates ? ratesForAccommodation(rates, booking.accommodation) : undefined
  const options = quoted
    ? paymentOptions(booking, quoted.rateCard)
    : booking.stay_total
      ? paymentOptionsForTotal(booking.stay_total, { securityDeposit: booking.security_deposit ?? 0 })
      : []

  const choosePlan = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const result = await cloudBookingsDB.transition(
        booking.id,
        quoted
          ? { type: 'ChoosePaymentPlan', plan, rateCard: quoted.rateCard, policy: quoted.snapshot }
          : {
              type: 'ChoosePaymentPlan',
              plan,
              stayTotal: booking.stay_total,
              rate: { securityDeposit: booking.security_deposit ?? 0 },
            },
        { actor: 'guest', actor_id: booking.uid ?? 'guest', actor_name: booking.guest_name },
      )
      setMessage(
        result.ok
          ? { tone: 'good', text: 'Plan chosen. Now send the payment externally and upload your proof below.' }
          : { tone: 'bad', text: result.reason },
      )
    } catch (e) {
      console.warn('[Payment] could not record the plan choice', e)
      setMessage({
        tone: 'bad',
        text: 'That did not save — please try again.',
      })
    } finally {
      setBusy(false)
    }
  }

  const sendProof = async () => {
    if (!proofFile) {
      setMessage({ tone: 'bad', text: 'Choose a photo or screenshot of your payment receipt first.' })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const refId = booking.ref_id || booking.id
      const uploaded = await uploadPaymentProof({ file: proofFile, bookingRefId: refId })
      if (!uploaded.ok) {
        setMessage({ tone: 'bad', text: uploaded.message })
        return
      }
      const claimed = amountClaimed.trim() === '' ? undefined : Number(amountClaimed)
      const result = await cloudBookingsDB.transition(
        booking.id,
        {
          type: 'UploadPaymentProof',
          payment_proof_url: uploaded.url,
          ...(claimed !== undefined && Number.isFinite(claimed) && claimed > 0 ? { amount_claimed: claimed } : {}),
        },
        {
          actor: 'guest',
          actor_id: booking.uid || uploaded.uid,
          actor_name: booking.guest_name,
        },
      )
      if (!result.ok) {
        setMessage({ tone: 'bad', text: result.reason })
        return
      }
      setProofFile(null)
      if (fileInput.current) fileInput.current.value = ''
      setAmountClaimed('')
      setSent(true)
      setMessage({
        tone: 'good',
        text: 'Proof sent. The Host will verify it and confirm your Reservation — watch this page for the verdict.',
      })
    } catch (e) {
      console.warn('[Payment] could not record the proof upload', e)
      setMessage({
        tone: 'bad',
        text: 'The photo went up but your booking could not be updated. Please try again.',
      })
    } finally {
      setBusy(false)
    }
  }

  const owed = (booking.amount_due ?? 0) + (booking.security_deposit ?? 0)
  const planChosen = booking.payment_plan !== undefined || status === 'Payment Pending'

  return (
    <div className="rounded-2xl border border-forest-900/10 bg-white p-4">
      <div className="text-[10px] uppercase tracking-eyebrow text-forest-600 font-semibold">
        Step 3 · Pay and send proof
      </div>

      {status === 'Approved' && !planChosen && (
        <>
          <p className="mt-2 text-xs text-forest-700/80 leading-relaxed">
            The Host approved your dates. Choose how to pay — then send the money externally and upload
            your proof below.
          </p>
          {options.length === 0 ? (
            <p className="mt-3 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 leading-relaxed">
              The Host has not published a payment option for this Accommodation yet. Please message the
              Host for the amount — your dates stay held while you do.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {options.map((option) => (
                <label
                  key={option.plan}
                  className={`block rounded-xl border px-3 py-2.5 text-xs cursor-pointer transition ${
                    plan === option.plan
                      ? 'border-forest-700 bg-cream-50'
                      : 'border-forest-900/10 hover:bg-cream-50/50'
                  }`}
                >
                  <span className="flex items-center gap-2 font-medium text-forest-900">
                    <input
                      type="radio"
                      name={`plan-${booking.id}`}
                      checked={plan === option.plan}
                      onChange={() => setPlan(option.plan)}
                    />
                    {option.plan === 'down-payment' ? 'Down payment' : 'Full payment'}
                  </span>
                  <span className="block mt-1 text-forest-700/80">
                    {peso(option.dueNow)} now + {peso(option.securityDeposit)} refundable Security deposit
                    {option.balance > 0 && <> · {peso(option.balance)} balance before the stay</>}
                  </span>
                </label>
              ))}
              <button
                onClick={() => void choosePlan()}
                disabled={busy}
                className="px-4 py-2.5 rounded-xl text-xs font-medium bg-forest-800 text-cream-50 hover:bg-forest-900 transition disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Choose this plan'}
              </button>
            </div>
          )}
        </>
      )}

      {(status === 'Payment Pending' || planChosen) && (
        <div className="mt-3">
          {owed > 0 && (
            <p className="text-xs text-forest-900 font-medium">
              Amount to send: {peso(owed)}
              {booking.amount_due !== undefined && booking.security_deposit !== undefined && (
                <span className="font-normal text-forest-700/70">
                  {' '}({peso(booking.amount_due)} stay + {peso(booking.security_deposit)} refundable deposit)
                </span>
              )}
            </p>
          )}

          <div className="mt-2 rounded-xl bg-cream-50 border border-forest-900/10 px-3 py-2.5 text-xs text-forest-800 leading-relaxed">
            <strong className="block text-forest-900">Where to send it</strong>
            <span className="block mt-1">
              <strong>GCash</strong> — message the Host at {BUSINESS.contact.phone} to confirm the current
              number before sending.
            </span>
            <span className="block mt-1">
              <strong>Bank transfer</strong> — ask the Host for the current account details at{' '}
              {BUSINESS.contact.email}.
            </span>
            <span className="block mt-1 text-forest-700/70">
              No card details are taken here — the payment happens in your own e-wallet or bank app.
            </span>
          </div>

          {booking.payment_status === 'rejected' && booking.payment_reject_reason && (
            <p className="mt-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 leading-relaxed">
              <strong className="block">Your proof was not accepted.</strong>
              {booking.payment_reject_reason}
            </p>
          )}

          {booking.payment_proof_url && !sent && booking.payment_status !== 'rejected' ? (
            <p className="mt-2 text-xs text-forest-800 leading-relaxed">
              Your proof is with the Host. You can send a clearer photo below if you like.
            </p>
          ) : null}

          {isFirebaseConfigured ? (
            <div className="mt-3 space-y-2">
              <label className="block">
                <span className="block text-xs font-medium text-forest-900">Payment receipt</span>
                <span className="block text-[11px] text-forest-700/70 mb-1">
                  Screenshot or photo · jpg, png, webp or heic, under 5MB
                </span>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-xs text-forest-800 file:mr-3 file:px-3 file:py-2 file:rounded-xl file:border-0 file:bg-cream-100 file:text-forest-800 file:text-xs file:font-medium hover:file:bg-cream-200 file:cursor-pointer"
                />
                {proofFile && <span className="block mt-1 text-[11px] text-forest-700">{proofFile.name} chosen.</span>}
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-forest-900">Amount you sent (₱, optional)</span>
                <input
                  value={amountClaimed}
                  onChange={(e) => setAmountClaimed(e.target.value)}
                  inputMode="decimal"
                  placeholder="e.g. 10500"
                  className="block w-full text-xs rounded-xl border border-forest-900/15 bg-white px-3 py-2 text-forest-900 focus:outline-none focus:ring-2 focus:ring-forest-700/30"
                />
              </label>
              <button
                onClick={() => void sendProof()}
                disabled={busy}
                className="px-4 py-2.5 rounded-xl text-xs font-medium bg-forest-800 text-cream-50 hover:bg-forest-900 transition disabled:opacity-50"
              >
                {busy ? 'Uploading…' : sent ? 'Send another proof' : 'Send my proof'}
              </button>
            </div>
          ) : (
            <p className="mt-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-xl px-3 py-2 leading-relaxed">
              {PROOF_UPLOAD_UNAVAILABLE_MESSAGE}
            </p>
          )}
        </div>
      )}

      {message && (
        <p
          className={`mt-3 text-xs rounded-xl px-3 py-2 leading-relaxed border ${
            message.tone === 'good'
              ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
              : 'bg-red-50 text-red-800 border-red-200'
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  )
}

function peso(n: number): string {
  return `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
