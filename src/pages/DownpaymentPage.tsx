import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ACCOMMODATIONS, BUSINESS } from '../config/site'
import { FlowSteps } from '../components/Booking/FlowSteps'
import { OfficialChannelsNotice } from '../components/OfficialChannelsNotice'
import { SmartImage } from '../components/SmartImage'
import { clearBookingDraft, loadBookingDraft, rememberBookingId, type BookingDraft } from '../lib/bookingDraft'
import { cloudBookingsDB } from '../lib/firestoreBookings'
import { ensureGuestUid } from '../lib/guestAuth'
import { ArrowRight, Calendar, Sparkle, Users } from '../lib/icons'
import {
  paymentOptionsForTotal,
  quoteAccommodation,
  validateBookingPayload,
  validateBookingSelection,
} from '../lib/booking'
import { uploadPaymentProof } from '../lib/payments'
import { usePaymentInformation } from '../hooks/usePaymentInformation'
import { PaymentInformationPanel } from '../components/Booking/PaymentInformationPanel'
import { amountMismatchNote, claimAgainstReceipt, runReceiptOcr, suggestedAmount, type ReceiptAmount } from '../lib/payments/ocr'
import { LIMITS, checkRateLimit } from '../lib/rateLimit'
import { usePublishedRates } from '../hooks/usePublishedRates'
import { displayedRate } from '../sections/Accommodations'
import { validateAmount } from '../lib/validation'
import { guestFacingErrorMessage } from '../lib/firebaseFailure'
import { createNotification } from '../lib/notifications'

