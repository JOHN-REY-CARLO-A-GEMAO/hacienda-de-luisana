import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, Link, useNavigate, useLocation } from 'react-router-dom'
import { ACCOMMODATIONS, BUSINESS } from '../config/site'
import { cloudBookingsDB } from '../lib/firestoreBookings'
import { loadBookingDraft, loadBookingProgress, saveBookingDraft, saveBookingProgress } from '../lib/bookingDraft'
import { formatStayDate } from '../lib/formatDate'
import { FlowSteps } from '../components/Booking/FlowSteps'
import { AvailabilityCalendar } from '../components/Booking/AvailabilityCalendar'
import { isFirebaseConfigured } from '../lib/firebase'
import { Calendar, Users, Bed, ArrowRight, Sparkle, MapPin, Phone } from '../lib/icons'
import { SmartImage } from '../components/SmartImage'
import { useAuth } from '../hooks/useAuth'
import {
  composeFullName,
  guestCountValid,
  validateEmail,
  validateName,
  validatePhMobile,
  validateStayDates,
} from '../lib/validation'
import { LIMITS, checkRateLimit } from '../lib/rateLimit'
import { LEGAL_VERSION } from '../lib/legal'
import { MAX_STAY_NIGHTS } from '../lib/booking'
import { usePublishedRates } from '../hooks/usePublishedRates'
import { OfficialChannelsNotice } from '../components/OfficialChannelsNotice'
import { useBookingPolicy } from '../hooks/useBookingPolicy'
import { doc, setDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import {
  addonFeeLines,
  formatRefundPolicySummary,
  pricedStayExtras,
  quoteAccommodation,
  validateBookingSelection,
  validateMinimumBookingLeadTime,
  type BookingRuleFailure,
  type EventPurpose,
} from '../lib/booking'
import { officialAddonFallbacks } from '../lib/stayRequests'
import { StayRequestsSection, AddonFeeSummary } from '../components/Booking/StayRequestsSection'
import { guestFacingErrorMessage } from '../lib/firebaseFailure'
import { Alert, CheckboxRow, Container, Field, Input, Page, PageHeader, Select } from '../components/ui'

type FormState = {
  check_in: string
  check_out: string
  guests: number
  accommodation: string
  name: string
  phone: string
  email: string
  /** The Guest's free text for anything the structured controls do not cover. */
  special_requests: string
  // Structured add-ons & requests (src/lib/booking/requests.ts).
  pet_count: number
  bonfire_wood_sets: number
  late_checkout_hours: number
  event_purpose: EventPurpose | ''
  event_purpose_detail: string
}

type Errors = Partial<Record<keyof FormState, string>>

export function BookingPage() {
  const { user, profile, loading: authLoading } = useAuth()
  const location = useLocation()
  const sessionNotice = (location.state as { notice?: string } | null)?.notice ?? ''
  const { minimumBookingLeadTimeDays, earliestCheckIn } = useBookingPolicy()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  // Returning from payment must not erase the stay or contact details. The
  // draft remains session-only and is still submitted through the same fresh
  // availability, rate and server checks below.
  const restoredDraft = useMemo(() => loadBookingDraft() ?? loadBookingProgress(), [])
  const requestedAccommodation = params.get('accommodation')
  // A link for a different property starts that property's stay rather than
  // silently combining it with an older draft. The payment page's Back link
  // requests the same property, so all of its details are restored.
  const draftToRestore = restoredDraft && (!requestedAccommodation || requestedAccommodation === restoredDraft.accommodation)
    ? restoredDraft
    : null
  const initialAccommodation = requestedAccommodation || draftToRestore?.accommodation || ACCOMMODATIONS[0].id

  const [form, setForm] = useState<FormState>({
    check_in: draftToRestore?.check_in ?? '',
    check_out: draftToRestore?.check_out ?? '',
    guests: draftToRestore?.guests ?? 2,
    accommodation: initialAccommodation,
    name: draftToRestore?.name ?? '',
    phone: draftToRestore?.phone ?? '',
    email: draftToRestore?.email ?? '',
    special_requests: draftToRestore?.special_requests ?? '',
    pet_count: draftToRestore?.pet_count ?? 0,
    bonfire_wood_sets: draftToRestore?.bonfire_wood_sets ?? 0,
    late_checkout_hours: draftToRestore?.late_checkout_hours ?? 0,
    event_purpose: draftToRestore?.event_purpose ?? '',
    event_purpose_detail: draftToRestore?.event_purpose_detail ?? '',
  })
  const [errors, setErrors] = useState<Errors>({})
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string>('')
  // G2: availability is checked by the system before the Guest commits, not
  // only in the Admin's head at approval time (ticket #12). Unknown and loading
  // are explicit non-available states; neither may quietly look green.
  const [availability, setAvailability] = useState<{
    status: 'checking' | 'available' | 'unavailable' | 'unknown'
    available: boolean
    heldBy: number
    blockingState?: 'pending' | 'booked' | 'unknown'
  } | null>(null)
  const [availabilityRetry, setAvailabilityRetry] = useState(0)
  const [calendarState, setCalendarState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [calendarNotice, setCalendarNotice] = useState('')
  const [acceptedTerms, setAcceptedTerms] = useState(false)

  // A signed-in Guest does not type their own details again. Filled once the
  // account has finished loading (so the Profile is there, not just the sign-in),
  // and only into fields they have left empty: a name they are typing is theirs.
  // The name is always First + Middle + Last, the same way the account shows it.
  const prefilled = useRef(false)
  const [usedAccount, setUsedAccount] = useState(false)
  useEffect(() => {
    if (prefilled.current || authLoading || !user || user.isAnonymous) return
    prefilled.current = true
    const fullProfileName =
      composeFullName({ first: profile?.first_name, middle: profile?.middle_name, last: profile?.last_name }) ||
      profile?.display_name ||
      user.displayName ||
      ''
    const next = {
      name: fullProfileName,
      email: profile?.email || user.email || '',
      phone: profile?.phone || '',
    }
    setForm((current) => ({
      ...current,
      name: current.name || next.name,
      email: current.email || next.email,
      phone: current.phone || next.phone,
    }))
    setUsedAccount(Boolean(next.name || next.email || next.phone))
  }, [user, profile, authLoading])

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

  // The estimate uses the Admin's published rates; no figure is invented
  // when the dates, guest count or rate document cannot be priced.
  const published = usePublishedRates()
  const options = useMemo(() => ACCOMMODATIONS
    .filter((a) => a.active && published?.accommodations[a.id]?.active !== false)
    .map((a) => ({
      id: a.id,
      label: published?.accommodations[a.id]?.property_name?.trim() || a.name,
    })), [published])

  const restoredSelectionPending = useRef(Boolean(draftToRestore))
  useEffect(() => {
    if (!form.accommodation || options.length === 0 || options.some((o) => o.id === form.accommodation)) return
    if (restoredSelectionPending.current) {
      // Never silently substitute a different room for a restored stay.
      restoredSelectionPending.current = false
      setForm((current) => ({ ...current, accommodation: '' }))
      setErrors((current) => ({
        ...current,
        accommodation: 'Hindi na available ang dating matutuluyan. Pumili muli; mananatili ang iba mong detalye.',
      }))
      return
    }
    setForm((current) => ({ ...current, accommodation: options[0].id }))
  }, [options, form.accommodation])
  const authoritativeQuote = useMemo(() => {
    if (!published) return undefined
    return quoteAccommodation(published, form.accommodation, {
      check_in: form.check_in,
      check_out: form.check_out,
      guests: Number(form.guests),
      // Only the add-ons the Admin has priced reach the quote; requests with no
      // published figure stay out of the total and go to the Admin for review.
      ...pricedStayExtras(published, form),
    })
  }, [published, form.accommodation, form.check_in, form.check_out, form.guests,
      form.pet_count, form.late_checkout_hours])
  const estimatedTotal = authoritativeQuote?.stayTotal ?? null

  /**
   * Whether the calendar may offer this range as a stay: dates, the booking lead
   * time, and the shared 1–20 night length rule. Nothing else.
   *
   * Deliberately NOT `validateBookingSelection`. That is the pricing/eligibility
   * preflight — guest-count tiers, published figures, addons — and it is run
   * before payment, not when a date is merely picked. Letting a *pricing* rule
   * decide which dates can be picked made the calendar force
   * checkout = check-in + 1, which is a date-range question, not a price
   * question. Pricing stays enforced where it belongs: before payment and again
   * inside `submitBooking`.
   */
  const validateStayRange = useCallback((checkIn: string, checkOut: string) => {
    const leadTime = validateMinimumBookingLeadTime(checkIn, new Date(), minimumBookingLeadTimeDays)
    if (!leadTime.ok) return { ok: false, reason: leadTime.reason }
    const stay = validateStayDates(checkIn, checkOut)
    return stay.ok ? { ok: true } : { ok: false, reason: stay.message }
  }, [minimumBookingLeadTimeDays])

  // The live fee breakdown: documented peso figures (officialBusiness.ts) under
  // whatever the Admin has published, recomputed the moment a control changes.
  const addonFallbacks = useMemo(() => officialAddonFallbacks(published), [published])
  const addonLines = useMemo(
    () => addonFeeLines(published, form, addonFallbacks),
    [published, addonFallbacks, form.pet_count, form.bonfire_wood_sets, form.late_checkout_hours],
  )

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
    setAvailability({ status: 'checking', available: false, heldBy: 0 })
    cloudBookingsDB
      .checkAvailability({
        accommodation: form.accommodation,
        check_in: form.check_in,
        check_out: form.check_out,
      })
      .then((result) => {
        if (alive) setAvailability({
          status: result.available ? 'available' : result.blockingState === 'unknown' ? 'unknown' : 'unavailable',
          available: result.available,
          heldBy: result.conflicts.length,
          ...(result.blockingState ? { blockingState: result.blockingState } : {}),
        })
      })
      .catch(() => {
        // Fail closed. The calendar and Continue button say that availability is
        // unknown; only a successful fresh server response may say "available".
        if (alive) setAvailability({ status: 'unknown', available: false, heldBy: 0, blockingState: 'unknown' })
      })
    return () => {
      alive = false
    }
  }, [form.check_in, form.check_out, form.accommodation, nights, minimumBookingLeadTimeDays, earliestCheckIn, availabilityRetry])

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors((e) => ({ ...e, [k]: undefined }))
  }

  const validateSingleField = (key: keyof FormState): string | undefined => {
    if (key === 'check_in') {
      const leadTime = validateMinimumBookingLeadTime(form.check_in, new Date(), minimumBookingLeadTimeDays)
      if (!leadTime.ok) return leadTime.reason
      const stay = validateStayDates(form.check_in, form.check_out)
      if (!stay.ok && stay.field === 'check_in') return stay.message
    }
    if (key === 'check_out') {
      const stay = validateStayDates(form.check_in, form.check_out)
      if (!stay.ok && stay.field === 'check_out') return stay.message
    }
    if (key === 'guests') {
      const guests = guestCountValid(Number(form.guests), selectedAcc?.capacity, selectedAcc?.name)
      if (!guests.ok) return guests.message
    }
    if (key === 'accommodation') {
      if (!form.accommodation) return 'Select an accommodation'
      if (published?.accommodations[form.accommodation]?.active === false) {
        return 'This property is not accepting new bookings.'
      }
    }
    if (key === 'name') {
      const name = validateName(form.name)
      if (!name.ok) return name.message
    }
    if (key === 'phone') {
      const phone = validatePhMobile(form.phone)
      if (!phone.ok) return phone.message
    }
    if (key === 'email') {
      const email = validateEmail(form.email)
      if (!email.ok) return email.message
    }
    return undefined
  }

  const handleBlur = (key: keyof FormState) => {
    const err = validateSingleField(key)
    setErrors((e) => ({ ...e, [key]: err }))
  }

  const validate = (): boolean => {
    const e: Errors = {}
    const leadTime = validateMinimumBookingLeadTime(form.check_in, new Date(), minimumBookingLeadTimeDays)
    if (!leadTime.ok) e.check_in = leadTime.reason
    const stay = validateStayDates(form.check_in, form.check_out)
    if (!stay.ok && !e[stay.field]) e[stay.field] = stay.message
    const guests = guestCountValid(Number(form.guests), selectedAcc?.capacity, selectedAcc?.name)
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
      // The stay length (1–20 nights) is a date-range question the calendar
      // already answers; what reaches this branch is a pricing problem — the
      // guest count outside the published tiers, or an extra without a
      // published figure. Say so on the field the Guest can fix.
      e.accommodation = 'The selected guest count is outside this property’s published rate rules.'
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

    // A successful synchronous form check is not enough to open the payment
    // step. The policy document may have changed since the page mounted, and a
    // rate/availability read may have completed for an older selection. Keep the
    // rule failure attached to the field where the Guest can fix it instead of
    // letting /book/pay discover it after a screenshot has been uploaded.
    let stopped = false
    const failRule = (rule: BookingRuleFailure) => {
      stopped = true
      const field = rule.field === 'check_in' || rule.field === 'check_out' || rule.field === 'guests' || rule.field === 'accommodation'
        ? rule.field
        : undefined
      if (field) setErrors((current) => ({ ...current, [field]: rule.message }))
      setStatus('error')
      setErrorMsg(rule.message)
    }

    setStatus('submitting')
    setErrorMsg('')
    try {
      // This is a server-backed read in cloud mode. The native `min` and the
      // hook subscription are useful UX, but neither is authoritative after a
      // tab has been left open or the Admin has changed the policy.
      const currentDates = await cloudBookingsDB.validateGuestCheckIn(form.check_in)
      if (!currentDates.ok) {
        failRule({ code: currentDates.code, message: currentDates.reason, field: 'check_in' })
        return
      }

      const rules = validateBookingSelection(
        {
          accommodation: form.accommodation,
          check_in: form.check_in,
          check_out: form.check_out,
          guests: Number(form.guests),
          pet_count: form.pet_count,
          bonfire_wood_sets: form.bonfire_wood_sets,
          late_checkout_hours: form.late_checkout_hours,
        },
        {
          published,
          minimumBookingLeadTimeDays,
          // The fresh check above supplies the current policy boundary. The pure
          // validator still checks dates, stay length, property and rates here.
          checkLeadTime: false,
        },
      )
      if (!rules.ok) {
        failRule(rules.failure)
        return
      }

      // Always perform one fresh availability read at the gate. Demo mode can
      // report the actual holding Booking; cloud mode returns only its aggregate
      // state because Guests cannot read another Guest's private Booking. The
      // later `submitBooking` transaction is still the final last-unit boundary.
      const currentAvailability = await cloudBookingsDB.checkAvailability({
        accommodation: form.accommodation,
        check_in: form.check_in,
        check_out: form.check_out,
      })
      if (!currentAvailability.available) {
        setAvailability({
          status: currentAvailability.blockingState === 'unknown' ? 'unknown' : 'unavailable',
          available: false,
          heldBy: currentAvailability.conflicts.length,
          ...(currentAvailability.blockingState ? { blockingState: currentAvailability.blockingState } : {}),
        })
        failRule({
          code: 'DATE_UNAVAILABLE',
          message: currentAvailability.blockingState === 'unknown'
            ? 'Availability could not be checked. Please retry the selected stay before continuing.'
            : currentAvailability.conflicts.length > 0
            ? `${currentAvailability.conflicts.length === 1 ? 'Those dates are already held by another Booking' : 'Those dates are already held by other Bookings'} for ${selectedAcc?.name || 'this property'}. Please choose different dates before continuing.`
            : `Those dates are no longer available for ${selectedAcc?.name || 'this property'}. Please choose different dates before continuing.`,
        })
        return
      }

      const limited = checkRateLimit('booking:create', LIMITS.booking)
      if (!limited.ok) {
        stopped = true
        setStatus('error')
        setErrorMsg(limited.message)
        return
      }

      // The form does not create a Booking. The downpayment screenshot is
      // mandatory, and the Booking is born Pending only after that upload.
      // If user is signed in and phone was entered, sync to profile if missing
      if (user?.uid && form.phone && db) {
        try {
          const profileRef = doc(db, 'profiles', user.uid)
          await setDoc(
            profileRef,
            { phone: form.phone.trim(), updated_at: new Date().toISOString() },
            { merge: true }
          )
        } catch (_) {}
      }

      saveBookingDraft({
        check_in: form.check_in,
        check_out: form.check_out,
        guests: Number(form.guests),
        accommodation: form.accommodation,
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        special_requests: form.special_requests.trim(),
        pet_count: form.pet_count,
        bonfire_wood_sets: form.bonfire_wood_sets,
        late_checkout_hours: form.late_checkout_hours,
        event_purpose: form.event_purpose,
        ...(form.event_purpose === 'other' && form.event_purpose_detail.trim()
          ? { event_purpose_detail: form.event_purpose_detail.trim() }
          : {}),
      })
      navigate('/book/pay')
    } catch (err) {
      stopped = true
      setStatus('error')
      console.error('[BookingCheck] Error checking booking rules:', err)
      setErrorMsg(guestFacingErrorMessage(err, 'Booking rules could not be checked right now. Please try again.'))
    } finally {
      if (!stopped) setStatus('idle')
    }
  }

  return (
    <Page className="booking-page relative dark:bg-forest-950 dark:text-cream-50">
      {/* Visual shell only — soft countryside wash behind the form; the form itself is untouched */}
      <div
        className="pointer-events-none absolute -top-32 right-[-10%] h-[560px] w-[560px] rounded-full opacity-70 blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(198,214,193,0.6), transparent 65%)' }}
        aria-hidden="true"
      />
      <Container width="wide" className="relative">
        <PageHeader
          eyebrow="Mag-book ng Matutuluyan · Hindi kailangan ng account"
          title="Plan Your Stay"
          lead={
            <p className="max-w-3xl">
              Sundan ang pitong hakbang sa ibaba. Pagkatapos ng detalye, mag-a-upload ka ng patunay ng
              downpayment. <strong>Hindi pa kumpirmado ang booking</strong> hangga’t hindi ito naisusumite
              at ina-aprubahan ng Hacienda. Maaari kang bumalik upang ayusin ang detalye nang hindi nawawala
              ang iyong isinulat.
            </p>
          }
        />
        <div className="mt-6 max-w-6xl">
          <FlowSteps
            current={0}
            completedThrough={-1}
            summary="Hakbang 1–4 sa 7: piliin ang matutuluyan at petsa, tingnan ang availability at presyo, at suriin ang detalye."
          />
          {draftToRestore && (
            <Alert tone="info" className="mt-4">
              <strong>Naibalik ang iyong booking details.</strong> Suriin ang petsa, presyo at availability
              bago magpatuloy sa bayad.
            </Alert>
          )}
          {!isFirebaseConfigured && (
            <Alert tone="warning" className="mt-4 text-base">
              <strong>Demo mode:</strong> Firebase is not configured in this build. A submitted booking is
              stored in this browser, and you can approve or reject it from the review desk.{' '}
              <Link to="/status" className="text-link">
                Deployment status
              </Link>
            </Alert>
          )}
          {cloudBookingsDB.isCloud && (
            <Alert tone="success" className="mt-4 text-base">
              Secured by Firebase — your request will be saved to the cloud and the Admin will see it in
              the Hacienda app.
            </Alert>
          )}
        </div>

        <div className="mt-12 grid lg:grid-cols-3 gap-8 lg:gap-10">
          <form
            onSubmit={onSubmit}
            noValidate
            className="booking-light-surface card space-y-8 p-6 sm:p-8 lg:col-span-2 lg:p-10"
          >
            {sessionNotice && <Alert tone="warning">{sessionNotice}</Alert>}
            {status === 'error' && <Alert tone="danger">{errorMsg}</Alert>}

            <div>
              <h2 className="h2">Detalye ng Stay</h2>
              <p id="booking-lead-time" className="mt-2 text-base leading-relaxed text-forest-700">
                Book at least {minimumBookingLeadTimeDays} days before check-in. Mag-book nang hindi bababa sa{' '}
                {minimumBookingLeadTimeDays} araw bago ang pagdating.<br />
                Pinakamaagang check-in: <strong>{formatStayDate(earliestCheckIn)}</strong> (Philippine time).
              </p>
              <div className="mt-6" data-tour="stay-details">
                <div className="grid sm:grid-cols-2 gap-5">
                  <Field label="Matutuluyan (Accommodation)" error={errors.accommodation} tour="accommodation-field" required>
                    <Select
                      value={form.accommodation}
                      onChange={(e) => {
                        set('accommodation', e.target.value)
                        setCalendarNotice('')
                      }}
                      onBlur={() => handleBlur('accommodation')}
                    >
                      {!form.accommodation && <option value="" disabled>Pumili ng matutuluyan</option>}
                      {options.map((o) => (
                        <option key={o.id} value={o.id}>{o.label}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Bilang ng Bisita (Number of guests)" error={errors.guests} required>
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      inputMode="numeric"
                      value={form.guests}
                      onChange={(e) => set('guests', Math.max(1, Number(e.target.value) || 1))}
                      onBlur={() => handleBlur('guests')}
                    />
                  </Field>
                </div>

                {calendarNotice && (
                  <Alert tone="warning" className="mt-5">
                    {calendarNotice}
                  </Alert>
                )}

                <AvailabilityCalendar
                  accommodation={form.accommodation}
                  accommodationName={options.find((option) => option.id === form.accommodation)?.label || selectedAcc?.name || 'this Accommodation'}
                  earliestCheckIn={earliestCheckIn}
                  checkIn={form.check_in}
                  checkOut={form.check_out}
                  checkInError={errors.check_in}
                  checkOutError={errors.check_out}
                  validateRange={validateStayRange}
                  onCheckInBlur={() => handleBlur('check_in')}
                  onCheckOutBlur={() => handleBlur('check_out')}
                  onLoadStateChange={setCalendarState}
                  onInvalidated={setCalendarNotice}
                  onChange={(checkIn, checkOut) => {
                    setForm((current) => ({ ...current, check_in: checkIn, check_out: checkOut }))
                    setErrors((current) => ({ ...current, check_in: undefined, check_out: undefined }))
                    setAvailability(null)
                  }}
                />
                <p className="mt-3 text-base leading-relaxed text-forest-700">
                  Maaaring i-type ang petsa o pumili sa calendar. Sinusuri muli ang availability at haba ng stay bago ang bayad.
                </p>
                {nights > 1 && (
                  <Alert tone="info" className="mt-4 text-base" title={`${nights}-night range selected.`}>
                    Every night of this stay is a standard stay (2:00 PM–12:00 noon) priced at the rate of the
                    check-in night, so the total below covers all {nights} nights. The down payment, balance
                    and security deposit follow from that total and are re-checked before payment.
                  </Alert>
                )}
              </div>
            </div>

            <div className="pt-2 border-t border-forest-900/5">
              <h2 className="h2 mt-8">Detalye ng Bisita</h2>
              {usedAccount ? (
                <p className="mt-2 text-base text-emerald-800">
                  Filled in from your account. You can change any of it for this booking, and update your
                  profile any time from <Link to="/profile" className="underline">My Profile</Link>.
                </p>
              ) : !user ? (
                <p className="mt-2 text-base text-forest-700">
                  Have an account? <Link to="/guest/auth?returnTo=book" onClick={() => saveBookingProgress(form)} className="underline">Sign in</Link> and these fields fill themselves.
                </p>
              ) : null}
              <div className="mt-6 grid sm:grid-cols-2 gap-5">
                <div className="sm:col-span-2" data-tour="guest-details">
                  <Field label="Buong Pangalan (First Middle Last)" error={errors.name} required>
                    <Input
                      placeholder="Juan Dela Cruz"
                      value={form.name}
                      data-tour-field="guest-name"
                      onChange={(e) => set('name', e.target.value)}
                      onBlur={() => handleBlur('name')}
                      autoComplete="name"
                    />
                  </Field>
                </div>
                <Field label="Numero ng Cellphone (Mobile number)" error={errors.phone} required>
                  <Input
                    placeholder="09XX XXX XXXX"
                    type="tel"
                    inputMode="tel"
                    value={form.phone}
                    onChange={(e) => set('phone', e.target.value)}
                    onBlur={() => handleBlur('phone')}
                    autoComplete="tel"
                  />
                </Field>
                <Field label="Email" error={errors.email} required>
                  <Input
                    placeholder="you@email.com"
                    type="email"
                    value={form.email}
                    onChange={(e) => set('email', e.target.value)}
                    onBlur={() => handleBlur('email')}
                    autoComplete="email"
                    spellCheck={false}
                  />
                </Field>
              </div>
            </div>

            <StayRequestsSection
              values={{
                pet_count: form.pet_count,
                bonfire_wood_sets: form.bonfire_wood_sets,
                late_checkout_hours: form.late_checkout_hours,
                event_purpose: form.event_purpose,
                event_purpose_detail: form.event_purpose_detail,
                notes: form.special_requests,
              }}
              onChange={(patch) => {
                setForm((f) => ({
                  ...f,
                  ...(patch.pet_count !== undefined ? { pet_count: patch.pet_count } : {}),
                  ...(patch.bonfire_wood_sets !== undefined ? { bonfire_wood_sets: patch.bonfire_wood_sets } : {}),
                  ...(patch.late_checkout_hours !== undefined ? { late_checkout_hours: patch.late_checkout_hours } : {}),
                  ...(patch.event_purpose !== undefined ? { event_purpose: patch.event_purpose } : {}),
                  ...(patch.event_purpose_detail !== undefined ? { event_purpose_detail: patch.event_purpose_detail } : {}),
                  ...(patch.notes !== undefined ? { special_requests: patch.notes } : {}),
                }))
                setErrors((e) => ({ ...e, special_requests: undefined }))
              }}
              published={published}
              fallback={addonFallbacks}
            />

            {availability?.status === 'checking' && (
              <Alert tone="info" className="text-base">
                <strong>Confirming the selected stay…</strong> Continue stays disabled until a fresh
                availability check finishes.
              </Alert>
            )}
            {availability?.status === 'unknown' && (
              <Alert tone="danger" className="text-base">
                <strong>Availability is unknown.</strong> The Hacienda’s Booking data could not be checked.
                These dates are not being treated as available.
                <button type="button" onClick={() => setAvailabilityRetry((count) => count + 1)} className="ml-2 font-semibold underline underline-offset-2">Retry selected stay</button>
              </Alert>
            )}
            {availability?.status === 'unavailable' && (
              <Alert tone="warning" className="text-base">
                <strong>
                  {availability.blockingState === 'booked' ? 'That overnight date is booked.' : 'Those dates are already held.'}
                </strong>{' '}
                {availability.heldBy > 0
                  ? availability.heldBy === 1
                    ? 'Another Booking is holding them. '
                    : `${availability.heldBy} Bookings are holding them. `
                  : ''}
                {availability.blockingState === 'booked'
                  ? 'Choose a green check-in date. A booked date can still be the previous Guest’s checkout boundary.'
                  : 'A Pending Date hold lasts up to 24 hours while the Hacienda reviews it; choose another green date.'}
              </Alert>
            )}
            {availability?.status === 'available' && form.check_in && form.check_out && (
              <Alert tone="success" className="text-base">
                <strong>Selected stay is available.</strong> Availability will be checked again when you
                continue and atomically when the Pending Booking is created.
              </Alert>
            )}

            <CheckboxRow checked={acceptedTerms} onChange={setAcceptedTerms} tour="terms">
              I have read and accept the{' '}
              <Link to="/legal" className="text-link">
                Terms and Conditions, Privacy Policy, booking, cancellation, payment and smart-lock rules
              </Link>{' '}
              (version {LEGAL_VERSION}). This is not accepted for me.
            </CheckboxRow>
            {errors.special_requests && (
              <p className="text-base text-red-600" role="alert">{errors.special_requests}</p>
            )}

            <div className="pt-2">
              <button
                type="submit"
                disabled={status === 'submitting'
                  || calendarState !== 'ready'
                  || (Boolean(form.check_in && form.check_out) && availability?.status !== 'available')}
                className="btn-primary w-full sm:w-auto disabled:opacity-70 disabled:cursor-not-allowed"
                data-tour="submit-booking"
                aria-busy={status === 'submitting'}
              >
                {status === 'submitting' ? 'Sinusuri ang Detalye…' : 'Continue to downpayment · Magpatuloy sa Bayad'}
                {status !== 'submitting' && <ArrowRight size={20} aria-hidden="true" />}
              </button>
              <p className="text-base leading-relaxed text-forest-700 mt-4 max-w-xl">
                Hindi pa nagkakaroon ng booking sa hakbang na ito. Sa susunod na pahina, kailangan ang
                screenshot ng downpayment bago maipasa ang booking bilang <strong>Pending — hinihintay ang approval</strong>.
              </p>
            </div>
          </form>

          <aside className="lg:sticky lg:top-28 self-start">
            <div className="booking-light-surface rounded-[28px] overflow-hidden border border-forest-900/5 shadow-depth bg-white">
              <div className="relative">
                <SmartImage
                  src={selectedAcc?.images[0] || '/images/gmaps/img-07.jpg'}
                  alt={selectedAcc?.name || 'Hacienda'}
                  className="w-full h-44 lg:h-52 object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-forest-950/75 via-forest-950/20 to-transparent" />
                <div className="absolute bottom-4 left-5 right-5 text-cream-50">
                  <div className="text-base uppercase tracking-eyebrow opacity-80">Your stay at a glance</div>
                  <div className="font-serif text-2xl leading-tight">{selectedAcc?.name || '—'}</div>
                  <div className="mt-1 text-base text-cream-100/80">{BUSINESS.address.city}, {BUSINESS.address.region}</div>
                </div>
              </div>
              <div className="p-6 space-y-4">
                <SummaryRow icon={Calendar} label="Pagdating (Check-in)" value={formatStayDate(form.check_in)} />
                <SummaryRow icon={Calendar} label="Pag-alis (Check-out)" value={formatStayDate(form.check_out)} />
                <SummaryRow icon={Users} label="Mga Bisita" value={String(form.guests)} />
                <SummaryRow icon={Bed} label="Matutuluyan" value={options.find((o) => o.id === form.accommodation)?.label || '—'} />

                <div className="pt-4 border-t border-forest-900/10">
                  <div className="space-y-2">
                    <div className="text-base font-semibold text-forest-700">Tinatayang Kabuuan (Estimated Total)</div>
                    <div>
                      {estimatedTotal ? (
                        <>
                          <div className="font-serif text-3xl font-semibold text-forest-900">₱{estimatedTotal.toLocaleString('en-PH')}</div>
                          <div className="mt-1 text-base leading-relaxed text-forest-700">
                            {authoritativeQuote
                              ? `${authoritativeQuote.classification === 'weekend_holiday' ? 'Weekend / Admin holiday (Friday/Saturday check-in night)' : 'Weekday (Sunday–Thursday check-in night)'} · ${authoritativeQuote.bracket} · 2:00 PM–12:00 noon`
                              : 'Uses the published schedule for the selected dates and guest count'}
                          </div>
                        </>
                      ) : (
                        <div className="text-base text-forest-800/70">Estimate unavailable</div>
                      )}
                    </div>
                  </div>
                  <AddonFeeSummary lines={addonLines} />
                </div>

                <div className="mt-4 rounded-2xl bg-cream-100/70 p-4 text-base text-forest-800 leading-relaxed space-y-2">
                  <div>
                    <Sparkle size={14} className="inline mr-1 -mt-1 text-forest-600" />
                    {estimatedTotal
                      ? 'An estimate of the stay, including any add-ons marked “Added to total”. The refundable security deposit is shown separately at the payment step, not added to the downpayment; requests marked “Pending approval” are reviewed and priced by the Hacienda and are not part of this figure. The final quote is confirmed before anything is reserved.'
                      : !form.check_in || !form.check_out
                        ? 'Choose your dates and guest count to see an estimate based on published rates.'
                        : !published?.accommodations[form.accommodation]
                          ? 'Online booking cannot proceed until rates for this accommodation are published. Contact the Hacienda for assistance.'
                          : 'No estimate is available for this selection. Check your dates and guest count or contact the Hacienda before continuing.'}{' '}
                    <Link to="/rates" className="underline underline-offset-2">Rates &amp; Fees</Link>
                  </div>
                  <div className="pt-2 border-t border-forest-900/10">
                    <strong className="font-semibold text-forest-900">Cancellation policy:</strong>{' '}
                    {formatRefundPolicySummary(published?.refund)}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6">
              <OfficialChannelsNotice compact />
            </div>

            <div className="mt-6 bg-forest-900 text-cream-100 rounded-[28px] p-6">
              <div className="eyebrow text-cream-100/60">Prefer to Chat?</div>
              <div className="mt-3 space-y-3 text-base">
                <a href={`tel:${BUSINESS.contact.phone.replace(/\s+/g,'')}`} className="flex min-h-11 items-center gap-3 hover:underline">
                  <Phone size={20} aria-hidden="true" /> {BUSINESS.contact.phoneDisplay}
                </a>
                <a href={BUSINESS.contact.directions} target="_blank" rel="noreferrer" className="flex min-h-11 items-center gap-3 hover:underline">
                  <MapPin size={20} aria-hidden="true" /> Kunin ang Direksyon
                </a>
              </div>
            </div>
          </aside>
        </div>
      </Container>
    </Page>
  )
}

function SummaryRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] items-start gap-4 text-base">
      <span className="inline-flex items-start gap-2 text-forest-700">
        <Icon size={19} className="mt-0.5 shrink-0 text-forest-600" aria-hidden="true" /> {label}
      </span>
      <span className="text-forest-900 font-semibold text-right">{value}</span>
    </div>
  )
}
