import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { ACCOMMODATIONS, BUSINESS } from '../config/site'
import { cloudBookingsDB } from '../lib/firestoreBookings'
import { ensureGuestUid } from '../lib/guestAuth'
import type { Booking } from '../lib/storage'
import { isFirebaseConfigured } from '../lib/firebase'
import { Calendar, Users, Bed, ArrowRight, Sparkle, MapPin, Phone } from '../lib/icons'
import { SmartImage } from '../components/SmartImage'
import { HoldCountdown } from '../components/Booking/HoldCountdown'
import { KycUpload } from '../components/Booking/KycUpload'
import { useAuth } from '../hooks/useAuth'
import {
  guestCountValid,
  validateEmail,
  validateName,
  validatePhMobile,
  validateStayDates,
} from '../lib/validation'
import { LIMITS, checkRateLimit } from '../lib/rateLimit'
import { LEGAL_VERSION } from '../lib/legal'
import { usePublishedRates } from '../hooks/usePublishedRates'
import { displayedRate } from '../sections/Accommodations'
import { OfficialChannelsNotice } from '../components/OfficialChannelsNotice'

type FormState = {
  check_in: string
  check_out: string
  guests: number
  accommodation: string
  name: string
  phone: string
  email: string
  special_requests: string
}

type Errors = Partial<Record<keyof FormState, string>>

const today = () => new Date().toISOString().slice(0, 10)

const OPTIONS = [
  ...ACCOMMODATIONS.filter((a) => a.active).map((a) => ({ id: a.id, label: a.name })),
  { id: 'other', label: 'Other / Ask Us' },
]

