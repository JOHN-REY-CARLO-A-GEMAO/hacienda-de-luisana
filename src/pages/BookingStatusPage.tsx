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

type LocationState = { justSubmitted?: boolean; storage?: 'cloud' | 'local' }

function referenceOf(booking: Booking): string {
  return (booking.ref_id || booking.id.slice(0, 8)).toUpperCase()
}

function statusCopy(status: string): { title: string; body: string; tone: string } {
  if (status === 'Approved') {
    return {
      title: 'Approved',
      body: 'The Hacienda accepted your downpayment screenshot. This stay is confirmed.',
      tone: 'bg-emerald-100 text-emerald-900',
    }
  }
  if (status === 'Rejected') {
    return {
      title: 'Rejected',
      body: 'The Hacienda declined the downpayment proof. This stay is not confirmed, and the dates have been released.',
      tone: 'bg-red-100 text-red-800',
    }
  }
  if (status === 'Expired') {
    return {
      title: 'Expired',
      body: 'The 24-hour review window ran out before a decision. The dates are free again. You can send a new booking.',
      tone: 'bg-red-100 text-red-800',
    }
  }
  if (status === 'Cancelled') {
    return {
      title: 'Cancelled',
      body: 'This booking was withdrawn. It is not a confirmed stay.',
      tone: 'bg-red-100 text-red-800',
    }
  }
  return {
    title: 'Pending',
    body: 'Your downpayment screenshot is with the Hacienda. The booking stays Pending until an admin approves or rejects it. It is not confirmed yet.',
    tone: 'bg-amber-100 text-amber-900',
  }
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
  }

  const status = booking ? cloudBookingsDB.readStatus(booking) : 'Pending'
  const copy = statusCopy(status)
  const accommodation = ACCOMMODATIONS.find((item) => item.id === booking?.accommodation)

  return (
    <div className="pt-28 pb-24 bg-cream-50 min-h-screen">
      <div className="mx-auto max-w-3xl px-5 lg:px-8">
        <div className="bg-white rounded-[28px] border border-forest-900/5 shadow-card p-8 sm:p-12" data-tour="booking-success">
          {loading ? (
            <p className="text-sm text-forest-700">Looking up the booking…</p>
          ) : booking ? (
            <>
              <div className={`mx-auto w-16 h-16 rounded-full flex items-center justify-center ${copy.tone}`}>
                <Sparkle size={26} />
              </div>
              <div className="eyebrow mt-6 text-center">{justSubmitted ? 'Booking submitted' : 'Booking status'}</div>
              <h1 className="display text-4xl sm:text-5xl mt-3 text-forest-900 text-center">{copy.title}</h1>
              <p className="mt-4 text-forest-800/80 leading-relaxed text-center max-w-lg mx-auto">{copy.body}</p>
              <div className="mt-5 flex justify-center">
                <span className={`rounded-full px-4 py-2 text-xs font-medium ${copy.tone}`}>
                  Status: {status}
                </span>
              </div>
              <div className="mt-4 text-center text-xs text-forest-700">
                Reference <span className="font-mono font-bold text-forest-900">{referenceOf(booking)}</span>
              </div>
              {justSubmitted && status === 'Pending' && <div className="mt-6"><FlowSteps current={2} /></div>}
              {status === 'Pending' && (
                <div className="mt-6 text-left">
                  <HoldCountdown booking={booking} />
                </div>
              )}
              <dl className="mt-6 rounded-2xl bg-cream-50 border border-forest-900/5 p-4 grid sm:grid-cols-2 gap-3 text-xs text-left">
                <div>
                  <dt className="uppercase tracking-eyebrow text-[10px] text-forest-600">Stay</dt>
                  <dd className="font-medium text-forest-900">{accommodation?.name || booking.accommodation}</dd>
                </div>
                <div>
                  <dt className="uppercase tracking-eyebrow text-[10px] text-forest-600">Dates</dt>
                  <dd className="font-medium text-forest-900">{booking.check_in} → {booking.check_out}</dd>
                </div>
                <div>
                  <dt className="uppercase tracking-eyebrow text-[10px] text-forest-600">Guest</dt>
                  <dd className="font-medium text-forest-900">{booking.guest_name} · {booking.guests} guests</dd>
                </div>
                <div>
                  <dt className="uppercase tracking-eyebrow text-[10px] text-forest-600">Downpayment claimed</dt>
                  <dd className="font-medium text-forest-900">
                    {typeof booking.amount_claimed === 'number'
                      ? `₱${booking.amount_claimed.toLocaleString('en-PH')}`
                      : '—'}
                  </dd>
                </div>
              </dl>
              {booking.rejection_reason && (
                <p className="mt-4 text-sm text-red-800 text-left">Reason: {booking.rejection_reason}</p>
              )}
              {(storage === 'local' || !isFirebaseConfigured) && (
                <div className="mt-6 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-left text-xs text-amber-950 leading-relaxed">
                  {storage === 'local' || !cloudBookingsDB.isCloud ? (
                    <>
                      <strong>Demo mode.</strong> This booking is in this browser. Open the review desk to
                      approve or reject the downpayment screenshot — that is the only way the status leaves Pending.
                    </>
                  ) : (
                    <>The Hacienda reviews this in the Admin app. This page updates when that decision is saved.</>
                  )}
                  {!cloudBookingsDB.isCloud && (
                    <div className="mt-3">
                      <Link to="/review" className="btn-primary text-[11px]">
                        Open review desk <ArrowRight size={14} />
                      </Link>
                    </div>
                  )}
                </div>
              )}
              <div className="mt-8 flex flex-wrap gap-3 justify-center">
                <Link to="/" className="btn-ghost">Back home</Link>
                <Link to="/book" className="btn-ghost">Book another stay</Link>
                <a href={BUSINESS.contact.messenger} target="_blank" rel="noreferrer" className="btn-primary">
                  Message the Hacienda
                </a>
              </div>
            </>
          ) : (
            <>
              <div className="eyebrow">Check a booking</div>
              <h1 className="display text-4xl mt-3 text-forest-900">No account needed</h1>
              <p className="mt-3 text-sm text-forest-800/80 leading-relaxed">
                Enter the reference from your confirmation and the email on the booking. Status is Pending
                until an admin approves or rejects the downpayment.
              </p>
              <form onSubmit={(event) => void lookup(event)} className="mt-6 grid sm:grid-cols-2 gap-4 text-left">
                <label className="block">
                  <span className="label">Reference</span>
                  <input className="field" value={lookupRef} onChange={(event) => setLookupRef(event.target.value)} placeholder="HDL-1234" />
                </label>
                <label className="block">
                  <span className="label">Email</span>
                  <input className="field" type="email" value={lookupEmail} onChange={(event) => setLookupEmail(event.target.value)} placeholder="you@email.com" />
                </label>
                {lookupError && <p className="sm:col-span-2 text-xs text-red-700">{lookupError}</p>}
                <button type="submit" className="btn-primary text-xs sm:col-span-2 w-fit">Look up status</button>
              </form>
              <Link to="/book" className="btn-ghost mt-6 inline-flex text-xs">Start a booking</Link>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
