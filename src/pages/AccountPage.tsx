import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ROLE_LABELS } from '../lib/auth'
import { effectiveStatus } from '../lib/booking'
import { cloudBookingsDB } from '../lib/firestoreBookings'
import { formatStayDuration, type Booking } from '../lib/storage'
import { ACCOMMODATIONS } from '../config/site'
import { BookingHistory } from '../components/Booking/BookingHistory'
import { BookingInvoice } from '../components/Booking/BookingInvoice'
import { HoldCountdown } from '../components/Booking/HoldCountdown'
import { LateCheckoutRequest } from '../components/Booking/LateCheckoutRequest'
import { PaymentStep } from '../components/Booking/PaymentStep'
import { useAuth } from '../hooks/useAuth'
import { paginate, sortBy } from '../lib/pagination'
import { caseInsensitiveIncludes } from '../lib/pagination'
import { validateSearch } from '../lib/validation'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Pager } from '../components/Pager'
import { ReviewForm } from '../components/ReviewForm'
import { DisputeForm } from '../components/DisputeForm'
import { isReviewableStatus } from '../lib/reviewPolicy'
import { ArrowRight, Calendar, Sparkle, Close } from '../lib/icons'
import {
  fetchUserNotifications,
  markNotificationRead,
  type AppNotification,
} from '../lib/notifications'

/** Statuses a Guest may still withdraw from themselves — the list firestore.rules allows. */
const WITHDRAWABLE = ['Pending']

function accommodationName(id: string) {
  return ACCOMMODATIONS.find((accommodation) => accommodation.id === id)?.name ?? id
}