export function BookingPage() {
  const { user } = useAuth()
  const [params] = useSearchParams()
  const initialAccommodation = params.get('accommodation') || ACCOMMODATIONS[0].id

  const [form, setForm] = useState<FormState>({
    check_in: '',
    check_out: '',
    guests: 2,
    accommodation: initialAccommodation,
    name: '',
    phone: '',
    email: '',
    special_requests: '',
  })
  const [errors, setErrors] = useState<Errors>({})
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string>('')
  const [submittedRef, setSubmittedRef] = useState<string>('')
  const [submittedId, setSubmittedId] = useState<string>('')
  const [submittedBooking, setSubmittedBooking] = useState<Booking | null>(null)
  // Where the request actually landed. A cloud write can be refused (rules not
  // deployed, Anonymous sign-in off, the Guest offline), and when it is, the
  // Booking is kept in this browser — the screen has to say so rather than
  // promise a request the Hacienda never received.
  const [submittedStorage, setSubmittedStorage] = useState<'cloud' | 'local'>(
    cloudBookingsDB.isCloud ? 'cloud' : 'local',
  )
  // G2: availability is checked by the system before the Guest commits, not
  // only in the Admin's head at approval time (ticket #12).
  const [availability, setAvailability] = useState<{ available: boolean; heldBy: number } | null>(null)
  const [acceptedTerms, setAcceptedTerms] = useState(false)

  useEffect(() => {
    if (status === 'success') window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [status])

  // A signed-in Guest does not type their own details again. Filled once, and
  // only into fields they have left empty: a name they are typing is theirs.
  const prefilled = useRef(false)
  useEffect(() => {
    if (prefilled.current || !user) return
    prefilled.current = true
    setForm((current) => ({
      ...current,
      name: current.name || user.displayName || '',
      email: current.email || user.email || '',
    }))
  }, [user])

  const selectedAcc = useMemo(
    () => ACCOMMODATIONS.find((a) => a.id === form.accommodation),
    [form.accommodation],
  )


  const nights = useMemo(() => {
    if (!form.check_in || !form.check_out) return 0
    const a = new Date(form.check_in).getTime()
    const b = new Date(form.check_out).getTime()
    if (Number.isNaN(a) || Number.isNaN(b)) return 0
    return Math.max(0, Math.round((b - a) / (1000 * 60 * 60 * 24)))
  }, [form.check_in, form.check_out])

  // The estimate uses the Admin's Published rates when they exist (the figure a
  // Booking is actually quoted at), else the Hacienda's own listed price; when
  // neither exists the summary says the Hacienda quotes it, rather than guess.
  const published = usePublishedRates()
  const rate = useMemo(
    () => (selectedAcc ? displayedRate(selectedAcc, published) : null),
    [selectedAcc, published],
  )
  const estimatedTotal = useMemo(() => {
    if (!rate?.nightly || !nights) return null
    return rate.nightly * nights
  }, [rate, nights])

  useEffect(() => {
    if (!form.check_in || !form.check_out || !form.accommodation) {
      setAvailability(null)
      return
    }
    if (nights <= 0) {
      setAvailability(null)
      return
    }
    let alive = true
    cloudBookingsDB
      .checkAvailability({
        accommodation: form.accommodation,
        check_in: form.check_in,
        check_out: form.check_out,
      })
      .then((result) => {
        if (alive) setAvailability({ available: result.available, heldBy: result.conflicts.length })
      })
      .catch(() => {
        // An availability read that fails must not strand the Guest: the Admin's
        // approval re-check is still the last line of defence (ADR-0002).
        if (alive) setAvailability(null)
      })
    return () => {
      alive = false
    }
  }, [form.check_in, form.check_out, form.accommodation, nights])

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors((e) => ({ ...e, [k]: undefined }))
  }

  const validate = (): boolean => {
    const e: Errors = {}
    const stay = validateStayDates(form.check_in, form.check_out)
    if (!stay.ok) e[stay.field] = stay.message
    const guests = guestCountValid(Number(form.guests), selectedAcc?.capacity ?? 12)
    if (!guests.ok) e.guests = guests.message
    if (!form.accommodation) e.accommodation = 'Select an accommodation'
    const name = validateName(form.name)
    if (!name.ok) e.name = name.message
    const phone = validatePhMobile(form.phone)
    if (!phone.ok) e.phone = phone.message
    const email = validateEmail(form.email)
    if (!email.ok) e.email = email.message
    if (!acceptedTerms) e.special_requests = `Please read and accept the Terms and Conditions (version ${LEGAL_VERSION})`
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const onSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!validate()) return
    const limited = checkRateLimit('booking:create', LIMITS.booking)
    if (!limited.ok) {
      setStatus('error')
      setErrorMsg(limited.message)
      return
    }
    setStatus('submitting')
    setErrorMsg('')
    try {
      // firestore.rules lets a Guest change their own Booking only when the
      // document already carries their uid, and `uid` is not among the keys a
      // Guest may add afterwards — so the anonymous identity is attached here, at
      // creation, exactly as the mobile app does. Without Firebase, or with
      // Anonymous sign-in disabled, the booking still goes through and the Guest
      // is told at upload time what that costs them.
      const uid = (await ensureGuestUid()) ?? undefined
      // Use cloud-aware service: Firestore if configured, else localStorage
      const b = await cloudBookingsDB.add({
        guest_name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        check_in: form.check_in,
        check_out: form.check_out,
        guests: Number(form.guests),
        accommodation: form.accommodation,
        special_requests: form.special_requests.trim(),
        ...(uid ? { uid } : {}),
      })
      // Small UX delay
      await new Promise((r) => setTimeout(r, 400))
      setSubmittedId(b.id)
      setSubmittedRef(b.id.slice(0, 8).toUpperCase())
      setSubmittedBooking(b)
      setSubmittedStorage(b.storage)
      setStatus('success')
    } catch (err: any) {
      console.error('[Booking] failed', err)
      setErrorMsg(err?.message || 'Failed to send request. Please try again.')
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <SuccessScreen
        bookingId={submittedId}
        reference={submittedRef}
        booking={submittedBooking}
        storage={submittedStorage}
        checkIn={form.check_in}
        checkOut={form.check_out}
        guests={form.guests}
        accommodationName={selectedAcc?.name || OPTIONS.find((o) => o.id === form.accommodation)?.label}
        onNew={() => {
          setStatus('idle')
          setSubmittedRef('')
          setSubmittedId('')
          setSubmittedBooking(null)
          setForm((f) => ({ ...f, name: '', phone: '', email: '', special_requests: '' }))
        }}
      />
    )
  }

  return (
    <div className="relative pt-28 pb-24 bg-cream-50 min-h-screen">
      {/* Visual shell only — soft countryside wash behind the form; the form itself is untouched */}
      <div
        className="pointer-events-none absolute -top-32 right-[-10%] h-[560px] w-[560px] rounded-full opacity-70 blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(198,214,193,0.6), transparent 65%)' }}
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-7xl px-5 lg:px-8">
        <div className="max-w-2xl">
          <div className="flex items-center gap-4">
            <span className="scene-index text-forest-400" aria-hidden="true">09</span>
            <span className="h-px w-8 bg-forest-900/15" aria-hidden="true" />
            <div className="eyebrow">Book Your Stay</div>
          </div>
          <h1 className="display text-4xl sm:text-5xl lg:text-6xl mt-5 text-forest-900">
            Plan Your Stay
          </h1>
          <p className="mt-5 text-forest-800/80 leading-relaxed">
            Send us a booking request and Hacienda de LuisAna will get back to you to confirm
            availability and finalize your reservation. This is a booking inquiry — not an
            instant-confirmation engine.
          </p>
          {!isFirebaseConfigured && (
            <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800">
              <strong>Demo mode:</strong> Firebase not configured in this build — your request will be stored
              locally in this browser and will not reach the Admin app. Please message or call us as well, so
              your dates are held. <Link to="/status" className="underline">Deployment status</Link>
            </div>
          )}
          {cloudBookingsDB.isCloud && (
            <div className="mt-4 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-xs text-emerald-800">
              ✓ Secured by Firebase — your request will be saved to the cloud and the Admin will see it in the Hacienda app.
            </div>
          )}
        </div>

        <div className="mt-12 grid lg:grid-cols-3 gap-8 lg:gap-10">
          <form
            onSubmit={onSubmit}
            noValidate
            className="lg:col-span-2 bg-white rounded-[28px] border border-forest-900/5 shadow-card p-6 sm:p-8 lg:p-10 space-y-8"
          >
            {status === 'error' && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                {errorMsg}
              </div>
            )}

            <div>
              <h2 className="font-serif text-2xl text-forest-900">Stay Details</h2>
              <div className="mt-6 grid sm:grid-cols-2 gap-5" data-tour="stay-details">
                <Field label="Check-in" error={errors.check_in}>
                  <input
                    type="date"
                    className="field"
                    min={today()}
                    value={form.check_in}
                    data-tour-field="check-in"
                    onChange={(e) => set('check_in', e.target.value)}
                  />
                </Field>
                <Field label="Check-out" error={errors.check_out}>
                  <input
                    type="date"
                    className="field"
                    min={form.check_in || today()}
                    value={form.check_out}
                    data-tour-field="check-out"
                    onChange={(e) => set('check_out', e.target.value)}
                  />
                </Field>
                <Field label="Number of guests" error={errors.guests}>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    inputMode="numeric"
                    className="field"
                    value={form.guests}
                    onChange={(e) => set('guests', Math.max(1, Number(e.target.value) || 1))}
                  />
                </Field>
                <Field label="Accommodation" error={errors.accommodation} tour="accommodation-field">
                  <select
                    className="field appearance-none pr-10"
                    value={form.accommodation}
                    onChange={(e) => set('accommodation', e.target.value)}
                  >
                    {OPTIONS.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>

            <div className="pt-2 border-t border-forest-900/5">
              <h2 className="font-serif text-2xl text-forest-900 mt-6">Your Details</h2>
              <div className="mt-6 grid sm:grid-cols-2 gap-5">
                <div className="sm:col-span-2" data-tour="guest-details">
                  <Field label="Name" error={errors.name}>
                    <input
                      className="field"
                      placeholder="Juan Dela Cruz"
                      value={form.name}
                      data-tour-field="guest-name"
                      onChange={(e) => set('name', e.target.value)}
                      autoComplete="name"
                    />
                  </Field>
                </div>
                <Field label="Mobile number" error={errors.phone}>
                  <input
                    className="field"
                    placeholder="09XX XXX XXXX"
                    inputMode="tel"
                    value={form.phone}
                    onChange={(e) => set('phone', e.target.value)}
                    autoComplete="tel"
                  />
                </Field>
                <Field label="Email" error={errors.email}>
                  <input
                    className="field"
                    placeholder="you@email.com"
                    type="email"
                    value={form.email}
                    onChange={(e) => set('email', e.target.value)}
                    autoComplete="email"
                  />
                </Field>
                <Field label="Special requests" className="sm:col-span-2">
                  <textarea
                    className="field min-h-[110px] resize-y"
                    placeholder="Bringing pets, celebrating a birthday, need extra bedding, arriving late…"
                    value={form.special_requests}
                    onChange={(e) => set('special_requests', e.target.value)}
                  />
                </Field>
              </div>
            </div>

            {availability && !availability.available && (
              <div className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-900 leading-relaxed">
                <strong>Those dates are already held.</strong>{' '}
                {availability.heldBy === 1
                  ? 'Another Booking is holding them'
                  : `${availability.heldBy} Bookings are holding them`}{' '}
                — a hold lasts 24 hours while the Hacienda reviews, so pick different dates and your request
                will go straight through.
              </div>
            )}

            <label className="flex items-start gap-2 text-xs text-forest-800" data-tour="terms">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
              />
              <span>
                I have read and accept the{' '}
                <Link to="/legal" className="underline underline-offset-2">
                  Terms and Conditions, Privacy Policy, booking, cancellation, payment and smart-lock rules
                </Link>{' '}
                (version {LEGAL_VERSION}). This is not accepted for me.
              </span>
            </label>
            {errors.special_requests && !form.special_requests && (
              <p className="text-xs text-red-600">{errors.special_requests}</p>
            )}

            <div className="pt-2">
              <button
                type="submit"
                disabled={status === 'submitting' || (availability !== null && !availability.available)}
                className="btn-primary w-full sm:w-auto disabled:opacity-70 disabled:cursor-not-allowed"
                data-tour="submit-booking"
              >
                {status === 'submitting' ? 'Sending…' : 'Send Booking Request'}
                {status !== 'submitting' && <ArrowRight size={16} />}
              </button>
              <p className="text-xs text-forest-700/60 mt-4 max-w-md">
                By sending a request you agree to be contacted by the Hacienda to confirm availability
                and finalize your stay. No payment is taken at this step.
              </p>
            </div>
          </form>

          <aside className="lg:sticky lg:top-28 self-start">
            <div className="rounded-[28px] overflow-hidden border border-forest-900/5 shadow-depth bg-white">
              <div className="relative">
                <SmartImage
                  src={selectedAcc?.images[0] || '/images/gmaps/img-07.jpg'}
                  alt={selectedAcc?.name || 'Hacienda'}
                  className="w-full h-44 lg:h-52 object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-forest-950/75 via-forest-950/20 to-transparent" />
                <div className="absolute bottom-4 left-5 right-5 text-cream-50">
                  <div className="text-[10px] uppercase tracking-eyebrow opacity-80">Your stay at a glance</div>
                  <div className="font-serif text-2xl leading-tight">{selectedAcc?.name || 'Ask Us'}</div>
                  <div className="mt-1 text-[11px] text-cream-100/80">{BUSINESS.address.city}, {BUSINESS.address.region}</div>
                </div>
              </div>
              <div className="p-6 space-y-4">
                <SummaryRow icon={Calendar} label="Check-in" value={form.check_in || '—'} />
                <SummaryRow icon={Calendar} label="Check-out" value={form.check_out || '—'} />
                <SummaryRow icon={Users} label="Guests" value={String(form.guests)} />
                <SummaryRow icon={Bed} label="Accommodation" value={OPTIONS.find(o => o.id === form.accommodation)?.label || '—'} />

                <div className="pt-4 border-t border-forest-900/10">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] uppercase tracking-eyebrow text-forest-600">Estimated Total</div>
                    <div className="text-right">
                      {estimatedTotal ? (
                        <>
                          <div className="font-serif text-2xl text-forest-900">₱{estimatedTotal.toLocaleString('en-PH')}</div>
                          <div className="text-[11px] text-forest-700/60">
                            {nights} night{nights > 1 ? 's' : ''} × {rate?.label}
                          </div>
                        </>
                      ) : (
                        <div className="text-sm text-forest-800/70">Quoted by the Hacienda</div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl bg-cream-100/70 p-4 text-xs text-forest-700 leading-relaxed">
                  <Sparkle size={14} className="inline mr-1 -mt-1 text-forest-600" />
                  {estimatedTotal
                    ? 'An estimate of the stay only. The refundable security deposit is added at the payment step, extras such as the ₱300 pet fee are settled with the Hacienda, and the final quote is confirmed before anything is reserved.'
                    : 'The Hacienda quotes this stay on request and confirms the final figure — plus the refundable security deposit — before anything is reserved.'}{' '}
                  <Link to="/#rates" className="underline underline-offset-2">Rates &amp; Fees</Link>
                </div>
              </div>
            </div>

            <div className="mt-6">
              <OfficialChannelsNotice compact />
            </div>

            <div className="mt-6 bg-forest-900 text-cream-100 rounded-[28px] p-6">
              <div className="eyebrow text-cream-100/60">Prefer to Chat?</div>
              <div className="mt-3 space-y-3 text-sm">
                <a href={`tel:${BUSINESS.contact.phone.replace(/\s+/g,'')}`} className="flex items-center gap-3 hover:underline">
                  <Phone size={16} /> {BUSINESS.contact.phoneDisplay}
                </a>
                <a href={BUSINESS.contact.directions} target="_blank" rel="noreferrer" className="flex items-center gap-3 hover:underline">
                  <MapPin size={16} /> Get directions
                </a>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}

function Field({
  label, error, className = '', tour, children,
}: {
  label: string
  error?: string
  className?: string
  /** Optional tour anchor (data-tour) for the interactive Guest tutorial. */
  tour?: string
  children: React.ReactNode
}) {
  return (
    <label className={`block ${className}`} data-tour={tour}>
      <span className="label">{label}</span>
      {children}
      {error && <span className="mt-1.5 block text-xs text-red-600">{error}</span>}
    </label>
  )
}

function SummaryRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="inline-flex items-center gap-2 text-forest-700">
        <Icon size={15} className="text-forest-600" /> {label}
      </span>
      <span className="text-forest-900 font-medium text-right">{value}</span>
    </div>
  )
}

