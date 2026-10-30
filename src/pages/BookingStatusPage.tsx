import { useEffect, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { ACCOMMODATIONS, BUSINESS } from '../config/site'
import { FlowSteps } from '../components/Booking/FlowSteps'
import { HoldCountdown } from '../components/Booking/HoldCountdown'
import { cloudBookingsDB } from '../lib/firestoreBookings'
import { isFirebaseConfigured } from '../lib/firebase'
import { rememberedBookingId } from '../lib/bookingDraft'
import { ensureGuestUid } from '../lib/guestAuth'
import type { Booking } from '../lib/storage'
import { ArrowRight } from '../lib/icons'
import { EMAIL_MAX, REF_MAX, sanitizeReferenceInput } from '../lib/validation'
import { formatStayDate } from '../lib/formatDate'
import {
  Alert,
  Container,
  Field,
  Input,
  LoadingPanel,
  Page,
  PageHeader,
  StatusBadge,
  statusHeadline,
  statusMeaning,
} from '../components/ui'

type LocationState = { justSubmitted?: boolean; storage?: 'cloud' | 'local' }

type StatusPresentation = {
  badge: string
  explanation: string
  next: string
  journey: string
}

function presentationFor(status: string): StatusPresentation {
  switch (status) {
    case 'Approved':
    case 'Reserved':
      return {
        badge: 'Kumpirmado na',
        explanation: `${statusMeaning(status)} Kumpirmado na ang inyong stay—hindi na ito Pending.`,
        next: 'Itala ang petsa ng pagdating at pag-alis. Basahin ang house rules at tingnan ang direksyon bago pumunta.',
        journey: 'Hakbang 7 sa 7: Aprubado at kumpirmado na ang booking. Tingnan ang mga susunod na hakbang.',
      }
    case 'Checked-In':
    case 'Staying':
      return {
        badge: 'Kasalukuyang naka-check-in',
        explanation: statusMeaning(status),
        next: 'Kung may kailangan sa inyong stay, mag-message sa Hacienda. Para sa pag-alis, sundin ang nakasulat na checkout time at house rules.',
        journey: 'Hakbang 7 sa 7: Tingnan ang status ng stay at ang susunod na hakbang.',
      }
    case 'Checked-Out':
    case 'Completed':
      return {
        badge: 'Tapos na ang stay',
        explanation: statusMeaning(status),
        next: 'Salamat sa pagtuloy. Maaari kayong mag-book ng panibagong stay o mag-message kung may kailangan ayusin sa nakaraang booking.',
        journey: 'Hakbang 7 sa 7: Tapos na ang stay at ang booking journey.',
      }
    case 'Rejected':
      return {
        badge: 'Hindi naaprubahan',
        explanation: statusMeaning(status),
        next: 'Basahin ang dahilan sa ibaba. Mag-message sa Hacienda kung may hindi malinaw, o magsimula ng bagong booking.',
        journey: 'Hakbang 7 sa 7: Hindi naaprubahan ang booking. Basahin ang dahilan at piliin ang susunod na hakbang.',
      }
    case 'Cancelled':
      return {
        badge: 'Kanselado',
        explanation: statusMeaning(status),
        next: 'Kung nais pa ring pumunta, magsimula ng bagong booking. Mag-message kung may tanong sa kanseladong booking na ito.',
        journey: 'Hakbang 7 sa 7: Kanselado ang booking. Hindi ito isang kumpirmadong stay.',
      }
    case 'Expired':
      return {
        badge: 'Nag-expire ang booking',
        explanation: statusMeaning(status),
        next: 'Maaaring pumili muli ng available na petsa at magsimula ng bagong booking. Mag-message kung may tanong sa patunay na naipadala.',
        journey: 'Hakbang 7 sa 7: Nag-expire ang dating booking. Walang kumpirmadong stay sa booking na ito.',
      }
    case 'Payment Pending':
      return {
        badge: 'Susuriin ang bayad',
        explanation: statusMeaning(status),
        next: 'Hindi pa kumpirmado ang stay. Tingnan ang payment instructions sa inyong bookings at hintayin ang opisyal na update.',
        journey: 'Hakbang 7 sa 7: Susuriin pa ang bayad bago makakakuha ng kumpirmasyon.',
      }
    case 'Payment Verified':
      return {
        badge: 'Naberipika ang bayad',
        explanation: 'Naitala na ang bayad. Hintayin ang final reservation status bago ipagpalagay na kumpirmado ang stay.',
        next: 'Tingnan ang inyong bookings para sa susunod na opisyal na update.',
        journey: 'Hakbang 7 sa 7: Naitala ang bayad; susuriin ang final reservation status.',
      }
    default:
      return {
        badge: 'Pending · Hindi pa kumpirmado',
        explanation: statusMeaning(status),
        next: 'Hindi kailangang magpadala muli ng bayad o patunay nang walang opisyal na payo. Hintayin ang desisyon ng Hacienda; mag-message kung may kailangan idagdag o itanong.',
        journey: 'Hakbang 7 sa 7: Naipasa na ang booking at patunay. Hinihintay ang approval; hindi pa kumpirmado ang stay.',
      }
  }
}

function referenceOf(booking: Booking): string {
  return (booking.ref_id || booking.id.slice(0, 8)).toUpperCase()
}

export function BookingStatusPage() {
  const [params] = useSearchParams()
  const location = useLocation()
  const justSubmitted = Boolean((location.state as LocationState | null)?.justSubmitted)
  const storage = (location.state as LocationState | null)?.storage
  const [booking, setBooking] = useState<Booking | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [lookupRef, setLookupRef] = useState(params.get('ref') ?? '')
  const [lookupEmail, setLookupEmail] = useState('')
  const [lookupError, setLookupError] = useState('')
  const [lookupPending, setLookupPending] = useState(false)

  const idFromUrl = params.get('id')

  const load = async (id?: string | null, showLoading = true) => {
    const target = id || idFromUrl || rememberedBookingId()
    if (!target) {
      setBooking(null)
      setLoadError('')
      setLoading(false)
      return
    }
    if (showLoading) setLoading(true)
    setLoadError('')
    try {
      const found = await cloudBookingsDB.get(target)
      setBooking(found ?? null)
    } catch {
      setLoadError('Hindi mabuksan ang booking ngayon. Suriin ang internet at pindutin ang “Subukan Muli”. Hindi ibig sabihin nito na nagbago ang inyong booking status.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let alive = true
    void (async () => {
      await ensureGuestUid().catch(() => null)
      if (!alive) return
      await load(idFromUrl)
    })()
    const onUpdate = () => {
      void load(idFromUrl || booking?.id, false)
    }
    window.addEventListener('hdl:bookings-updated', onUpdate)
    return () => {
      alive = false
      window.removeEventListener('hdl:bookings-updated', onUpdate)
    }
    // booking.id is read on the event, not as a reason to resubscribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idFromUrl])

  const lookup = async (event: React.FormEvent) => {
    event.preventDefault()
    setLookupError('')
    const ref = lookupRef.trim().toUpperCase()
    const email = lookupEmail.trim().toLowerCase()
    if (!ref || !email) {
      setLookupError('Ilagay ang booking reference at ang email na ginamit sa booking.')
      return
    }
    setLookupPending(true)
    try {
      const mine = await cloudBookingsDB.list()
      const found = mine.find(
        (item) => referenceOf(item).toUpperCase() === ref && item.email.trim().toLowerCase() === email,
      )
      if (!found) {
        setLookupError('Walang booking na tumugma sa reference at email. Suriin ang dalawang detalye at subukan muli.')
        setBooking(null)
        return
      }
      setBooking(found)
    } catch {
      setLookupError('Hindi makapaghanap ng booking ngayon. Suriin ang internet at subukan muli; hindi pa namin masisiguro ang status.')
    } finally {
      setLookupPending(false)
    }
  }

  const status = booking ? cloudBookingsDB.readStatus(booking) : 'Pending'
  const presentation = presentationFor(status)
  const accommodation = ACCOMMODATIONS.find((item) => item.id === booking?.accommodation)
  const approvedJourney = ['Approved', 'Reserved', 'Checked-In', 'Staying', 'Checked-Out', 'Completed'].includes(status)
  const primaryAction = (() => {
    if (['Rejected', 'Cancelled', 'Expired', 'Checked-Out', 'Completed'].includes(status)) {
      return { to: '/book', label: 'Mag-book ng Matutuluyan' }
    }
    if (['Approved', 'Reserved'].includes(status)) {
      return { to: '/location', label: 'Tingnan ang Direksyon' }
    }
    if (['Payment Pending', 'Payment Verified'].includes(status)) {
      return { to: '/mybookings', label: 'Tingnan ang Aking Bookings' }
    }
    return null
  })()

  return (
    <Page className="guest-ground">
      <Container width="narrow">
        <div className="guest-panel px-5 py-7 sm:px-8 sm:py-9" data-tour="booking-success">
          {loading ? (
            <LoadingPanel label="Binabasa ang inyong booking…" bare />
          ) : loadError ? (
            <div>
              <PageHeader eyebrow="Booking status" title="Hindi pa mabasa ang status" />
              <Alert tone="danger" className="mt-6">{loadError}</Alert>
              <button type="button" className="btn-primary mt-6" onClick={() => void load(idFromUrl)}>
                Subukan Muli
              </button>
              <Link to="/mybookings" className="btn-ghost mt-3 sm:ml-3">Buksan ang Aking Bookings</Link>
            </div>
          ) : booking ? (
            <>
              <PageHeader
                eyebrow={justSubmitted ? 'Booking submitted · Naipasa na' : 'Booking status · Kalagayan ng booking'}
                title={statusHeadline(status)}
                lead={<p>{presentation.explanation}</p>}
                aside={
                  <div className="flex flex-wrap items-center gap-3">
                    <StatusBadge status={status} size="md" label={presentation.badge} />
                    <span className="text-base text-forest-700 dark:text-cream-100/75">
                      Reference{' '}
                      <span className="guest-num font-semibold text-forest-900 dark:text-cream-50">
                        {referenceOf(booking)}
                      </span>
                    </span>
                  </div>
                }
              />

              <div className="mt-7">
                <FlowSteps
                  current={6}
                  completedThrough={approvedJourney ? 6 : 5}
                  summary={presentation.journey}
                />
              </div>

              <section className="guest-inset mt-7 p-5 sm:p-6" aria-labelledby="booking-next-step">
                <h2 id="booking-next-step" className="font-serif text-2xl text-forest-900 dark:text-cream-50">
                  Susunod na Hakbang
                </h2>
                <p className="mt-3 text-base leading-relaxed text-forest-800 dark:text-cream-100/85">
                  {presentation.next}
                </p>
                {primaryAction ? (
                  <Link to={primaryAction.to} className="btn-primary mt-5 w-full sm:w-auto">
                    {primaryAction.label}<ArrowRight size={20} aria-hidden="true" />
                  </Link>
                ) : (
                  <a href={BUSINESS.contact.messenger} target="_blank" rel="noreferrer" className="btn-primary mt-5 w-full sm:w-auto">
                    Mag-message sa Hacienda<ArrowRight size={20} aria-hidden="true" />
                  </a>
                )}
              </section>

              {status === 'Pending' && (
                <div className="mt-6">
                  <HoldCountdown booking={booking} />
                </div>
              )}

              <dl className="guest-ledger mt-7 sm:grid-cols-2">
                {[
                  ['Matutuluyan', accommodation?.name || booking.accommodation],
                  ['Pagdating (Check-in)', formatStayDate(booking.check_in)],
                  ['Pag-alis (Check-out)', formatStayDate(booking.check_out)],
                  ['Pangalan ng Bisita', booking.guest_name],
                  ['Bilang ng Bisita', `${booking.guests}`],
                  [
                    'Naipadalang Downpayment',
                    typeof booking.amount_claimed === 'number'
                      ? `₱${booking.amount_claimed.toLocaleString('en-PH')}`
                      : 'Wala pang naitala',
                  ],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="border-t border-forest-900/8 py-3 first:border-t-0 sm:border-t-0 dark:border-cream-100/10"
                  >
                    <dt className="guest-label">{label}</dt>
                    <dd className="guest-value">{value}</dd>
                  </div>
                ))}
              </dl>

              {booking.rejection_reason && (
                <Alert tone="danger" role="status" className="mt-5">
                  <strong>Dahilan:</strong> {booking.rejection_reason}
                </Alert>
              )}

              {(storage === 'local' || !isFirebaseConfigured) && (
                <Alert
                  tone="warning"
                  className="mt-6"
                  actions={
                    !cloudBookingsDB.isCloud ? (
                      <Link to="/review" className="btn-primary">
                        Open review desk <ArrowRight size={18} />
                      </Link>
                    ) : undefined
                  }
                >
                  {storage === 'local' || !cloudBookingsDB.isCloud ? (
                    <>
                      <strong>Demo mode.</strong> This booking is in this browser. Open the review desk to
                      approve or reject the downpayment screenshot — that is the only way the status leaves Pending.
                    </>
                  ) : (
                    <>The Hacienda reviews this in the Admin app. This page updates when that decision is saved.</>
                  )}
                </Alert>
              )}

              <div className="mt-8 flex flex-wrap gap-3">
                {primaryAction && (
                  <a href={BUSINESS.contact.messenger} target="_blank" rel="noreferrer" className="btn-quiet">
                    Mag-message sa Hacienda
                  </a>
                )}
                {primaryAction?.to !== '/mybookings' && (
                  <Link to="/mybookings" className="btn-quiet">Aking Bookings</Link>
                )}
                {primaryAction?.to !== '/book' && (
                  <Link to="/book" className="btn-ghost">Mag-book ng Panibagong Stay</Link>
                )}
              </div>
            </>
          ) : (
            <>
              <PageHeader
                eyebrow="Tingnan ang booking"
                title="Hanapin ang inyong booking"
                lead={
                  <p>
                    Hindi kailangan ng account. Ilagay ang reference at ang email na ginamit sa booking.
                    Ang <strong>Pending</strong> ay nangangahulugang hinihintay pa ang approval—hindi pa kumpirmado ang stay.
                  </p>
                }
              />

              <form onSubmit={(event) => void lookup(event)} className="mt-6 grid gap-4 sm:grid-cols-2">
                <Field label="Booking Reference">
                  <Input
                    value={lookupRef}
                    maxLength={REF_MAX}
                    onChange={(event) => {
                      setLookupRef(sanitizeReferenceInput(event.target.value))
                      if (lookupError) setLookupError('')
                    }}
                    placeholder="HDL-1234"
                  />
                </Field>
                <Field label="Email sa Booking">
                  <Input
                    type="email"
                    maxLength={EMAIL_MAX}
                    value={lookupEmail}
                    onChange={(event) => {
                      setLookupEmail(event.target.value)
                      if (lookupError) setLookupError('')
                    }}
                    placeholder="you@email.com"
                    autoComplete="email"
                    spellCheck={false}
                  />
                </Field>
                {lookupError && (
                  <Alert tone="danger" className="sm:col-span-2">{lookupError}</Alert>
                )}
                <div className="flex flex-wrap gap-3 sm:col-span-2">
                  <button type="submit" disabled={lookupPending} className="btn-primary">
                    {lookupPending ? 'Naghahanap…' : 'Tingnan ang Status'}
                  </button>
                  <Link to="/book" className="btn-ghost">Mag-book ng Matutuluyan</Link>
                </div>
              </form>
            </>
          )}
        </div>
      </Container>
    </Page>
  )
}