function statusChip(status: ReturnType<typeof effectiveStatus>) {
  if (status === 'Approved' || status === 'Reserved') return 'bg-emerald-100 text-emerald-800'
  if (status === 'Pending') return 'bg-amber-100 text-amber-800'
  if (status === 'Rejected' || status === 'Expired' || status === 'Cancelled') return 'bg-red-100 text-red-700'
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
 * The two things a Guest can do here, paying for a request and withdrawing it,
 * both go through the Booking lifecycle with the session's own actor, which is
 * what makes the Activity log say a Guest did it.
 */
export function AccountPage() {
  const { user, role, can, actor, logout } = useAuth()
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortKey, setSortKey] = useState<'created_at' | 'check_in' | 'accommodation'>('created_at')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(5)
  const [confirmingWithdraw, setConfirmingWithdraw] = useState<Booking | null>(null)
  const [viewingInvoice, setViewingInvoice] = useState<Booking | null>(null)

  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [showNotifications, setShowNotifications] = useState(false)

  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications])

  useEffect(() => {
    setLoading(true)
    const unsubscribe = cloudBookingsDB.subscribeMine(user?.uid, (list) => {
      setBookings(list)
      setLoading(false)
    })
    return () => unsubscribe()
  }, [user?.uid])

  useEffect(() => {
    if (!user?.uid) return
    void fetchUserNotifications(user.uid).then(setNotifications)
  }, [user?.uid])

  const handleMarkRead = async (id: string) => {
    if (!user?.uid) return
    await markNotificationRead(id, user.uid)
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
  }

  const withdraw = async (booking: Booking) => {
    if (!actor) return
    setBusy(booking.id)
    setNotice(null)
    try {
      // The lifecycle, not a status write: a Guest cannot cancel a Booking the
      // Admin has already taken past the point a Guest may reach alone.
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
        text: 'That did not save — the request is unchanged. The Admin can cancel it for you.',
      })
      console.warn('[Account] withdraw failed', error)
    } finally {
      setBusy(null)
      setConfirmingWithdraw(null)
    }
  }

  const filtered = useMemo(() => {
    const search = validateSearch(q)
    const needle = search.ok ? search.value : ''
    let rows = bookings.filter((b) => {
      const status = effectiveStatus(b)
      if (statusFilter !== 'all' && status !== statusFilter) return false
      const blob = `${b.guest_name} ${b.accommodation} ${b.email} ${b.ref_id ?? ''} ${b.id} ${status}`
      return caseInsensitiveIncludes(blob, needle)
    })
    rows = sortBy(rows, sortKey, sortKey === 'accommodation' ? 'asc' : 'desc')
    return rows
  }, [bookings, q, statusFilter, sortKey])

  const paged = paginate(filtered, { page, pageSize })

  return (
    <div className="pt-28 pb-24 bg-cream-50 min-h-screen">
      <div className="mx-auto max-w-4xl px-5 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="eyebrow">Your stay · {role ? ROLE_LABELS[role] : 'Guest'}</div>
            <h1 className="display text-4xl sm:text-5xl mt-3 text-forest-900">My Bookings</h1>
            <p className="mt-3 text-sm text-forest-800/80 max-w-xl leading-relaxed">
              Signed in as <strong>{user?.email ?? user?.displayName ?? 'this browser'}</strong>. These are the requests
              made from this account — watch the Date hold, pay for a request the Admin approved, and withdraw a
              request the Admin has not reviewed yet.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            <button
              type="button"
              onClick={() => setShowNotifications((v) => !v)}
              className="btn bg-white border border-forest-900/10 text-forest-800 hover:bg-cream-100 text-xs relative"
            >
              Notifications
              {unreadCount > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-red-600 text-white text-[10px] font-bold">
                  {unreadCount}
                </span>
              )}
            </button>
            <Link to="/messages" className="btn-ghost text-xs">
              Messages
            </Link>
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

        {showNotifications && (
          <div className="mt-6 bg-white rounded-[28px] border border-forest-900/10 shadow-card p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-2xl text-forest-900">Notifications</h2>
              <button
                type="button"
                onClick={() => setShowNotifications(false)}
                className="text-forest-600 hover:text-forest-900 p-1"
                aria-label="Close notifications"
              >
                <Close size={20} />
              </button>
            </div>
            {notifications.length === 0 ? (
              <p className="mt-4 text-xs text-forest-700/70">No notifications yet.</p>
            ) : (
              <div className="mt-4 space-y-3 max-h-80 overflow-y-auto pr-1">
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`p-3.5 rounded-2xl border text-xs transition ${
                      n.read ? 'bg-cream-50/50 border-forest-900/5 text-forest-800' : 'bg-emerald-50/60 border-emerald-200 text-emerald-950 font-medium'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-bold text-sm text-forest-900">{n.title}</div>
                      {!n.read && (
                        <button
                          type="button"
                          onClick={() => void handleMarkRead(n.id)}
                          className="text-[10px] text-forest-600 hover:underline whitespace-nowrap"
                        >
                          Mark as read
                        </button>
                      )}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed">{n.message}</p>
                    <div className="mt-2 text-[10px] text-forest-600/70">
                      {new Date(n.created_at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

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
              before you signed up stay with the browser that made them — ask the Admin and they will find it by name.
            </p>
            <Link to="/book" className="btn-primary mt-6 inline-flex text-xs">
              Request your dates <ArrowRight size={14} />
            </Link>
          </div>
        )}

        {!loading && bookings.length > 0 && (
          <div className="mt-8 grid sm:grid-cols-3 gap-3" data-tour="account-tools">
            <input
              className="field text-sm"
              placeholder="Search bookings"
              value={q}
              maxLength={80}
              onChange={(e) => {
                setQ(e.target.value)
                setPage(1)
              }}
            />
            <select
              className="field text-sm"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value)
                setPage(1)
              }}
            >
              <option value="all">All statuses</option>
              {['Pending', 'Payment Pending', 'Reserved', 'Completed', 'Cancelled'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select className="field text-sm" value={sortKey} onChange={(e) => setSortKey(e.target.value as typeof sortKey)}>
              <option value="created_at">Sort by created</option>
              <option value="check_in">Sort by check-in</option>
              <option value="accommodation">Sort by stay</option>
            </select>
          </div>
        )}

        <div className="mt-8 space-y-5">
          {!loading && bookings.length > 0 && filtered.length === 0 && (
            <div className="rounded-[28px] bg-white border border-forest-900/5 shadow-card p-8 text-center">
              <h2 className="font-serif text-xl text-forest-900">No bookings match those filters</h2>
              <p className="mt-2 text-sm text-forest-700/80 max-w-md mx-auto leading-relaxed">
                {bookings.length} booking{bookings.length === 1 ? '' : 's'} on this account, none matching
                {q.trim() ? ` “${q.trim()}”` : ' the selected status'}. Widen the search or choose All statuses.
              </p>
              <button
                type="button"
                onClick={() => {
                  setQ('')
                  setStatusFilter('all')
                  setPage(1)
                }}
                className="btn-ghost mt-5 inline-flex text-xs"
              >
                Clear search and filters
              </button>
            </div>
          )}
          {paged.items.map((booking) => {
            const status = effectiveStatus(booking)
            return (
              <article
                key={booking.id}
                className="rounded-[28px] bg-white border border-forest-900/5 shadow-card p-6"
                data-tour="booking-card"
              >
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
                    The Admin refused this request: “{booking.rejection_reason}”. Those dates are free again.
                  </p>
                )}
                {can('booking:update:own') && ['Payment Pending', 'Reserved'].includes(status) && (
                  <div className="mt-4">
                    <PaymentStep booking={booking} />
                  </div>
                )}

                {['Approved', 'Reserved', 'Checked-In', 'Staying'].includes(status) && (
                  <LateCheckoutRequest booking={booking} />
                )}

                <BookingHistory bookingId={booking.id} />

                {['Checked-Out', 'Completed'].includes(status) && user?.uid && (
                  <div data-testid="review-entry">
                    {isReviewableStatus(status) && (
                      <p className="mt-4 text-sm text-forest-800">
                        <strong className="font-medium">Your stay is complete!</strong> How was your stay?
                      </p>
                    )}
                    <ReviewForm bookingId={booking.id} uid={user.uid} bookingStatus={status} />
                  </div>
                )}

                {user?.uid && (
                  <DisputeForm bookingId={booking.id} guestId={user.uid} />
                )}

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setViewingInvoice(booking)}
                    className="btn bg-white border border-forest-900/10 text-forest-800 hover:bg-cream-100 text-xs"
                  >
                    📄 View Official Invoice
                  </button>

                  {can('booking:update:own') && WITHDRAWABLE.includes(status) && (
                    <button
                      onClick={() => setConfirmingWithdraw(booking)}
                      disabled={busy === booking.id}
                      className="btn-ghost text-xs disabled:opacity-50"
                    >
                      {busy === booking.id ? 'Withdrawing…' : 'Withdraw this request'}
                    </button>
                  )}
                  {!WITHDRAWABLE.includes(status) && status !== 'Cancelled' && status !== 'Rejected' && (
                    <span className="text-[11px] text-forest-600 flex items-center gap-1">
                      <Sparkle size={12} /> Past the point you can withdraw alone — message the Admin to change it.
                    </span>
                  )}
                </div>
              </article>
            )
          })}
        </div>

        {!loading && bookings.length > 0 && (
          <Pager
            page={paged}
            onPage={setPage}
            onPageSize={(n) => {
              setPageSize(n)
              setPage(1)
            }}
          />
        )}

        <ConfirmDialog
          open={confirmingWithdraw !== null}
          danger
          title="Withdraw this request?"
          body={
            confirmingWithdraw
              ? `Request ${reference(confirmingWithdraw)} for ${accommodationName(
                  confirmingWithdraw.accommodation,
                )} (${confirmingWithdraw.check_in} → ${confirmingWithdraw.check_out}) will be cancelled and those dates released for other Guests. The Admin cannot undo this from their own app.`
              : ''
          }
          confirmLabel="Withdraw request"
          cancelLabel="Keep it"
          busy={busy === confirmingWithdraw?.id}
          onCancel={() => setConfirmingWithdraw(null)}
          onConfirm={() => {
            if (confirmingWithdraw) void withdraw(confirmingWithdraw)
          }}
        />

        {viewingInvoice && (
          <div className="fixed inset-0 z-50 bg-forest-950/50 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
            <div className="w-full max-w-2xl my-auto">
              <BookingInvoice booking={viewingInvoice} onClose={() => setViewingInvoice(null)} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function reference(booking: Booking) {
  return booking.ref_id || booking.id.slice(0, 8).toUpperCase()
}
