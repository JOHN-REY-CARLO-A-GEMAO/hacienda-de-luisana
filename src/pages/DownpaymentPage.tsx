import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ACCOMMODATIONS, BUSINESS } from '../config/site'
import { FlowSteps } from '../components/Booking/FlowSteps'
import { OfficialChannelsNotice } from '../components/OfficialChannelsNotice'
import { SmartImage } from '../components/SmartImage'
import { clearBookingDraft, loadBookingDraft, rememberBookingId, type BookingDraft } from '../lib/bookingDraft'
import { formatStayDate } from '../lib/formatDate'
import { cloudBookingsDB } from '../lib/firestoreBookings'
import { ensureGuestUid } from '../lib/guestAuth'
import { ArrowRight, Calendar, Sparkle, Users } from '../lib/icons'
import {
  addonFeeLines,
  composeSpecialRequests,
  eventPurposeLabel,
  paymentOptionsForTotal,
  pricedStayExtras,
  quoteAccommodation,
  sanitizeStayRequests,
  validateBookingPayload,
  validateBookingSelection,
} from '../lib/booking'
import { composeRequestMeta, officialAddonFallbacks } from '../lib/stayRequests'
import { AddonFeeSummary } from '../components/Booking/StayRequestsSection'
import { uploadPaymentProof } from '../lib/payments'
import { usePaymentInformation } from '../hooks/usePaymentInformation'
import { PaymentInformationPanel } from '../components/Booking/PaymentInformationPanel'
import { amountMismatchNote, claimAgainstReceipt, runReceiptOcr, suggestedAmount, type ReceiptAmount } from '../lib/payments/ocr'
import { LIMITS, checkRateLimit } from '../lib/rateLimit'
import { usePublishedRates } from '../hooks/usePublishedRates'
import { displayedRate } from '../sections/Accommodations'
import { validateAmount, validateProofFile } from '../lib/validation'
import { guestFacingErrorMessage } from '../lib/firebaseFailure'
import { createNotification, notifyAdmin } from '../lib/notifications'
import { Alert, Container, Field, Input, Page, PageHeader, RequestBadge } from '../components/ui'

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
  const submittingRef = useRef(false)
  // A late OCR result must never describe a removed or replacement screenshot.
  const scanGeneration = useRef(0)
  const amountEdited = useRef(false)
  const [scanning, setScanning] = useState(false)

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
  // Only the add-ons the Admin has priced enter the quote and the money fields;
  // unpriced requests travel on the document for Admin review (see submit).
  const quoted = published && draft
    ? quoteAccommodation(published, draft.accommodation, {
        check_in: draft.check_in,
        check_out: draft.check_out,
        guests: Number(draft.guests),
        ...pricedStayExtras(published, draft),
      })
    : undefined
  const addonFallbacks = officialAddonFallbacks(published)
  const requests = sanitizeStayRequests(draft ?? undefined, published)
  const addonLines = addonFeeLines(published, requests, addonFallbacks)
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

  // No draft means the booking session ended (tab closed, browser cleared, or the
  // page was opened directly), or the draft was incomplete. Say so on /book rather
  // than dropping the Guest there with an empty form and no explanation.
  useEffect(() => {
    if (!draft) {
      navigate('/book', {
        replace: true,
        state: {
          notice:
            'Your booking session has ended, so your details were cleared. Please enter your stay details again. If you already sent payment, keep your receipt and contact the Hacienda for help.',
        },
      })
    } else if (!accommodation) {
      navigate('/book', {
        replace: true,
        state: {
          notice:
            'That accommodation is no longer valid for booking. Please choose an available accommodation. If you already sent payment, keep your receipt and contact the Hacienda for help.',
        },
      })
    }
  }, [draft, accommodation, navigate])

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

  useEffect(() => () => { scanGeneration.current += 1 }, [])

  if (!draft) return null

  const onFile = async (file: File | null) => {
    const scan = ++scanGeneration.current
    setScanning(false)
    amountEdited.current = false
    setError('')
    setOcrNote('')
    setAmountCandidates([])
    setClaimOffReceipt(false)
    setReference('')
    setAmount(dueNow === null ? '' : String(dueNow))
    if (!file) {
      setProofFile(null)
      return
    }
    const fileValid = validateProofFile(file)
    if (!fileValid.ok) {
      setError(fileValid.message)
      setProofFile(null)
      if (fileInput.current) fileInput.current.value = ''
      return
    }
    setProofFile(file)
    setScanning(true)
    try {
      const fields = await runReceiptOcr(file)
      if (scan !== scanGeneration.current) return
      if (fields.reference) setReference((current) => current || fields.reference)
      // Every distinct figure the screenshot prints, kept so a receipt whose
      // `Amount` and `Total Amount Sent` disagree asks the Guest which one they
      // sent. Without this the field sits on the published `dueNow` whatever the
      // screenshot says, and a Guest who paid short files a full claim — the
      // underpayment check below compares the field against `dueNow`, so a
      // pre-filled field agrees with itself and nothing catches it.
      const candidates = fields.amounts
      setAmountCandidates(candidates)
      if (!amountEdited.current && candidates.length === 1) {
        // One unambiguous figure: trust it over a pre-filled amount.
        setAmount(candidates[0].value)
      } else if (!amountEdited.current && candidates.length > 1 && dueNow !== null) {
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
      if (scan === scanGeneration.current) setOcrNote('Could not read this screenshot automatically. Please enter the amount and reference yourself.')
    } finally {
      if (scan === scanGeneration.current) setScanning(false)
    }
  }

  const submit = async () => {
    // The ref closes the small gap before React paints `disabled`; a second tap
    // must not upload the same proof or create a second Booking.
    if (submittingRef.current || scanning) return
    submittingRef.current = true
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
      // status, stay length, guest count and the current published quote
      // all have to agree first.
      const rules = validateBookingSelection(
        {
          accommodation: draft.accommodation,
          check_in: draft.check_in,
          check_out: draft.check_out,
          guests: Number(draft.guests),
          pet_count: requests.pet_count ?? 0,
          bonfire_wood_sets: requests.bonfire_wood_sets ?? 0,
          late_checkout_hours: requests.late_checkout_hours ?? 0,
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
      let availability
      try {
        availability = await cloudBookingsDB.checkAvailability({
          accommodation: draft.accommodation,
          check_in: draft.check_in,
          check_out: draft.check_out,
        })
      } catch {
        setError('Availability could not be checked. Your booking was not submitted. Please retry; if you have already paid, keep your receipt and contact the Hacienda for assistance.')
        return
      }
      if (!availability.available) {
        setError(availability.blockingState === 'unknown'
          ? 'Availability could not be checked. Your booking was not submitted. Please retry; if you have already paid, keep your receipt and contact the Hacienda for assistance.'
          : 'Those dates are no longer available. Your booking was not submitted. If you have already paid, keep your receipt and contact the Hacienda for assistance before choosing other dates.')
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
          'We could not attach this booking to you, so the booking was not sent. No booking was saved and your screenshot is still here. Retry or contact the Hacienda; if you already paid, keep your receipt.',
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
          pet_count: requests.pet_count ?? 0,
          bonfire_wood_sets: requests.bonfire_wood_sets ?? 0,
          late_checkout_hours: requests.late_checkout_hours ?? 0,
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
      //
      // Structured add-ons & requests (src/lib/booking/requests.ts): a charge
      // the Admin has PRICED (published pet_policy / late_checkout_per_hour) is
      // stored on the same keys the quote and firestore.rules arithmetic use
      // (`pet_count`, `late_checkout_hours`) and is already inside `stay_total`.
      // A charge nobody has priced is stored as a PENDING REQUEST — the
      // `late_checkout_request` shape the Admin app already renders and
      // approves, or a `pet_request` mirror of it — and never touches the money
      // fields. `special_requests` is composed from all of it plus the Guest's
      // notes, so the Admin's existing Notes view shows every request even on
      // surfaces that have not learned the structured keys yet.
      const composeMeta = composeRequestMeta(published, requests)
      const requestedAt = new Date().toISOString()
      const petCount = requests.pet_count ?? 0
      const lateHours = requests.late_checkout_hours ?? 0
      const bonfireSets = requests.bonfire_wood_sets ?? 0
      const roundPeso = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
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
           special_requests: composeSpecialRequests(
             { ...requests, notes: draft.special_requests.trim() },
             composeMeta,
           ),
           ...(composeMeta.petsIncludedInTotal
             ? { pet_count: petCount }
             : petCount > 0
               ? { pet_request: {
                   count: petCount,
                   estimated_fee: roundPeso(petCount * (composeMeta.petUnitAmount ?? 0)),
                   status: 'pending',
                   requested_at: requestedAt,
                 } }
               : {}),
           ...(composeMeta.lateCheckoutIncludedInTotal
             ? { late_checkout_hours: lateHours }
             : lateHours > 0
               ? { late_checkout_request: {
                   hours: lateHours,
                   fee: roundPeso(lateHours * (composeMeta.lateCheckoutUnitAmount ?? 0)),
                   status: 'pending',
                   requested_at: requestedAt,
                 } }
               : {}),
           ...(bonfireSets > 0 ? { bonfire_wood_sets: bonfireSets } : {}),
           ...(requests.event_purpose ? { event_purpose: requests.event_purpose } : {}),
           ...(requests.event_purpose === 'other' && requests.event_purpose_detail
             ? { event_purpose_detail: requests.event_purpose_detail }
             : {}),
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
       void notifyAdmin({
         bookingId: booking.id,
         title: 'New booking submitted',
         message: `${draft.name.trim()} requested ${draft.accommodation} (${draft.check_in} → ${draft.check_out}) with a downpayment screenshot.`,
         type: 'booking_submitted',
       })
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
      submittingRef.current = false
      setBusy(false)
    }
  }

  return (
    <Page className="booking-page relative dark:bg-forest-950 dark:text-cream-50">
      <Container width="wide" className="relative">
        <PageHeader
          eyebrow="Hakbang 5–6 sa 7 · Bayad at pagsusumite"
          title="Downpayment proof"
          lead={
            <p className="max-w-3xl">
              Magbayad lamang sa opisyal na account sa ibaba, pagkatapos ay i-upload ang screenshot ng resibo.
              Maisusumite lamang ang booking kapag may patunay ng bayad. Mananatili itong{' '}
              <strong>Pending — hinihintay ang approval</strong>, at <strong>hindi pa ito kumpirmado</strong>,
              hangga’t hindi napagtitibay ng Hacienda.
            </p>
          }
          aside={<FlowSteps current={4} completedThrough={3} />}
        />

        <Alert tone="warning" role="status" className="mt-6 max-w-4xl">
          <strong>Dates are not held yet.</strong> Availability may change before you submit your proof;
          payment alone does not reserve a stay. If you have already paid and cannot submit, keep your
          receipt and contact the Hacienda through its official channels for help. Do not pay again.
        </Alert>
        <div className="mt-10 grid lg:grid-cols-3 gap-8 lg:gap-10">
          <section className="lg:col-span-2 space-y-6">
            {error && <Alert tone="danger">{error}</Alert>}

            <div className="booking-light-surface card p-6 sm:p-8">
              <h2 className="h2">Paano Magbayad</h2>
              <p className="mt-3 text-base text-forest-800 leading-relaxed">
                Gamitin lamang ang QR code o account na inilathala ng Admin. Huwag magpadala sa ibang tao at
                huwag ibahagi ang password, PIN, o one-time code.
              </p>
              <div className="mt-5">
                {dueNow !== null ? (
                  <PaymentInformationPanel payment={paymentInformation} requiredAmount={dueNow} />
                ) : (
                  <Alert tone="warning" role="status">The published rate is not available yet. Do not send payment; online submission requires an applicable published rate.</Alert>
                )}
              </div>
              <div className="mt-5">
                <OfficialChannelsNotice />
              </div>
              <div className="mt-5 rounded-2xl bg-forest-900 p-5 text-cream-50 sm:p-6">
                <h3 className="font-serif text-2xl">Buod ng Bayad</h3>
                <p className="mt-1 text-base text-cream-100/85">
                  {selectedOption ? (paymentPlan === 'down-payment' ? '50% downpayment' : 'Full payment') : 'Published rate unavailable'} · {nights} {nights === 1 ? 'night' : 'nights'}
                </p>
                <dl className="mt-5 space-y-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1">
                    <dt className="text-base text-cream-100/85">Kabuuan ng stay</dt>
                    <dd className="guest-num text-xl font-semibold">{stayTotal === null ? 'Hindi pa available' : peso(stayTotal)}</dd>
                  </div>
                  <div className="border-t border-cream-100/20 pt-4">
                    <dt className="text-base font-semibold text-cream-50">Babayaran Ngayon (Downpayment due now)</dt>
                    <dd className="guest-num mt-1 text-4xl font-semibold sm:text-5xl">{dueNow === null ? 'Hindi available' : peso(dueNow)}</dd>
                  </div>
                  {stayTotal !== null && dueNow !== null && selectedOption && selectedOption.balance > 0 && (
                    <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1 border-t border-cream-100/20 pt-4">
                      <dt className="text-base text-cream-100/85">Natitirang bayad sa check-in</dt>
                      <dd className="guest-num text-xl font-semibold">{peso(selectedOption.balance)}</dd>
                    </div>
                  )}
                  {deposit != null && (
                    <div className="border-t border-cream-100/20 pt-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1">
                        <dt className="text-base text-cream-100/85">Refundable security deposit</dt>
                        <dd className="guest-num text-xl font-semibold">{peso(deposit)}</dd>
                      </div>
                      <p className="mt-1 text-base leading-relaxed text-cream-100/85">
                        Hiwalay ito sa “Babayaran Ngayon” at hindi idinadagdag nang kusa sa halagang ilalagay sa screenshot.
                      </p>
                    </div>
                  )}
                </dl>
                {dueNow !== null ? (
                  <p className="mt-5 text-base leading-relaxed text-cream-100/90">
                    {paymentPlan === 'down-payment'
                      ? `Ang babayaran ngayon ay 50% ng kabuuan para sa ${nights}-night stay.`
                      : 'Ang babayaran ngayon ay ang buong stay total.'}{' '}
                    Ang bawat gabi ay standard stay (2:00 PM–12:00 noon), at ang rate ay batay sa petsa ng check-in.
                    {rate?.source ? ` ${rate.source}.` : ''}
                  </p>
                ) : (
                  <p className="mt-5 text-base leading-relaxed text-cream-100/90">
                    Hindi available ang published rate para sa stay na ito. Huwag magpadala: hindi
                    maisusumite online ang booking hangga’t walang applicable published rate. Bumalik sa
                    detalye o makipag-ugnayan sa Hacienda sa opisyal na channel.
                  </p>
                )}
              </div>
            </div>

            <fieldset disabled={busy} className="booking-light-surface card min-w-0 p-6 sm:p-8" data-tour="payment-proof">
              <div className="flex items-center justify-between gap-3">
                <h2 className="h2">Patunay ng Bayad</h2>
                <RequestBadge status="required" label="Kailangan" />
              </div>
              <p className="mt-2 text-base leading-relaxed text-forest-700">
                Larawan ng GCash, Maya, o bank receipt. Image file na mas maliit sa 5 MB.
                Dapat mabasa ang halaga at reference bago ipadala.
              </p>

              <label
                className={`mt-5 flex min-h-[180px] cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-4 py-8 text-center ${
                  proofFile ? 'border-forest-700 bg-forest-50' : 'border-forest-900/20 bg-cream-50'
                } focus-within:ring-4 focus-within:ring-forest-600/30`}
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
                    <span className="mt-3 text-lg font-semibold text-forest-800">Pumili ng screenshot na ilakip</span>
                    <span className="mt-2 text-base text-forest-700">Hindi maisusumite ang booking nang walang patunay na ito.</span>
                  </>
                )}
              </label>
              {proofFile && (
                <button
                  type="button"
                  className="mt-3 inline-flex min-h-11 items-center px-2 text-base text-forest-700 underline underline-offset-2"
                  onClick={() => {
                    scanGeneration.current += 1
                    setScanning(false)
                    amountEdited.current = false
                    setProofFile(null)
                    setOcrNote('')
                    setReference('')
                    setAmountCandidates([])
                    setClaimOffReceipt(false)
                    // The figure that was read off this screenshot has no evidence
                    // behind it any more, so it goes with the screenshot and the
                    // published downpayment comes back as the default claim.
                    setAmount(dueNow === null ? '' : String(dueNow))
                    if (fileInput.current) fileInput.current.value = ''
                  }}
                >
                  Remove screenshot · Alisin
                </button>
              )}
              {scanning && (
                <p className="mt-3 text-base text-forest-700" role="status">
                  Reading the screenshot… You can{' '}
                  <button type="button" className="underline" onClick={() => {
                    scanGeneration.current += 1
                    setScanning(false)
                    setOcrNote('Automatic reading skipped. Enter the amount and reference from your receipt.')
                  }}>enter details manually</button> instead.
                </p>
              )}
              {ocrNote && <p className="mt-3 text-base text-forest-700/70" role="status">{ocrNote}</p>}

              {/* Two or more figures on one screenshot is a question, not a detail.
                  A GCash Express Send prints `Amount` (what the recipient receives)
                  and `Total Amount Sent` (what left the sender), and they disagree
                  whenever a fee was charged. */}
              {amountCandidates.length > 1 && (
                <Alert tone="warning" role="status" className="mt-4 text-base">
                  <span className="block font-medium">
                    This screenshot shows {amountCandidates.length} different amounts. Which one did you send?
                  </span>
                  <div className="mt-2 space-y-1.5">
                    {amountCandidates.map((candidate) => (
                      <label key={candidate.value} className="flex min-h-11 cursor-pointer items-center gap-3 py-2 text-base text-amber-900">
                        <input
                          type="radio"
                          name="screenshot-amount"
                          className="h-5 w-5 shrink-0"
                          checked={amount === candidate.value}
                          onChange={() => { amountEdited.current = true; setAmount(candidate.value) }}
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
                </Alert>
              )}

              <div className="mt-6 grid sm:grid-cols-2 gap-5">
                <Field label="Halagang Nakasaad sa Screenshot" required>
                  <Input
                    inputMode="decimal"
                    autoComplete="off"
                    spellCheck={false}
                    value={amount}
                    placeholder="0.00"
                    onChange={(event) => { amountEdited.current = true; setAmount(event.target.value) }}
                  />
                </Field>
                <Field label="Reference Number" hint="Optional, pero mabilisang masusuri kung mayroon.">
                  <Input
                    value={reference}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="GCash / Maya / bank ref"
                    onChange={(event) => setReference(event.target.value)}
                  />
                </Field>
              </div>

              {/* The claim against the evidence for it. `submit` refuses this, so it
                  is said plainly here, with the figures the screenshot printed one
                  click away — and with a way through for a Guest whose receipt the
                  engine read wrong, because OCR is a hint and the Admin is the one
                  who reads the screenshot. */}
              {amountCandidates.length > 0 && (offReceipt || claimOffReceipt) && (
                <Alert tone={offReceipt ? 'danger' : 'warning'} role="status" className="mt-4 text-base">
                  <span className="block font-medium">
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
                          className="text-base text-red-700 underline underline-offset-2"
                          onClick={() => { amountEdited.current = true; setAmount(candidate.value) }}
                        >
                          Use {peso(Number(candidate.value))} ({candidate.label})
                        </button>
                      ))}
                    </div>
                  )}
                  <label className="mt-2 flex min-h-11 cursor-pointer items-start gap-3 py-2 text-base">
                    <input
                      type="checkbox"
                      name="claim-off-receipt"
                      className="mt-1 h-5 w-5 shrink-0"
                      checked={claimOffReceipt}
                      onChange={(event) => setClaimOffReceipt(event.target.checked)}
                    />
                    <span>
                      My screenshot says a different amount. I typed it above from the receipt.
                    </span>
                  </label>
                </Alert>
              )}

              {/* `submit` refuses a claim below `dueNow`, so this page says the claim cannot
                  be submitted rather than promising an Admin review that cannot
                  happen — and still says it when the claim clears the threshold,
                  because a claim above `dueNow` does reach a person. */}
              {amountMismatchNote(Number(amount) || 0, dueNow ?? 0, { underpay: 'blocks_submit' }) && (
                <Alert tone="warning" role="status" className="mt-4 text-base">
                  {amountMismatchNote(Number(amount) || 0, dueNow ?? 0, { underpay: 'blocks_submit' })}
                </Alert>
              )}

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={busy || scanning || !proofFile}
                  onClick={() => void submit()}
                >
                  {busy ? 'Submitting… · Ipinapasa…' : scanning ? 'Reading screenshot…' : 'Submit booking · Ipadala'}
                  {!busy && <ArrowRight size={20} />}
                </button>
                <Link
                  to={`/book?accommodation=${draft.accommodation}`}
                  className={`btn-ghost ${busy ? 'pointer-events-none opacity-50' : ''}`}
                  aria-disabled={busy || undefined}
                  onClick={(event) => { if (busy) event.preventDefault() }}
                >
                  Back to details · Bumalik
                </Link>
              </div>
              <p className="mt-4 max-w-xl text-base leading-relaxed text-forest-700">
                {busy ? (
                  <strong>Ipinapasa na. Maghintay at huwag pindutin muli ang Submit.</strong>
                ) : (
                  <>Ang pagpasa ay gagawa ng <strong>Pending</strong> booking. Hindi pa ito kumpirmado hangga’t hindi ina-aprubahan ng Admin ang patunay at detalye. Kapag bumalik sa detalye, mananatili ang iyong isinulat.</>
                )}
              </p>
            </fieldset>
          </section>

          <StaySummary draft={draft} accommodationName={accommodation?.name} image={accommodation?.images[0]} nights={nights} addonLines={addonLines} />
        </div>
      </Container>
    </Page>
  )
}

