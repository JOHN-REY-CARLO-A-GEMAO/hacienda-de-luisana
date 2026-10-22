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
import { ArrowRight, Sparkle } from '../lib/icons'
import { EMAIL_MAX, REF_MAX, sanitizeReferenceInput } from '../lib/validation'
import {
  Alert,
  Card,
  Container,
  Field,
  Input,
  LoadingPanel,
  PageHeader,
  StatusBadge,
  statusHeadline,
  statusMeaning,
} from '../components/ui'

type LocationState = { justSubmitted?: boolean; storage?: 'cloud' | 'local' }

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
  const [lookupRef, setLookupRef] = useState(params.get('ref') ?? '')
  const [lookupEmail, setLookupEmail] = useState('')
  const [lookupError, setLookupError] = useState('')
  const [lookupPending, setLookupPending] = useState(false)

  const idFromUrl = params.get('id')

  const load = async (id?: string | null) => {
    const target = id || idFromUrl || rememberedBookingId()
    if (!target) {
      setBooking(null)
      setLoading(false)
      return
    }
    const found = await cloudBookingsDB.get(target)
    setBooking(found ?? null)
    setLoading(false)
  }

  useEffect(() => {
    let alive = true
    void (async () => {
      await ensureGuestUid().catch(() => null)
      if (!alive) return
      await load(idFromUrl)
    })()
    const onUpdate = () => {
      void load(idFromUrl || booking?.id)
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
      setLookupError('Enter the reference and the email on the booking.')
      return
    }
    setLookupPending(true)
    try {
      const mine = await cloudBookingsDB.list().catch(() => [])
      const found = mine.find(
        (item) => referenceOf(item).toUpperCase() === ref && item.email.trim().toLowerCase() === email,
      )
      if (!found) {
        setLookupError('No booking matched that reference and email in this browser.')
        setBooking(null)
        return
      }
      setBooking(found)
    } finally {
      setLookupPending(false)
    }
  }

  const status = booking ? cloudBookingsDB.readStatus(booking) : 'Pending'
  const accommodation = ACCOMMODATIONS.find((item) => item.id === booking?.accommodation)

  return (
    <div className="min-h-screen bg-cream-50 pb-24 pt-28">
      <Container width="narrow">
        <Card padding="lg" data-tour="booking-success">
          {loading ? (
            <LoadingPanel label="Looking up your booking…" bare />
          ) : booking ? (
            <>
              <PageHeader
                eyebrow={justSubmitted ? 'Booking submitted' : 'Booking status'}
                title={statusHeadline(status)}
                lead={<p>{statusMeaning(status)}</p>}
                aside={
                  <div className="flex flex-wrap items-center gap-3">
                    <StatusBadge status={status} size="md" />
                    <span className="text-xs text-forest-700">
                      Reference <span className="font-mono font-semibold text-forest-900">{referenceOf(booking)}</span>
                    </span>
                  </div>
                }
              />

              {justSubmitted && status === 'Pending' && (
                <div className="mt-6">
                  <FlowSteps current={2} />
                </div>
              )}

              {status === 'Pending' && (
                <div className="mt-6">
                  <HoldCountdown booking={booking} />
                </div>
              )}

              <dl className="panel-muted mt-6 grid gap-4 p-4 text-xs sm:grid-cols-2">
                {[
                  ['Stay', accommodation?.name || booking.accommodation],
                  ['Dates', `${booking.check_in} → ${booking.check_out}`],
                  ['Guest', `${booking.guest_name} · ${booking.guests} guests`],
                  [
                    'Downpayment claimed',
                    typeof booking.amount_claimed === 'number'
                      ? `₱${booking.amount_claimed.toLocaleString('en-PH')}`
                      : '—',
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="data-label">{label}</dt>
                    <dd className="mt-0.5 font-medium text-forest-900">{value}</dd>
                  </div>
                ))}
              </dl>

              {booking.rejection_reason && (
                <Alert tone="danger" className="mt-4 text-xs">
                  <strong>Reason:</strong> {booking.rejection_reason}
                </Alert>
              )}

              {(storage === 'local' || !isFirebaseConfigured) && (
                <Alert
                  tone="warning"
                  className="mt-6 text-xs"
                  actions={
                    !cloudBookingsDB.isCloud ? (
                      <Link to="/review" className="btn-primary btn-sm">
                        Open review desk <ArrowRight size={14} />
                      </Link>
                    ) : undefined
                  }
                >
                  {storage === 'local' || !cloudBookingsDB.isCloud ? (
                    <>
                      <strong>Demo mode.</strong> This booking is in this browser. Open the review desk to
                      approve or reject the downpayment screenshot — that is the only way the status leaves
                      Pending.
                    </>
                  ) : (
                    <>The Hacienda reviews this in the Admin app. This page updates when that decision is saved.</>
                  )}
                </Alert>
              )}

              <div className="mt-8 flex flex-wrap gap-3">
                <a href={BUSINESS.contact.messenger} target="_blank" rel="noreferrer" className="btn-primary">
                  Message the Hacienda
                </a>
                <Link to="/account" className="btn-quiet">
                  My bookings
                </Link>
                <Link to="/book" className="btn-ghost">
                  Book another stay
                </Link>
              </div>
            </>
          ) : (
            <>
              <PageHeader
                eyebrow="Check a booking"
                title="Look up your booking"
                lead={
                  <p>
                    No account needed. Enter the reference from your confirmation and the email on the
                    booking. A booking stays Pending until the Hacienda approves or rejects the
                    downpayment.
                  </p>
                }
              />

              <form onSubmit={(event) => void lookup(event)} className="mt-6 grid gap-4 sm:grid-cols-2">
                <Field label="Reference">
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
                <Field label="Email">
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
                  <Alert tone="danger" className="text-xs sm:col-span-2">
                    {lookupError}
                  </Alert>
                )}
                <div className="flex flex-wrap gap-3 sm:col-span-2">
                  <button
                    type="submit"
                    disabled={lookupPending || Boolean(lookupError)}
                    className="btn-primary"
                  >
                    {lookupPending ? 'Looking up…' : 'Look up status'}
                  </button>
                  <Link to="/book" className="btn-ghost">
                    Start a booking
                  </Link>
                </div>
              </form>
            </>
          )}
        </Card>
      </Container>
    </div>
  )
}
