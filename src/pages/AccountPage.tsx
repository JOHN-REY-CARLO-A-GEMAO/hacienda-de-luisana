import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ROLE_LABELS } from '../lib/auth'
import { effectiveStatus } from '../lib/booking'
import { cloudBookingsDB } from '../lib/firestoreBookings'
import { formatStayDuration, type Booking } from '../lib/storage'
import { ACCOMMODATIONS } from '../config/site'
import { BookingHistory } from '../components/Booking/BookingHistory'
import { HoldCountdown } from '../components/Booking/HoldCountdown'
import { KycUpload } from '../components/Booking/KycUpload'
import { useAuth } from '../hooks/useAuth'
import { ArrowRight, Calendar, Sparkle } from '../lib/icons'

/** Statuses a Guest may still withdraw from themselves — the list firestore.rules allows. */
const WITHDRAWABLE = ['Pending', 'KYC Submitted']

function accommodationName(id: string) {
  return ACCOMMODATIONS.find((accommodation) => accommodation.id === id)?.name ?? id
}

function statusChip(status: ReturnType<typeof effectiveStatus>) {
  if (status === 'Reserved') return 'bg-emerald-100 text-emerald-800'
  if (status === 'Pending' || status === 'KYC Submitted' || status === 'Approved') return 'bg-amber-100 text-amber-800'
  if (status === 'Expired' || status === 'Rejected' || status === 'Cancelled') return 'bg-red-100 text-red-700'
  return 'bg-cream-100 text-forest-700'
}

/**
 * The Guest's own page.
 *
 * Everything on it is the Guest's own Booking and nothing else: the list is
 * queried by the identity the Booking was created with (ADR-0004), so a Guest who
 * edits an id in this browser still cannot read somebody else's stay — the
 * database refuses the read before this page ever renders it.
 *
 * The two things a Guest can do here, sending an ID and withdrawing a request,
 * both go through the Booking lifecycle with the session's own actor, which is
 * what makes the Activity log say a Guest did it.
 */
export function AccountPage() {
  const { user, role, can, actor, logout } = useAuth()
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)

  useEffect(() => {
    setLoading(true)
    const unsubscribe = cloudBookingsDB.subscribeMine(user?.uid, (list) => {
      setBookings(list)
      setLoading(false)
    })
    return () => unsubscribe()
  }, [user?.uid])

  const withdraw = async (booking: Booking) => {
    if (!actor) return
    setBusy(booking.id)
    setNotice(null)
    try {
      // The lifecycle, not a status write: a Guest cannot cancel a Booking the
      // Host has already taken past the point a Guest may reach alone.
      const result = await cloudBookingsDB.transition(
        booking.id,
        { type: 'Cancel', reason: 'Withdrawn by the Guest from their own account page.' },
        actor,
      )
      setNotice(
        result.ok
          ? { tone: 'good', text: `Request ${reference(booking)} was withdrawn. Those dates are free again.` }
          : { tone: 'bad', text: result.reason },
      )
    } catch (error) {
      setNotice({
        tone: 'bad',
        text: 'That did not save — the request is unchanged. The Host can cancel it for you.',
      })
      console.warn('[Account] withdraw failed', error)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="pt-28 pb-24 bg-cream-50 min-h-screen">
      <div className="mx-auto max-w-4xl px-5 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="eyebrow">Your stay · {role ? ROLE_LABELS[role] : 'Guest'}</div>
            <h1 className="display text-4xl sm:text-5xl mt-3 text-forest-900">My Bookings</h1>
            <p className="mt-3 text-sm text-forest-800/80 max-w-xl leading-relaxed">
              Signed in as <strong>{user?.email ?? user?.displayName ?? 'this browser'}</strong>. These are the requests
              made from this account — send your government ID, watch the Date hold, and withdraw a request the Host has
              not reviewed yet.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Link to="/book" className="btn-primary text-xs">
              Book another stay
            </Link>
            <button
              onClick={() => void logout()}
              className="btn bg-white border border-forest-900/10 text-forest-800 hover:bg-cream-100 text-xs"
            >
              Sign out
            </button>
          </div>
        </div>

        {notice && (
          <div
            className={`mt-6 rounded-2xl border px-4 py-3 text-sm ${
              notice.tone === 'good'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            {notice.text}
          </div>
        )}

        {loading && (
          <div className="mt-10 text-center text-sm text-forest-700/70">Reading your bookings…</div>
        )}

        {!loading && bookings.length === 0 && (
          <div className="mt-10 rounded-[28px] bg-white border border-forest-900/5 shadow-card p-8 text-center">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-cream-100 text-forest-700 flex items-center justify-center">
              <Calendar size={20} />
            </div>
            <h2 className="font-serif text-2xl text-forest-900 mt-4">No bookings on this account yet</h2>
            <p className="mt-2 text-sm text-forest-700/80 max-w-md mx-auto leading-relaxed">
              A request only shows up here if it was made while you were signed in with this account. Requests made
              before you signed up stay with the browser that made them — ask the Host and they will find it by name.
            </p>
            <Link to="/book" className="btn-primary mt-6 inline-flex text-xs">
              Request your dates <ArrowRight size={14} />
            </Link>
          </div>
        )}

        <div className="mt-8 space-y-5">
          {bookings.map((booking) => {
            const status = effectiveStatus(booking)
            return (
              <article key={booking.id} className="rounded-[28px] bg-white border border-forest-900/5 shadow-card p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="eyebrow">Request {reference(booking)}</div>
                    <h2 className="font-serif text-2xl text-forest-900 mt-1.5">
                      {accommodationName(booking.accommodation)}
                    </h2>
                    <div className="mt-1 text-sm text-forest-700/80">
                      {booking.check_in} → {booking.check_out} · {formatStayDuration(booking.check_in, booking.check_out)}{' '}
                      · {booking.guests} guest{booking.guests === 1 ? '' : 's'}
                    </div>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-[11px] font-bold ${statusChip(status)}`}
                  >
                    {status}
                  </span>
                </div>

                <div className="mt-4">
                  <HoldCountdown booking={booking} />
                </div>

                {booking.rejection_reason && (
                  <p className="mt-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                    The Host refused this request: “{booking.rejection_reason}”. Those dates are free again.
                  </p>
                )}
                {booking.kyc_reject_reason && (
                  <p className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                    Your ID was refused: “{booking.kyc_reject_reason}”. Send another one below — your dates stay held
                    while you do.
                  </p>
                )}

                {can('kyc:upload') && (
                  <div className="mt-4">
                    <KycUpload booking={booking} />
                  </div>
                )}

                <BookingHistory bookingId={booking.id} />

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  {can('booking:update:own') && WITHDRAWABLE.includes(status) && (
                    <button
                      onClick={() => void withdraw(booking)}
                      disabled={busy === booking.id}
                      className="btn-ghost text-xs disabled:opacity-50"
                    >
                      {busy === booking.id ? 'Withdrawing…' : 'Withdraw this request'}
                    </button>
                  )}
                  {!WITHDRAWABLE.includes(status) && status !== 'Cancelled' && status !== 'Rejected' && (
                    <span className="text-[11px] text-forest-600 flex items-center gap-1">
                      <Sparkle size={12} /> Past the point you can withdraw alone — message the Host to change it.
                    </span>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function reference(booking: Booking) {
  return booking.ref_id || booking.id.slice(0, 8).toUpperCase()
}