function SuccessScreen({
  bookingId,
  reference,
  booking,
  onNew,
  storage,
  checkIn,
  checkOut,
  guests,
  accommodationName,
}: {
  bookingId: string
  reference: string
  booking: Booking | null
  onNew: () => void
  /**
   * Where the request went. 'cloud' means Firestore holds it and the Admin app
   * reads it. 'local' means this browser holds it and the Hacienda has not been
   * told — whether because the build has no Firebase or because the write was
   * refused — and the screen says so, with a way to reach the Hacienda.
   */
  storage: 'cloud' | 'local'
  checkIn?: string
  checkOut?: string
  guests?: number
  accommodationName?: string
}) {
  void bookingId
  const delivered = storage === 'cloud'

  return (
    <div className="pt-28 pb-24 bg-cream-50 min-h-screen">
      <div className="mx-auto max-w-3xl px-5 lg:px-8">
        <div
          className="bg-white rounded-[28px] border border-forest-900/5 shadow-card p-8 sm:p-12 text-center"
          data-tour="booking-success"
        >
          <div
            className={`mx-auto w-16 h-16 rounded-full flex items-center justify-center ${
              delivered ? 'bg-forest-100 text-forest-700' : 'bg-amber-100 text-amber-700'
            }`}
          >
            <Sparkle size={26} />
          </div>
          <div className="eyebrow mt-6">
            {delivered ? 'Request Received & Sent to App' : 'Request Received & Saved on This Device'}
          </div>
          <h1 className="display text-4xl sm:text-5xl mt-3 text-forest-900">Salamat!</h1>
          {delivered ? (
            <p className="mt-4 text-forest-800/80 leading-relaxed max-w-lg mx-auto">
              Matagumpay na naipadala ang iyong booking request diretso sa <strong>Client App</strong> ng Hacienda de LuisAna para sa kumpirmasyon.
            </p>
          ) : (
            <p className="mt-4 text-forest-800/80 leading-relaxed max-w-lg mx-auto">
              Naka-save ang iyong booking request sa browser na ito, pero <strong>hindi ito naipadala sa Hacienda</strong>.
              I-message o tawagan kami para ma-hold ang iyong dates.
            </p>
          )}
          <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-forest-50 border border-forest-100 text-forest-800 px-4 py-2 text-xs">
            Reference Number: <span className="font-mono font-bold text-forest-900">{reference}</span>
          </div>

          {booking && (
            <div className="mt-6 text-left">
              <HoldCountdown booking={booking} />
            </div>
          )}

          {/* Step 2 — the ID goes with the request, not in a separate visit (#13) */}
          {booking && (
            <div className="mt-3 text-left">
              <KycUpload booking={booking} />
            </div>
          )}

          {checkIn && checkOut && (
            <div className="mt-6 rounded-2xl bg-cream-50 border border-forest-900/5 p-4 text-left grid sm:grid-cols-3 gap-3 text-xs">
              <div>
                <span className="text-forest-600 block uppercase tracking-eyebrow text-[10px]">Stay Duration</span>
                <span className="font-serif text-sm text-forest-900 font-semibold">
                  {(() => {
                    const nights = Math.max(1, Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / (1000 * 60 * 60 * 24)))
                    return `${nights + 1} Days · ${nights} Night${nights > 1 ? 's' : ''}`
                  })()}
                </span>
              </div>
              <div>
                <span className="text-forest-600 block uppercase tracking-eyebrow text-[10px]">Dates</span>
                <span className="font-medium text-forest-900">{checkIn} → {checkOut}</span>
              </div>
              <div>
                <span className="text-forest-600 block uppercase tracking-eyebrow text-[10px]">Accommodation</span>
                <span className="font-medium text-forest-900 truncate block">{accommodationName || 'Hacienda'}</span>
              </div>
            </div>
          )}

          {delivered ? (
            <div className="mt-3 text-xs text-forest-600">
              ✓ Real-time synced to the Admin app via Firebase Cloud
            </div>
          ) : (
            <div className="mt-6 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-left text-xs text-amber-900 leading-relaxed">
              <strong>Hindi ito naipadala sa Admin app.</strong> Naka-save lang ang request na ito sa
              browser na ito, kaya i-message o tawagan kami para ma-hold ang iyong dates — sabihin ang
              reference number na <span className="font-mono font-bold">{reference}</span>.
              <div className="mt-3 flex flex-wrap gap-3">
                <a
                  href={BUSINESS.contact.messenger}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-primary text-[11px]"
                >
                  Message us
                </a>
                <a href={`tel:${BUSINESS.contact.phone.replace(/\s/g, '')}`} className="btn-ghost text-[11px]">
                  {BUSINESS.contact.phoneDisplay}
                </a>
              </div>
            </div>
          )}

          {/* Access — the credential, never the Guest's position */}
          <div className="mt-8 rounded-3xl bg-forest-900 text-cream-50 p-6 sm:p-7 text-left relative overflow-hidden">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] uppercase tracking-eyebrow text-cream-100/60 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                RFID / Mobile Key Access
              </div>
              <span className="text-[11px] text-emerald-300 bg-emerald-950/60 border border-emerald-500/30 px-2.5 py-0.5 rounded-full">
                Nakatala ang bawat pag-unlock (granted / denied)
              </span>
            </div>

            <h3 className="font-serif text-xl sm:text-2xl text-cream-50 mt-2">
              RFID or Mobile Key on stay dates
            </h3>
            <p className="mt-1 text-xs sm:text-sm text-cream-100/75 leading-relaxed">
              After payment is verified, unlock with your credential. Access attempts are logged.
              We do not collect live GPS location.
            </p>
          </div>

          <div className="mt-8 flex flex-wrap gap-3 justify-center">
            <Link to="/" className="btn-ghost">Bumalik sa Home</Link>
            <a href={BUSINESS.contact.messenger} target="_blank" rel="noreferrer" className="btn-primary">
              I-message si Client <ArrowRight size={16} />
            </a>
            <button onClick={onNew} className="btn bg-transparent text-forest-800 underline underline-offset-4">
              Magpadala ng isa pang booking
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
