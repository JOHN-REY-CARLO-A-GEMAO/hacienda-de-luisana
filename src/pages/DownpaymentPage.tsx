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
import { downPaymentAmount, ratesForAccommodation } from '../lib/booking'
import { uploadPaymentProof } from '../lib/payments'
import { runReceiptOcr } from '../lib/payments/ocr'
import { LIMITS, checkRateLimit } from '../lib/rateLimit'
import { usePublishedRates } from '../hooks/usePublishedRates'
import { displayedRate } from '../sections/Accommodations'
import { validateAmount } from '../lib/validation'

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
  const fileInput = useRef<HTMLInputElement>(null)

  const [proofFile, setProofFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [ocrNote, setOcrNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const accommodation = ACCOMMODATIONS.find((item) => item.id === draft?.accommodation)
  const nights = draft ? nightsBetween(draft.check_in, draft.check_out) : 0
  const rate = accommodation ? displayedRate(accommodation, published) : null
  const quoted = published && draft ? ratesForAccommodation(published, draft.accommodation) : undefined
  const publishedPercent = quoted?.rateCard.downPaymentPercent
  const stayTotal = rate?.nightly && nights > 0 ? rate.nightly * nights : null
  const dueNow =
    stayTotal !== null && typeof publishedPercent === 'number'
      ? downPaymentAmount(stayTotal, publishedPercent)
      : null
  const deposit = quoted?.rateCard.securityDeposit

  useEffect(() => {
    if (!draft) navigate('/book', { replace: true })
  }, [draft, navigate])

  useEffect(() => {
    if (dueNow !== null && amount === '') setAmount(String(dueNow))
  }, [dueNow, amount])

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
    if (!file) return
    try {
      const fields = await runReceiptOcr(file)
      if (fields.reference && !reference) setReference(fields.reference)
      if (fields.amount && dueNow === null) setAmount(fields.amount)
      if (fields.reference) setOcrNote('A reference was read off the screenshot. Please check it before you submit.')
    } catch {
      // OCR is a convenience. The screenshot itself is what the Admin reviews.
    }
  }

  const submit = async () => {
    if (!proofFile) {
      setError('Upload a screenshot of your downpayment. The booking cannot be submitted without it.')
      return
    }
    const amountCheck = validateAmount(amount)
    if (!amountCheck.ok) {
      setError(amountCheck.message)
      return
    }
    const claimed = Number(amountCheck.value)
    if (dueNow !== null && claimed < dueNow) {
      setError(`The downpayment due now is ${peso(dueNow)}. The screenshot has to cover at least that amount.`)
      return
    }
    const limited = checkRateLimit('booking:create', LIMITS.booking)
    if (!limited.ok) {
      setError(limited.message)
      return
    }
    setBusy(true)
    setError('')
    try {
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
      const provisionalRef = `HDL-${Math.floor(1000 + Math.random() * 9000)}`
      const uploaded = await uploadPaymentProof({ file: proofFile, bookingRefId: provisionalRef })
      if (!uploaded.ok) {
        setError(uploaded.message)
        return
      }
      const balance = stayTotal !== null ? Math.max(0, Math.round((stayTotal - claimed) * 100) / 100) : undefined
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
          ...(uid ? { uid } : {}),
          payment_proof_url: uploaded.url,
          paymentProofUrl: uploaded.url,
          payment_plan: 'down-payment',
          payment_status: 'pending',
          amount_claimed: claimed,
          ...(reference.trim() ? { payment_reference: reference.trim() } : {}),
          ...(stayTotal !== null ? { stay_total: stayTotal } : {}),
          amount_due: dueNow ?? claimed,
          ...(deposit !== undefined ? { security_deposit: deposit } : {}),
          ...(balance !== undefined ? { balance_due: balance } : {}),
          ...(quoted
            ? { policy_version: quoted.snapshot.version, policy_effective_date: quoted.snapshot.effectiveDate }
            : {}),
          source: 'web',
        },
        { actor: 'guest', actor_id: uid || uploaded.uid, actor_name: draft.name.trim() },
      )
      clearBookingDraft()
      rememberBookingId(booking.id)
      navigate(`/booking/status?id=${encodeURIComponent(booking.id)}`, {
        replace: true,
        state: { justSubmitted: true, storage: booking.storage },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The booking could not be submitted. Please try again.'
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
                Pay the downpayment only through Hacienda de LuisAna’s official phone, email, or Facebook
                page — GCash, Maya, or bank transfer. Never send money to a third party claiming to be staff.
                This website does not publish a separate account number; confirm the receiving account on
                those official channels, then upload the screenshot here.
              </p>
              <div className="mt-5">
                <OfficialChannelsNotice />
              </div>
              <div className="mt-5 rounded-2xl bg-forest-900 text-cream-50 p-5">
                <div className="text-[11px] uppercase tracking-eyebrow text-cream-100/60">Downpayment due now</div>
                {dueNow !== null ? (
                  <>
                    <div className="font-serif text-4xl mt-1">{peso(dueNow)}</div>
                    <p className="mt-2 text-xs text-cream-100/75 leading-relaxed">
                      {publishedPercent}% of {peso(stayTotal!)} for {nights} night{nights === 1 ? '' : 's'}
                      {rate?.source ? ` · ${rate.source}` : ''}.
                      {deposit ? ` The refundable security deposit (${peso(deposit)}) is settled with the Hacienda separately.` : ''}
                      {stayTotal !== null && dueNow < stayTotal
                        ? ` Balance of ${peso(stayTotal - dueNow)} is not part of this screenshot.`
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
                    if (fileInput.current) fileInput.current.value = ''
                  }}
                >
                  Remove screenshot
                </button>
              )}
              {ocrNote && <p className="mt-3 text-xs text-forest-700/70">{ocrNote}</p>}

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
