import { useRef, useState } from 'react'
import { usePaymentInformation } from '../../hooks/usePaymentInformation'
import { PaymentInformationPanel } from './PaymentInformationPanel'
import { cloudBookingsDB } from '../../lib/firestoreBookings'
import {
  paymentOptionsForTotal,
  recordedStayTotal,
  type PaymentPlan,
} from '../../lib/booking'
import { uploadPaymentProof } from '../../lib/payments'
import type { Booking } from '../../lib/storage'
import { extractReceiptFields, runReceiptOcr, suggestedAmount, amountMismatchNote, type ReceiptAmount } from '../../lib/payments/ocr'
import { nextProofAttempt } from '../../lib/payments'
import { LIMITS, checkRateLimit } from '../../lib/rateLimit'
import { validateAmount, validateReference } from '../../lib/validation'
import { LEGAL_VERSION } from '../../lib/legal'
import { Link } from 'react-router-dom'

/**
 * The Guest's own payment step: choose a payment plan on an approved Booking,
 * pay outside the system, and upload the proof for the Admin to verify.
 *
 * Money moves last (ADR-0001): this renders only once the Admin has approved,
 * and every button goes through the lifecycle (`cloudBookingsDB.transition`),
 * never a bare status write. This remains available for historical `Payment
 * Pending` records only. Their recorded total, or a total recoverable from
 * their saved rate amount/unit/nights, is the source for the plan; the current
 * rate document is never used to reprice an existing Booking. If no original
 * financial snapshot exists, no amount is offered.
 *
 * The screenshot goes to Supabase Storage's `payment-proofs` bucket
 * (ADR-0011) — in demo mode it stays in this browser, which is labelled for
 * what it is. OCR runs right here in the browser when the file is chosen and
 * only ever pre-fills the reference input; the Admin's verification is what
 * moves money (ocr.ts).
 */