function StaySummary({
  draft,
  accommodationName,
  image,
  nights,
  addonLines,
}: {
  draft: BookingDraft
  accommodationName?: string
  image?: string
  nights: number
  addonLines: ReturnType<typeof addonFeeLines>
}) {
  return (
    <aside className="lg:sticky lg:top-28 self-start">
      <div className="booking-light-surface rounded-[28px] overflow-hidden border border-forest-900/5 shadow-depth bg-white">
        <div className="relative">
          <SmartImage src={image || '/images/gmaps/img-07.jpg'} alt={accommodationName || 'Hacienda'} className="w-full h-44 object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-forest-950/75 to-transparent" />
          <div className="absolute bottom-4 left-5 right-5 text-cream-50">
            <div className="text-base font-semibold uppercase tracking-eyebrow text-cream-50">Buod ng iyong stay</div>
            <div className="font-serif text-2xl">{accommodationName || 'Your stay'}</div>
          </div>
        </div>
        <div className="p-6 space-y-4 text-base">
          <h3 className="font-serif text-2xl text-forest-900">Buod ng Booking</h3>
          <p className="text-base font-semibold text-amber-800">Hindi pa naisusumite · Hindi pa kumpirmado</p>
          <Row icon={Calendar} label="Pagdating" value={formatStayDate(draft.check_in)} />
          <Row icon={Calendar} label="Pag-alis" value={formatStayDate(draft.check_out)} />
          <Row icon={Users} label="Mga Bisita" value={`${draft.guests} · ${nights || '—'} night${nights === 1 ? '' : 's'}`} />
          {draft.event_purpose && (
            <Row
              icon={Sparkle}
              label="Event / purpose"
              value={draft.event_purpose === 'other' && draft.event_purpose_detail?.trim()
                ? `Other — ${draft.event_purpose_detail.trim()}`
                : eventPurposeLabel(draft.event_purpose)}
            />
          )}
          <AddonFeeSummary lines={addonLines} />
          <div className="pt-3 border-t border-forest-900/10 text-base text-forest-700 leading-relaxed">
            <div className="font-medium text-forest-900">{draft.name}</div>
            <div>{draft.phone}</div>
            <div>{draft.email}</div>
          </div>
          <p className="text-base leading-relaxed text-forest-600">
            Hindi kailangan ng account. Itabi ang reference na matatanggap pagkatapos maipasa para matingnan ang status.
          </p>
          <a href={`tel:${BUSINESS.contact.phone.replace(/\s+/g, '')}`} className="inline-flex min-h-11 items-center text-base text-forest-800 underline underline-offset-2">
            {BUSINESS.contact.phoneDisplay}
          </a>
        </div>
      </div>
    </aside>
  )
}

function Row({ icon: Icon, label, value }: { icon: typeof Calendar; label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] items-start gap-4">
      <span className="inline-flex items-start gap-2 text-forest-700">
        <Icon size={19} className="mt-0.5 shrink-0" aria-hidden="true" /> {label}
      </span>
      <span className="font-semibold text-right text-forest-900">{value}</span>
    </div>
  )
}
