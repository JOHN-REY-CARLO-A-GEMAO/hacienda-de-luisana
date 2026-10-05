import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, Link, useNavigate } from 'react-router-dom'
import { ACCOMMODATIONS, BUSINESS } from '../config/site'
import { cloudBookingsDB } from '../lib/firestoreBookings'
import { saveBookingDraft } from '../lib/bookingDraft'
import { FlowSteps } from '../components/Booking/FlowSteps'
import { isFirebaseConfigured } from '../lib/firebase'
import { Calendar, Users, Bed, ArrowRight, Sparkle, MapPin, Phone } from '../lib/icons'
import { SmartImage } from '../components/SmartImage'
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
import { OfficialChannelsNotice } from '../components/OfficialChannelsNotice'
import { useBookingPolicy } from '../hooks/useBookingPolicy'
import { quoteAccommodation, validateMinimumBookingLeadTime } from '../lib/booking'

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

export function BookingPage() {
  const { user } = useAuth()
  const { minimumBookingLeadTimeDays, earliestCheckIn } = useBookingPolicy()
  const navigate = useNavigate()
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
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string>('')
  // G2: availability is checked by the system before the Guest commits, not
  // only in the Admin's head at approval time (ticket #12).
  const [availability, setAvailability] = useState<{ available: boolean; heldBy: number } | null>(null)
  const [acceptedTerms, setAcceptedTerms] = useState(false)

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
  const options = useMemo(() => ACCOMMODATIONS
    .filter((a) => a.active && published?.accommodations[a.id]?.active !== false)
    .map((a) => ({
      id: a.id,
      label: published?.accommodations[a.id]?.property_name?.trim() || a.name,
    })), [published])
  const authoritativeQuote = useMemo(() => {
    if (!published) return undefined
    return quoteAccommodation(published, form.accommodation, {
      check_in: form.check_in,
      check_out: form.check_out,
      guests: Number(form.guests),
    })
  }, [published, form.accommodation, form.check_in, form.check_out, form.guests])
  const estimatedTotal = authoritativeQuote?.stayTotal ?? null

  useEffect(() => {
    if (!form.check_in || !form.check_out || !form.accommodation
        || !validateMinimumBookingLeadTime(form.check_in, new Date(), minimumBookingLeadTimeDays).ok) {
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
  }, [form.check_in, form.check_out, form.accommodation, nights, minimumBookingLeadTimeDays, earliestCheckIn])

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors((e) => ({ ...e, [k]: undefined }))
  }

  const validate = (): boolean => {
    const e: Errors = {}
    const leadTime = validateMinimumBookingLeadTime(form.check_in, new Date(), minimumBookingLeadTimeDays)
    if (!leadTime.ok) e.check_in = leadTime.reason
    const stay = validateStayDates(form.check_in, form.check_out)
    if (!stay.ok && !e[stay.field]) e[stay.field] = stay.message
    const guests = guestCountValid(Number(form.guests), selectedAcc?.capacity)
    if (!guests.ok) e.guests = guests.message
    if (!form.accommodation) e.accommodation = 'Select an accommodation'
    else if (!published) {
      e.accommodation = 'The Admin must publish the current guest-count rates before online booking can accept payment.'
    }
    if (published?.accommodations[form.accommodation]?.active === false) {
      e.accommodation = 'This property is not accepting new bookings.'
    }
    const configuredRate = published?.accommodations[form.accommodation]
    if (published && !configuredRate) {
      e.accommodation = 'This property does not have a published guest-count rate.'
    }
    if (configuredRate && !authoritativeQuote) {
      e.accommodation = nights !== 1
        ? 'Published guest-count rates support one 22-hour standard stay. Contact the Hacienda for a longer stay.'
        : 'The selected guest count is outside this property’s published rate rules.'
    }
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
    setStatus('idle')
    setErrorMsg('')
    // The form does not create a Booking. The downpayment screenshot is
    // mandatory, and the Booking is born Pending only after that upload.
    saveBookingDraft({
      check_in: form.check_in,
      check_out: form.check_out,
      guests: Number(form.guests),
      accommodation: form.accommodation,
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      special_requests: form.special_requests.trim(),
    })
    navigate('/book/pay')
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
            <div className="eyebrow">Book a room · no account needed</div>
          </div>
          <h1 className="display text-4xl sm:text-5xl lg:text-6xl mt-5 text-forest-900">
            Plan Your Stay
          </h1>
          <p className="mt-5 text-forest-800/80 leading-relaxed">
            Browse every room, then book it here — no login and no account. After these details
            you will upload a screenshot of your downpayment. The booking is not submitted, and
            not confirmed, until that proof is in and the Hacienda approves it.
          </p>
          <FlowSteps current={0} />
          {!isFirebaseConfigured && (
            <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800">
              <strong>Demo mode:</strong> Firebase is not configured in this build. A submitted booking is
              stored in this browser, and you can approve or reject it from the review desk.{' '}
              <Link to="/status" className="underline">Deployment status</Link>
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
              <p id="booking-lead-time" className="mt-2 text-sm text-forest-700">
                Book at least {minimumBookingLeadTimeDays} days before check-in.
                Earliest check-in: {earliestCheckIn} (Philippine time).
              </p>
              <div className="mt-6 grid sm:grid-cols-2 gap-5" data-tour="stay-details">
                <Field label="Check-in" error={errors.check_in}>
                  <input
                    type="date"
                    className="field"
                    min={earliestCheckIn}
                    aria-describedby="booking-lead-time"
                    value={form.check_in}
                    data-tour-field="check-in"
                    onChange={(e) => set('check_in', e.target.value)}
                  />
                </Field>
                <Field label="Check-out" error={errors.check_out}>
                  <input
                    type="date"
                    className="field"
                    min={form.check_in >= earliestCheckIn ? form.check_in : earliestCheckIn}
                    value={form.check_out}
                    data-tour-field="check-out"
                    onChange={(e) => set('check_out', e.target.value)}
                  />
                </Field>
                <Field label="Number of guests" error={errors.guests}>
                  <input
                    type="number"
                    min={1}
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
                    {options.map((o) => (
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
                    placeholder="Pet count; reunion/team building; wedding preparation; shoot; bonfire wood; late-checkout request…"
                    value={form.special_requests}
                    onChange={(e) => set('special_requests', e.target.value)}
                  />
                  <p className="mt-2 text-xs text-forest-700/70 leading-relaxed">
                    Declare each pet (₱300 per pet for sanitation). Bonfire wood (₱150/set), approved late checkout (₱250/hour after noon), and special-event/use charges are reviewed by the Admin and are never added automatically.
                  </p>
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
                Continue to downpayment
                <ArrowRight size={16} />
              </button>
              <p className="text-xs text-forest-700/60 mt-4 max-w-md">
                This step does not create a booking. The next page asks for a downpayment screenshot,
                which is required before the booking can be submitted as Pending.
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
                  <div className="font-serif text-2xl leading-tight">{selectedAcc?.name || '—'}</div>
                  <div className="mt-1 text-[11px] text-cream-100/80">{BUSINESS.address.city}, {BUSINESS.address.region}</div>
                </div>
              </div>
              <div className="p-6 space-y-4">
                <SummaryRow icon={Calendar} label="Check-in" value={form.check_in || '—'} />
                <SummaryRow icon={Calendar} label="Check-out" value={form.check_out || '—'} />
                <SummaryRow icon={Users} label="Guests" value={String(form.guests)} />
                <SummaryRow icon={Bed} label="Accommodation" value={options.find((o) => o.id === form.accommodation)?.label || '—'} />

                <div className="pt-4 border-t border-forest-900/10">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] uppercase tracking-eyebrow text-forest-600">Estimated Total</div>
                    <div className="text-right">
                      {estimatedTotal ? (
                        <>
                          <div className="font-serif text-2xl text-forest-900">₱{estimatedTotal.toLocaleString('en-PH')}</div>
                          <div className="text-[11px] text-forest-700/60">
                            {authoritativeQuote
                              ? `${authoritativeQuote.classification === 'weekend_holiday' ? 'Weekend / Admin holiday (Friday/Saturday check-in night)' : 'Weekday (Sunday–Thursday check-in night)'} · ${authoritativeQuote.bracket} · 2:00 PM–12:00 noon`
                              : 'Uses the published schedule for the selected dates and guest count'}
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