function peso(n: number): string {
  return `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const a = new Date(checkIn).getTime()
  const b = new Date(checkOut).getTime()
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.max(0, Math.round((b - a) / (1000 * 60 * 60 * 24)))
}

export function DownpaymentPage() {
  const navigate = useNavigate()
  const draft = useMemo(() => loadBookingDraft(), [])
  const published = usePublishedRates()
  const paymentInformation = usePaymentInformation()
  const fileInput = useRef<HTMLInputElement>(null)

  const [proofFile, setProofFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  /** Every distinct peso figure the screenshot prints, when it prints more than one. */
  const [amountCandidates, setAmountCandidates] = useState<ReceiptAmount[]>([])
  const [reference, setReference] = useState('')
  const [ocrNote, setOcrNote] = useState('')
  /**
   * The Guest has said, on purpose, that their receipt shows an amount OCR did
   * not read. Only they can know that — the Admin reads it off the screenshot —
   * so it is a claim of theirs to make, and it is cleared the moment the
   * screenshot is replaced or taken away.
   */
  const [claimOffReceipt, setClaimOffReceipt] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const accommodation = ACCOMMODATIONS.find((item) => item.id === draft?.accommodation)
  const nights = draft ? nightsBetween(draft.check_in, draft.check_out) : 0
  const rate = accommodation ? displayedRate(accommodation, published) : null
  const quoted = published && draft ? quoteAccommodation(published, draft.accommodation, draft) : undefined
  const stayTotal = quoted?.stayTotal ?? null
  const paymentOptions = quoted ? paymentOptionsForTotal(quoted.stayTotal, quoted.rateCard) : []
  const reservationOption = paymentOptions.find((option) => option.plan === 'down-payment')
  const selectedOption = reservationOption ?? paymentOptions.find((option) => option.plan === 'full')
  const dueNow = selectedOption?.dueNow ?? null
  const paymentPlan = selectedOption?.plan ?? 'full' as const
  const deposit = quoted?.rateCard.securityDeposit
  /**
   * The claim, held against the evidence for it: the sentence that says the two
   * disagree, or `null` when they agree, when the screenshot printed no figure to
   * check against, and once the Guest has said on the record that their receipt
   * reads differently from what was read off it — OCR is a hint engine, and only
   * the Admin reads the screenshot for real.
   */
  const receiptCheck = claimAgainstReceipt(amount, amountCandidates, dueNow ?? undefined)
  const offReceipt = claimOffReceipt ? null : receiptCheck.ok ? null : receiptCheck.message
  /**
   * Whether this page will accept the claim at all. `submit` refuses one below
   * the due-now figure, so every sentence on this page that promises an Admin
   * review has to know whether that promise has a path behind it.
   */
  const belowDueNow = dueNow !== null && Number(amount) > 0 && dueNow - Number(amount) >= 0.005

  useEffect(() => {
    if (!draft) navigate('/book', { replace: true })
  }, [draft, navigate])

  // The published downpayment is the default claim, not the permanent one. Once
  // a screenshot is attached the field belongs to the receipt: re-filling it
  // whenever the Guest clears it put a figure the receipt never printed —
  // `dueNow` — straight back into the claim they were correcting.
  useEffect(() => {
    if (!proofFile && dueNow !== null && amount === '') setAmount(String(dueNow))
  }, [dueNow, amount, proofFile])

  useEffect(() => {
    if (!proofFile) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(proofFile)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [proofFile])

  if (!draft) return null

  const onFile = async (file: File | null) => {
    setProofFile(file)
    setError('')
    setOcrNote('')
    setAmountCandidates([])
    setClaimOffReceipt(false)
    if (!file) return
    try {
      const fields = await runReceiptOcr(file)
      if (fields.reference && !reference) setReference(fields.reference)
      // Every distinct figure the screenshot prints, kept so a receipt whose
      // `Amount` and `Total Amount Sent` disagree asks the Guest which one they
      // sent. Without this the field sits on the published `dueNow` whatever the
      // screenshot says, and a Guest who paid short files a full claim — the
      // underpayment check below compares the field against `dueNow`, so a
      // pre-filled field agrees with itself and nothing catches it.
      const candidates = fields.amounts
      setAmountCandidates(candidates)
      if (candidates.length === 1) {
        // One unambiguous figure: trust it over a pre-filled amount.
        setAmount(candidates[0].value)
      } else if (candidates.length > 1 && dueNow !== null) {
        const suggestion = suggestedAmount(candidates, dueNow)
        if (suggestion) setAmount(suggestion.value)
      }
      const notes: string[] = []
      if (fields.reference) notes.push('A reference was read off the screenshot. Please check it before you submit.')
      if (candidates.length > 1) {
        notes.push(
          `This screenshot shows ${candidates.length} different amounts (${candidates
            .map((c) => `${c.label} ${c.value}`)
            .join(', ')}). Choose the one you actually sent.`,
        )
      }
      setOcrNote(notes.join(' '))
    } catch {
      // OCR is a convenience. The screenshot itself is what the Admin reviews.
    }
  }

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      // Re-check the current policy and Manila date: a draft may have been
      // edited, or left open overnight. No proof or booking is stored first.
      const dates = await cloudBookingsDB.validateGuestCheckIn(draft.check_in)
      if (!dates.ok) {
        setError(dates.reason)
        return
      }

      // Re-run the complete selection rules before the screenshot leaves the
      // device. `/book/pay` can be opened from a stale or hand-edited session
      // draft, so checking only the lead-time date is not enough: property
      // status, one-night support, guest count and the current published quote
      // all have to agree first.
      const rules = validateBookingSelection(
        {
          accommodation: draft.accommodation,
          check_in: draft.check_in,
          check_out: draft.check_out,
          guests: Number(draft.guests),
        },
        { published, checkLeadTime: false },
      )
      if (!rules.ok) {
        setError(rules.failure.message)
        return
      }
      if (!quoted || stayTotal === null || dueNow === null || !published) {
        setError('This property does not have an active published rate. Please choose another property or contact the Hacienda.')
        return
      }
      if (!proofFile) {
        setError('Upload a screenshot of your payment. The booking cannot be submitted without it.')
        return
      }
      const amountCheck = validateAmount(amount)
      if (!amountCheck.ok) {
        setError(amountCheck.message)
        return
      }
      const claimed = Number(amountCheck.value)
      // The claim is checked against its own screenshot before it is checked
      // against the published rate: a figure the receipt never printed is a
      // wrong claim whatever the rate says, and `amount_claimed` is the number
      // the Admin approves against. Nothing is uploaded or written first.
      if (offReceipt) {
        setError(offReceipt)
        return
      }
      if (dueNow !== null && claimed < dueNow) {
        setError(`The downpayment due now is ${peso(dueNow)}. The screenshot has to cover at least that amount.`)
        return
      }
      const limited = checkRateLimit('booking:create', LIMITS.booking)
      if (!limited.ok) {
        setError(limited.message)
        return
      }
      const availability = await cloudBookingsDB.checkAvailability({
        accommodation: draft.accommodation,
        check_in: draft.check_in,
        check_out: draft.check_out,
      })
      if (!availability.available) {
        setError('Those dates were just held by another booking. Go back and choose different dates.')
        return
      }
      const uid = (await ensureGuestUid()) ?? undefined
      // firestore.rules refuses a Booking that arrives without a `uid`
      // (firestore.rules, bookings create), so a missing identity is a certain
      // refusal, not a risk of one — and going on to upload the screenshot and
      // attempt the write would spend the Guest's 5 MB and tell them the rules
      // said no for a reason they could never see. Demo mode writes to
      // localStorage and is untouched.
      if (cloudBookingsDB.isCloud && !uid) {
        setError(
          'We could not attach this booking to you, so it was not sent. Nothing was saved and your ' +
            'screenshot is still here — please try again in a moment.',
        )
        return
      }
      // Availability/auth can take time. Check again immediately before the
      // screenshot leaves the device (e.g. if Manila midnight passed).
      const uploadDates = await cloudBookingsDB.validateGuestCheckIn(draft.check_in)
      if (!uploadDates.ok) {
        setError(uploadDates.reason)
        return
      }
      const uploadRules = validateBookingSelection(
        {
          accommodation: draft.accommodation,
          check_in: draft.check_in,
          check_out: draft.check_out,
          guests: Number(draft.guests),
        },
        { published, checkLeadTime: false },
      )
      if (!uploadRules.ok) {
        setError(uploadRules.failure.message)
        return
      }

      const balance = Math.max(0, Math.round((stayTotal - dueNow) * 100) / 100)
      // Validate the complete create payload while the proof is still on the
      // device. The storage URL is not known until after upload, so a non-empty
      // provisional marker is enough for this pure shape check; the real URL is
      // inserted immediately below. This catches stale money/policy snapshots
      // before an otherwise doomed proof upload.
      if (cloudBookingsDB.isCloud) {
        const payloadRules = validateBookingPayload(
          {
            ...draft,
            uid: uid ?? undefined,
            payment_proof_url: 'pending-proof',
            amount_claimed: claimed,
            payment_status: 'pending',
            nights,
            stay_total: stayTotal,
            amount_due: dueNow,
            security_deposit: deposit,
            balance_due: balance,
            rate_amount: quoted.rateCard.nightlyRate,
            rate_unit: 'standard_stay',
            rate_classification: quoted.classification,
            payment_plan: paymentPlan,
            policy_version: quoted.snapshot.version,
            policy_effective_date: quoted.snapshot.effectiveDate,
refund_policy_snapshot: published.refund ?? null,
          },
          { published, checkLeadTime: false },
        )
        if (!payloadRules.ok) {
          setError(payloadRules.failure.message)
          return
        }
      }

      const provisionalRef = `HDL-${Math.floor(1000 + Math.random() * 9000)}`
      const uploaded = await uploadPaymentProof({ file: proofFile, bookingRefId: provisionalRef })
      if (!uploaded.ok) {
        setError(uploaded.message)
        return
      }
      // Financial fields are a historical snapshot of the authoritative rate,
      // not of what OCR/the Guest says the receipt contains. Firestore rules
      // independently derive and verify this same snapshot.
       const effectiveUid = uid || uploaded.uid
       const booking = await cloudBookingsDB.add(
         {
           guest_name: draft.name.trim(),
           phone: draft.phone.trim(),
           email: draft.email.trim(),
           check_in: draft.check_in,
           check_out: draft.check_out,
           guests: Number(draft.guests),
           accommodation: draft.accommodation,
           special_requests: draft.special_requests.trim(),
           ...(effectiveUid ? { uid: effectiveUid } : {}),
           payment_proof_url: uploaded.url,
           paymentProofUrl: uploaded.url,
           payment_plan: paymentPlan,
           payment_status: 'pending',
           amount_claimed: claimed,
           ...(reference.trim() ? { payment_reference: reference.trim() } : {}),
           nights,
           stay_total: stayTotal,
           amount_due: dueNow,
           security_deposit: deposit,
           balance_due: balance,
           rate_amount: quoted.rateCard.nightlyRate,
           rate_unit: 'standard_stay',
           rate_classification: quoted.classification,
           policy_version: quoted.snapshot.version,
           policy_effective_date: quoted.snapshot.effectiveDate,
           refund_policy_snapshot: published.refund ?? null,
           source: 'web',
         },
         { actor: 'guest', actor_id: effectiveUid, actor_name: draft.name.trim() },
       )
       if (effectiveUid) {
         void createNotification({
           userId: effectiveUid,
           bookingId: booking.id,
           title: 'Booking Submitted',
           message: `Your booking request for ${draft.accommodation} on ${draft.check_in} has been submitted for Admin review.`,
           type: 'booking_submitted',
         })
       }
      clearBookingDraft()
      rememberBookingId(booking.id)
      navigate(`/booking/status?id=${encodeURIComponent(booking.id)}`, {
        replace: true,
        state: { justSubmitted: true, storage: booking.storage },
      })
    } catch (err) {
      console.error('[BookingSubmit] Submission error:', err)
      const message = guestFacingErrorMessage(err, 'The booking could not be submitted right now. Please try again.')
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative pt-28 pb-24 bg-cream-50 min-h-screen">
      <div className="relative mx-auto max-w-7xl px-5 lg:px-8">
        <div className="max-w-2xl">
          <div className="eyebrow">Step 2 of 3</div>
          <h1 className="display text-4xl sm:text-5xl mt-3 text-forest-900">Downpayment proof</h1>
          <p className="mt-4 text-forest-800/80 leading-relaxed">
            Send the downpayment through the Hacienda’s official channels, then upload a screenshot.
            The booking is submitted only after that screenshot is attached, and it stays{' '}
            <strong>Pending</strong> until the Hacienda approves or rejects it. It is not confirmed yet.
          </p>
          <FlowSteps current={1} />
        </div>

        <div className="mt-10 grid lg:grid-cols-3 gap-8 lg:gap-10">
          <section className="lg:col-span-2 space-y-6">
            {error && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700" role="alert">
                {error}
              </div>
            )}

            <div className="bg-white rounded-[28px] border border-forest-900/5 shadow-card p-6 sm:p-8">
              <h2 className="font-serif text-2xl text-forest-900">How to pay</h2>
              <p className="mt-3 text-sm text-forest-800/80 leading-relaxed">
                Use only the Admin-published account below. Never send money to a third party claiming to be
                staff, and never share a password, PIN, or one-time code.
              </p>
              <div className="mt-5">
                <PaymentInformationPanel payment={paymentInformation} requiredAmount={dueNow ?? undefined} />
              </div>
              <div className="mt-5">
                <OfficialChannelsNotice />
              </div>
              <div className="mt-5 rounded-2xl bg-forest-900 text-cream-50 p-5">
                <div className="text-[11px] uppercase tracking-eyebrow text-cream-100/60">Downpayment due now</div>
                {dueNow !== null ? (
                  <>
                    <div className="font-serif text-4xl mt-1">{peso(dueNow)}</div>
                    <p className="mt-2 text-xs text-cream-100/75 leading-relaxed">
                      50% of {peso(stayTotal!)} for one 22-hour standard stay (2:00 PM–12:00 noon). The {quoted?.classification === 'weekend_holiday' ? 'weekend/holiday rate (Friday or Saturday check-in, or an Admin-listed holiday)' : 'weekday rate (Sunday–Thursday check-in)'} uses your check-in date
                      {rate?.source ? ` · ${rate.source}` : ''}.
                      {deposit ? ` The refundable security deposit (${peso(deposit)}) is shown separately.` : ''}
                      {stayTotal !== null && dueNow < stayTotal
                        ? ` The remaining 50% (${peso(stayTotal - dueNow)}) is due at check-in and is not part of this screenshot.`
                        : ''}
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-cream-100/80 leading-relaxed">
                    Enter the downpayment amount you sent. No due-now figure is published for this stay,
                    so the Hacienda confirms the amount from your screenshot.
                  </p>
                )}
              </div>
            </div>

            <div className="bg-white rounded-[28px] border border-forest-900/5 shadow-card p-6 sm:p-8" data-tour="payment-proof">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-serif text-2xl text-forest-900">Screenshot</h2>
                <span className="rounded-full bg-amber-100 text-amber-900 text-[10px] uppercase tracking-eyebrow px-2.5 py-1">
                  Required
                </span>
              </div>
              <p className="mt-2 text-sm text-forest-700/80">
                A photo of the GCash, Maya, or bank receipt. JPG, PNG, or WEBP, under 5 MB.
              </p>

              <label
                className={`mt-5 flex min-h-[180px] cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-4 py-8 text-center ${
                  proofFile ? 'border-forest-700 bg-forest-50' : 'border-forest-900/20 bg-cream-50'
                }`}
              >
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(event) => void onFile(event.target.files?.[0] ?? null)}
                />
                {previewUrl ? (
                  <img src={previewUrl} alt="Downpayment screenshot preview" className="max-h-56 rounded-xl object-contain" />
                ) : (
                  <>
                    <Sparkle size={22} className="text-forest-600" />
                    <span className="mt-3 text-sm text-forest-800">Choose a screenshot to attach</span>
                    <span className="mt-1 text-xs text-forest-600">The booking cannot be submitted without this file.</span>
                  </>
                )}
              </label>
              {proofFile && (
                <button
                  type="button"
                  className="mt-3 text-xs text-forest-700 underline underline-offset-2"
                  onClick={() => {
                    setProofFile(null)
                    setAmountCandidates([])
                    setClaimOffReceipt(false)
                    // The figure that was read off this screenshot has no evidence
                    // behind it any more, so it goes with the screenshot and the
                    // published downpayment comes back as the default claim.
                    setAmount(dueNow === null ? '' : String(dueNow))
                    if (fileInput.current) fileInput.current.value = ''
                  }}
                >
                  Remove screenshot
                </button>
              )}
              {ocrNote && <p className="mt-3 text-xs text-forest-700/70">{ocrNote}</p>}

              {/* Two or more figures on one screenshot is a question, not a detail.
                  A GCash Express Send prints `Amount` (what the recipient receives)
                  and `Total Amount Sent` (what left the sender), and they disagree
                  whenever a fee was charged. */}
              {amountCandidates.length > 1 && (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/60 px-4 py-3">
                  <span className="block text-xs font-medium text-amber-900">
                    This screenshot shows {amountCandidates.length} different amounts. Which one did you send?
                  </span>
                  <div className="mt-2 space-y-1.5">
                    {amountCandidates.map((candidate) => (
                      <label key={candidate.value} className="flex items-center gap-2 text-xs text-amber-900 cursor-pointer">
                        <input
                          type="radio"
                          name="screenshot-amount"
                          checked={amount === candidate.value}
                          onChange={() => setAmount(candidate.value)}
                        />
                        <span className="font-medium">
                          ₱{Number(candidate.value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                        <span className="text-amber-700">({candidate.label})</span>
                        {dueNow !== null && Math.abs(Number(candidate.value) - dueNow) < 0.005 && (
                          <span className="text-emerald-700">— matches your downpayment</span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-6 grid sm:grid-cols-2 gap-5">
                <label className="block">
                  <span className="label">Amount on the screenshot</span>
                  <input
                    className="field"
                    inputMode="decimal"
                    value={amount}
                    placeholder="0.00"
                    onChange={(event) => setAmount(event.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="label">Reference number <span className="normal-case tracking-normal text-forest-500">(optional)</span></span>
                  <input
                    className="field"
                    value={reference}
                    placeholder="GCash / Maya / bank ref"
                    onChange={(event) => setReference(event.target.value)}
                  />
                </label>
              </div>

              {/* The claim against the evidence for it. `submit` refuses this, so it
                  is said plainly here, with the figures the screenshot printed one
                  click away — and with a way through for a Guest whose receipt the
                  engine read wrong, because OCR is a hint and the Admin is the one
                  who reads the screenshot. */}
              {amountCandidates.length > 0 && (offReceipt || claimOffReceipt) && (
                <div
                  className={`mt-4 rounded-2xl border px-4 py-3 ${
                    offReceipt ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50/60'
                  }`}
                >
                  <span className={`block text-xs font-medium ${offReceipt ? 'text-red-700' : 'text-amber-900'}`}>
                    {offReceipt ??
                      (belowDueNow
                        ? `You are claiming an amount this screenshot does not show. It is also below the ${peso(dueNow!)} down payment this Booking asks for, so this still cannot be submitted until the amount is corrected.`
                        : 'You are claiming an amount this screenshot does not show. The Admin reads the amount off your screenshot before approving this booking.')}
                  </span>
                  {offReceipt && (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                      {amountCandidates.map((candidate) => (
                        <button
                          key={candidate.value}
                          type="button"
                          className="text-xs text-red-700 underline underline-offset-2"
                          onClick={() => setAmount(candidate.value)}
                        >
                          Use {peso(Number(candidate.value))} ({candidate.label})
                        </button>
                      ))}
                    </div>
                  )}
                  <label className="mt-2 flex items-start gap-2 text-xs text-amber-900 cursor-pointer">
                    <input
                      type="checkbox"
                      name="claim-off-receipt"
                      className="mt-0.5"
                      checked={claimOffReceipt}
                      onChange={(event) => setClaimOffReceipt(event.target.checked)}
                    />
                    <span>
                      My screenshot says a different amount. I typed it above from the receipt.
                    </span>
                  </label>
                </div>
              )}

              {/* `submit` refuses a claim below `dueNow`, so this page says the claim cannot
                  be submitted rather than promising an Admin review that cannot
                  happen — and still says it when the claim clears the threshold,
                  because a claim above `dueNow` does reach a person. */}
              {amountMismatchNote(Number(amount) || 0, dueNow ?? 0, { underpay: 'blocks_submit' }) && (
                <p className="mt-4 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 leading-relaxed">
                  {amountMismatchNote(Number(amount) || 0, dueNow ?? 0, { underpay: 'blocks_submit' })}
                </p>
              )}

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={busy || !proofFile}
                  onClick={() => void submit()}
                >
                  {busy ? 'Submitting…' : 'Submit booking'}
                  {!busy && <ArrowRight size={16} />}
                </button>
                <Link to={`/book?accommodation=${draft.accommodation}`} className="btn-ghost text-xs">
                  Back to details
                </Link>
              </div>
              <p className="mt-4 text-xs text-forest-700/60 max-w-lg leading-relaxed">
                Submitting marks the booking <strong>Pending</strong>. It is not confirmed until an admin
                accepts the screenshot. If they decline it, the status becomes <strong>Rejected</strong>.
              </p>
            </div>
          </section>

          <StaySummary draft={draft} accommodationName={accommodation?.name} image={accommodation?.images[0]} nights={nights} />
        </div>
      </div>
    </div>
  )
}

function StaySummary({
  draft,
  accommodationName,
  image,
  nights,
}: {
  draft: BookingDraft
  accommodationName?: string
  image?: string
  nights: number
}) {
  return (
    <aside className="lg:sticky lg:top-28 self-start">
      <div className="rounded-[28px] overflow-hidden border border-forest-900/5 shadow-depth bg-white">
        <div className="relative">
          <SmartImage src={image || '/images/gmaps/img-07.jpg'} alt={accommodationName || 'Hacienda'} className="w-full h-44 object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-forest-950/75 to-transparent" />
          <div className="absolute bottom-4 left-5 right-5 text-cream-50">
            <div className="text-[10px] uppercase tracking-eyebrow opacity-80">Not submitted yet</div>
            <div className="font-serif text-2xl">{accommodationName || 'Your stay'}</div>
          </div>
        </div>
        <div className="p-6 space-y-3 text-sm">
          <Row icon={Calendar} label="Dates" value={`${draft.check_in} → ${draft.check_out}`} />
          <Row icon={Users} label="Guests" value={`${draft.guests} · ${nights || '—'} night${nights === 1 ? '' : 's'}`} />
          <div className="pt-3 border-t border-forest-900/10 text-xs text-forest-700 leading-relaxed">
            <div className="font-medium text-forest-900">{draft.name}</div>
            <div>{draft.phone}</div>
            <div>{draft.email}</div>
          </div>
          <p className="text-xs text-forest-600">
            No account is required. Keep the reference you receive after submitting if you want to check the status later.
          </p>
          <a href={`tel:${BUSINESS.contact.phone.replace(/\s+/g, '')}`} className="text-xs underline underline-offset-2 text-forest-800">
            {BUSINESS.contact.phoneDisplay}
          </a>
        </div>
      </div>
    </aside>
  )
}

function Row({ icon: Icon, label, value }: { icon: typeof Calendar; label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="inline-flex items-center gap-2 text-forest-700">
        <Icon size={15} /> {label}
      </span>
      <span className="text-forest-900 font-medium text-right">{value}</span>
    </div>
  )
}