export function PaymentStep({ booking }: { booking: Booking }) {
  const paymentInformation = usePaymentInformation()
  const [plan, setPlan] = useState<PaymentPlan>('full')
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [amountClaimed, setAmountClaimed] = useState('')
  /** Every distinct figure the receipt prints, when it prints more than one. */
  const [amountCandidates, setAmountCandidates] = useState<ReceiptAmount[]>([])
  const [reference, setReference] = useState('')
  const [ocrNotes, setOcrNotes] = useState<string[]>([])
  const [ocrBusy, setOcrBusy] = useState(false)
  const [extractedRef, setExtractedRef] = useState('')
  const [acceptPayTerms, setAcceptPayTerms] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)
  const [sent, setSent] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const status = cloudBookingsDB.readStatus(booking)
  if (status !== 'Payment Pending') {
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

  const historicalTotal = recordedStayTotal(booking)
  const options = historicalTotal !== undefined && historicalTotal > 0
    ? paymentOptionsForTotal(historicalTotal, {
        securityDeposit: booking.security_deposit ?? 0,
        downPaymentPercent: 50,
      })
    : []

  const choosePlan = async () => {
    if (historicalTotal === undefined || historicalTotal <= 0) {
      setMessage({ tone: 'bad', text: 'This historical Booking has no saved stay total. Please contact the Admin for the original quote.' })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const result = await cloudBookingsDB.transition(
        booking.id,
        {
          type: 'ChoosePaymentPlan',
          plan,
          stayTotal: historicalTotal,
          rate: { securityDeposit: booking.security_deposit ?? 0, downPaymentPercent: 50 },
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
    if (!acceptPayTerms) {
      setMessage({ tone: 'bad', text: `Accept the payment and smart-lock rules (version ${LEGAL_VERSION}) before submitting.` })
      return
    }
    const refCheck = validateReference(reference)
    if (!refCheck.ok) {
      setMessage({ tone: 'bad', text: refCheck.message })
      return
    }
    const amtCheck = validateAmount(amountClaimed)
    if (!amtCheck.ok) {
      setMessage({ tone: 'bad', text: amtCheck.message })
      return
    }
    const limited = checkRateLimit(`payment:${booking.id}`, LIMITS.payment)
    if (!limited.ok) {
      setMessage({ tone: 'bad', text: limited.message })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const refId = booking.ref_id || booking.id
      // A re-send is a new object, not a replacement: the path has to differ
      // from the one already recorded, both because Supabase refuses an upsert
      // and because firestore.rules only lets a Guest clear a rejection reason
      // by attaching a different proof.
      const uploaded = await uploadPaymentProof({
        file: proofFile,
        bookingRefId: refId,
        attempt: nextProofAttempt(booking.payment_proof_url),
      })
      if (!uploaded.ok) {
        setMessage({ tone: 'bad', text: uploaded.message })
        return
      }
      const claimed = Number(amtCheck.value)
      const result = await cloudBookingsDB.transition(
        booking.id,
        {
          type: 'UploadPaymentProof',
          payment_proof_url: uploaded.url,
          paymentProofUrl: uploaded.url,
          extractedRefNumber: extractedRef || undefined,
          amount_claimed: claimed,
          payment_reference: refCheck.value,
          ocr_reference: reference,
          ocr_amount: amtCheck.value,
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
      setReference('')
      setExtractedRef('')
      setAmountCandidates([])
      setOcrNotes([])
      setSent(true)
      setMessage({
        tone: 'good',
        text: 'Proof sent. The Admin will verify it and confirm your Reservation — watch this page for the verdict.',
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
  // The Admin's approval lands on `Payment Pending`, so the plan is chosen
  // *inside* that stage — only the stored plan says the choice has been made.
  const planChosen = booking.payment_plan !== undefined

  return (
    <div className="rounded-2xl border border-forest-900/10 bg-white p-4">
      <div className="text-[10px] uppercase tracking-eyebrow text-forest-600 font-semibold">
        Step 3 · Pay and send proof
      </div>

      {status === 'Payment Pending' && !planChosen && (
        <>
          <p className="mt-2 text-xs text-forest-700/80 leading-relaxed">
            The Admin approved your dates. Choose how to pay — then send the money externally and upload
            your proof below.
          </p>
          {options.length === 0 ? (
            <p className="mt-3 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 leading-relaxed">
              This historical Booking has no usable saved stay total or rate snapshot. Please contact the
              Admin for the original quote — the current rate card will not reprice it.
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
                    {option.balance > 0 && <> · {peso(option.balance)} remaining 50% due at check-in</>}
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

      {status === 'Payment Pending' && planChosen && (
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

          <div className="mt-2">
            <PaymentInformationPanel
              payment={paymentInformation}
              requiredAmount={owed > 0 ? owed : undefined}
            />
          </div>

          {booking.payment_status === 'rejected' && booking.payment_reject_reason && (
            <p className="mt-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 leading-relaxed">
              <strong className="block">Your proof was not accepted.</strong>
              {booking.payment_reject_reason}
            </p>
          )}

          {booking.payment_proof_url && !sent && booking.payment_status !== 'rejected' ? (
            <p className="mt-2 text-xs text-forest-800 leading-relaxed">
              Your proof is with the Admin. You can send a clearer photo below if you like.
            </p>
          ) : null}

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
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null
                    setProofFile(file)
                    setExtractedRef('')
                    setAmountCandidates([])
                    setOcrNotes([])
                    if (!file) return
                    const ocrLimit = checkRateLimit(`ocr:${booking.id}`, LIMITS.ocr)
                    if (!ocrLimit.ok) {
                      setOcrNotes([ocrLimit.message])
                      return
                    }
                    void (async () => {
                      setOcrBusy(true)
                      try {
                        const extracted = await runReceiptOcr(file)
                        const fromName = extractReceiptFields(file.name.replace(/[_-]/g, ' '))
                        const referenceGuess = extracted.reference || fromName.reference
                        const amountGuess = extracted.amount || fromName.amount
                        if (referenceGuess) {
                          setReference(referenceGuess)
                          setExtractedRef(referenceGuess)
                        }
                        // Every distinct figure the receipt prints, so a receipt
                        // whose `Amount` and `Total Amount Sent` disagree asks the
                        // Guest which one they sent instead of silently picking
                        // the first number OCR happened to find.
                        const candidates = [...extracted.amounts, ...fromName.amounts]
                          .filter(
                            (c, i, all) =>
                              all.findIndex((o) => o.value === c.value) === i,
                          )
                        setAmountCandidates(candidates)
                        // Default to the figure nearest what is owed; when nothing
                        // is close, or two are equally close, leave the field for
                        // the Guest to type.
                        const suggestion = suggestedAmount(candidates, owed)
                        const defaultAmount =
                          suggestion?.value ?? (candidates.length === 1 ? candidates[0].value : '')
                        if (defaultAmount) setAmountClaimed(defaultAmount)
                        setOcrNotes([
                          ...extracted.notes,
                          'Confirm or correct the fields below. OCR is not verification.',
                        ])
                      } catch {
                        setOcrNotes([
                          'OCR could not run on this image. Type the reference and amount from your receipt.',
                        ])
                      } finally {
                        setOcrBusy(false)
                      }
                    })()
                  }}
                  className="block w-full text-xs text-forest-800 file:mr-3 file:px-3 file:py-2 file:rounded-xl file:border-0 file:bg-cream-100 file:text-forest-800 file:text-xs file:font-medium hover:file:bg-cream-200 file:cursor-pointer"
                />
                {proofFile && <span className="block mt-1 text-[11px] text-forest-700">{proofFile.name} chosen.</span>}
                {ocrBusy && (
                  <span
                    className="block mt-1 text-[11px] text-forest-700"
                    role="status"
                    aria-live="polite"
                  >
                    <span className="inline-block animate-pulse">●</span> Reading your receipt —
                    OCR runs in your browser and can take a moment…
                  </span>
                )}
                {!ocrBusy && ocrNotes.length > 0 && (
                  <span className="block mt-1 text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-2 py-1.5 leading-relaxed">
                    {ocrNotes.join(' ')}
                  </span>
                )}
              </label>
              {/* Two or more figures on one receipt is a question, not a detail. A GCash
                  Express Send prints `Amount` (what the recipient receives) and
                  `Total Amount Sent` (what left the sender), and they disagree
                  whenever a fee was charged — so the Guest says which they sent. */}
              {amountCandidates.length > 1 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2.5">
                  <span className="block text-[11px] font-medium text-amber-900">
                    This receipt shows {amountCandidates.length} different amounts. Which one did you send?
                  </span>
                  <div className="mt-1.5 space-y-1">
                    {amountCandidates.map((candidate) => (
                      <label key={candidate.value} className="flex items-center gap-2 text-[11px] text-amber-900 cursor-pointer">
                        <input
                          type="radio"
                          name={`amount-${booking.id}`}
                          checked={amountClaimed === candidate.value}
                          onChange={() => setAmountClaimed(candidate.value)}
                        />
                        <span className="font-medium">
                          ₱{Number(candidate.value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                        <span className="text-amber-700">({candidate.label})</span>
                        {owed > 0 && Math.abs(Number(candidate.value) - owed) < 0.005 && (
                          <span className="text-emerald-700">— matches what you owe</span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <label className="block">
                <span className="block text-xs font-medium text-forest-900">Reference number</span>
                <span className="block text-[11px] text-forest-700/70 mb-1">
                  10–13 digits from your GCash, Maya or bank receipt · OCR fills this in — correct it
                  if it misread
                </span>
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="e.g. 1234567890123"
                  className="block w-full text-xs rounded-xl border border-forest-900/15 bg-white px-3 py-2 text-forest-900 focus:outline-none focus:ring-2 focus:ring-forest-700/30"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-forest-900">Amount you sent (₱)</span>
                {amountCandidates.length <= 1 && (
                  <span className="block text-[11px] text-forest-700/70 mb-1">
                    OCR fills this in — correct it if it misread
                  </span>
                )}
                <input
                  value={amountClaimed}
                  onChange={(e) => setAmountClaimed(e.target.value)}
                  inputMode="decimal"
                  placeholder="e.g. 10500"
                  className="block w-full text-xs rounded-xl border border-forest-900/15 bg-white px-3 py-2 text-forest-900 focus:outline-none focus:ring-2 focus:ring-forest-700/30"
                />
              </label>
              {amountMismatchNote(Number(amountClaimed) || 0, owed) && (
                <p className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-2 py-1.5 leading-relaxed">
                  {amountMismatchNote(Number(amountClaimed) || 0, owed)}
                </p>
              )}
              <label className="flex items-start gap-2 text-[11px] text-forest-700 leading-relaxed cursor-pointer">
                <input
                  type="checkbox"
                  checked={acceptPayTerms}
                  onChange={(e) => setAcceptPayTerms(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  I accept the payment and smart-lock rules (version {LEGAL_VERSION})
                  <Link to="/legal" className="underline text-forest-800 hover:text-forest-900"> — read them</Link>.
                </span>
              </label>
              <button
                onClick={() => void sendProof()}
                disabled={busy}
                className="px-4 py-2.5 rounded-xl text-xs font-medium bg-forest-800 text-cream-50 hover:bg-forest-900 transition disabled:opacity-50"
              >
                {busy ? 'Uploading…' : sent ? 'Send another proof' : 'Send my proof'}
              </button>
          </div>
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
