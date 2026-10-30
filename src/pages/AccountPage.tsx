import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ROLE_LABELS } from '../lib/auth'
import { effectiveStatus } from '../lib/booking'
import { cloudBookingsDB } from '../lib/firestoreBookings'
import type { Booking } from '../lib/storage'
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
import { Bell, CreditCard, Sparkle } from '../lib/icons'
import { Alert, Container, Drawer, Input, Modal, Page, Select, SkeletonLines } from '../components/ui'
import {
  Flyleaf,
  StayEntry,
  StayMasthead,
  accommodationName,
  bookingReference,
  daysUntil,
} from '../components/Account'
import { useNotifications } from '../hooks/useNotifications'
import { notifyAdmin } from '../lib/notifications'

/** A Guest withdraws a request nobody has acted on yet. */
const WITHDRAWABLE = ['Pending']
/**
 * A Guest may also cancel after the Admin has acted (docs/HDL_FLOW_CORRECTED.md
 * §11, and `guestSelfServeUpdate` in firestore.rules): the dates are released and,
 * when money was verified, the refund is settled by the policy stamped on the Booking.
 */
const CANCELLABLE = ['Approved', 'Payment Pending', 'Reserved']

/** How many months a Guest has to move a paid stay to a new date before the payment is forfeited. */
const RESCHEDULE_WINDOW_MONTHS = 3

/**
 * The Hacienda's cancellation policy, in words, for the cancel dialog.
 *
 * It is the owner's rule, not a computed one: a paid booking is never refunded;
 * the Guest may move it to a new date within three months; after that the payment
 * is forfeited. The downpayment is non-refundable either way.
 */
function cancellationTerms(booking: Booking): string {
  const status = effectiveStatus(booking)
  const paid = status === 'Reserved' || (status === 'Approved' && booking.payment_status === 'verified')
  if (!paid) {
    return 'No payment has been verified on this booking yet, so nothing is charged. The dates are released.'
  }
  return [
    'Cancellation policy:',
    '• The downpayment is non-refundable.',
    `• Instead of cancelling, you may reschedule to a new date within ${RESCHEDULE_WINDOW_MONTHS} months — contact the Admin to move your booking.`,
    `• If it is not rescheduled within ${RESCHEDULE_WINDOW_MONTHS} months, the payment is forfeited.`,
    'If you cancel now, you will not get a refund and the payment will not be moved to another date.',
  ].join('\n')
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
 *
 * The page is drawn as the Hacienda's guest book: one sheet, one date margin,
 * one entry per stay, and the Guest's name on the flyleaf. The design direction
 * is documented in `docs/ACCOUNT.md`.
 */
export function AccountPage() {
  const { user, profile, role, can, actor } = useAuth()
  const [params] = useSearchParams()
  const tabParam = params.get('tab')
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [notificationSidebarOpen, setNotificationSidebarOpen] = useState(tabParam === 'notifications')

  // Notifications links open the same drawer even when navigating within /mybookings.
  useEffect(() => {
    if (tabParam === 'notifications') setNotificationSidebarOpen(true)
  }, [tabParam])

  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortKey, setSortKey] = useState<'created_at' | 'check_in' | 'accommodation'>('created_at')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(5)
  const [confirmingWithdraw, setConfirmingWithdraw] = useState<Booking | null>(null)
  const [viewingInvoice, setViewingInvoice] = useState<Booking | null>(null)

  const [confirmingCancel, setConfirmingCancel] = useState<Booking | null>(null)

  const { items: notifications, unreadCount, markRead, markAllRead } = useNotifications()

  useEffect(() => {
    setLoading(true)
    const unsubscribe = cloudBookingsDB.subscribeMine(user?.uid, (list) => {
      setBookings(list)
      setLoading(false)
    })
    return () => unsubscribe()
  }, [user?.uid])

  const handleMarkRead = (id: string) => markRead(id)

  const withdraw = async (booking: Booking, how: 'withdraw' | 'cancel' = 'withdraw') => {
    if (!actor) return
    setBusy(booking.id)
    setNotice(null)
    try {
      // The lifecycle, not a status write: a Guest cannot cancel a Booking the
      // Admin has already taken past the point a Guest may reach alone.
      const result = await cloudBookingsDB.transition(
        booking.id,
        {
          type: 'Cancel',
          reason:
            how === 'cancel'
              ? 'Cancelled by the Guest from their own account page.'
              : 'Withdrawn by the Guest from their own account page.',
        },
        actor,
      )
      setNotice(
        result.ok
          ? {
              tone: 'good',
              text:
                how === 'cancel'
                  ? `Booking ${bookingReference(booking)} was cancelled. Those dates are free again.`
                  : `Request ${bookingReference(booking)} was withdrawn. Those dates are free again.`,
            }
          : { tone: 'bad', text: result.reason },
      )
      if (result.ok) {
        void notifyAdmin({
          bookingId: booking.id,
          type: 'cancellation_by_guest',
          title: how === 'cancel' ? 'Guest cancelled a booking' : 'Guest withdrew a request',
          message: `${booking.guest_name} ${how === 'cancel' ? 'cancelled' : 'withdrew'} ${bookingReference(booking)} (${booking.check_in} → ${booking.check_out}).`,
        })
      }
    } catch (error) {
      setNotice({
        tone: 'bad',
        text: 'That did not save — the request is unchanged. The Admin can cancel it for you.',
      })
      console.warn('[Account] withdraw failed', error)
    } finally {
      setBusy(null)
      setConfirmingWithdraw(null)
      setConfirmingCancel(null)
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

  // The sentence at the foot of the book: how many stays, how many coming up,
  // how many still waiting on the Hacienda. It replaces three identical tiles.
  const stats = useMemo(() => {
    const total = bookings.length
    const pending = bookings.filter((b) => effectiveStatus(b) === 'Pending').length
    const future = bookings.filter((b) => {
      const status = effectiveStatus(b)
      const days = daysUntil(b.check_in)
      return (status === 'Approved' || status === 'Reserved' || status === 'Pending') && days >= 0
    }).length
    return { total, pending, future }
  }, [bookings])

  // Get next upcoming stay
  const nextStay = useMemo(() => {
    const futureBookings = bookings
      .filter((b) => {
        const status = effectiveStatus(b)
        const days = daysUntil(b.check_in)
        return (status === 'Approved' || status === 'Reserved' || status === 'Pending') && days > 0
      })
      .sort((a, b) => new Date(a.check_in).getTime() - new Date(b.check_in).getTime())
    return futureBookings[0] || null
  }, [bookings])

  const fullName = profile?.display_name || user?.displayName || user?.email || 'Guest'
  // The band greets with the name a person is called by, not with the whole
  // legal name the invoice needs.
  const shortName =
    profile?.first_name?.trim() ||
    profile?.display_name?.trim().split(/\s+/)[0] ||
    user?.displayName?.trim().split(/\s+/)[0] ||
    null

  return (
    <Page className="ledger-ground">
      {/* The one loud element on the page: the stay that is coming, on the
          Hacienda's own photograph, under its dates. Everything below it is a
          quiet document. */}
      <Container width="wide">
        <StayMasthead
          booking={nextStay}
          greeting={shortName}
          roleLabel={role ? ROLE_LABELS[role] : 'Guest'}
          hasBookings={bookings.length > 0}
          actions={
            <>
              <button
                type="button"
                onClick={() => setNotificationSidebarOpen(true)}
                className="btn-secondary btn-sm"
              >
                <Bell size={15} aria-hidden="true" />
                Notifications
                {unreadCount > 0 && (
                  <span className="ledger-unread guest-num">{unreadCount > 9 ? '9+' : unreadCount}</span>
                )}
              </button>
              <Link to="/book" className="btn-on-dark btn-sm">
                Book a stay
              </Link>
            </>
          }
        />
      </Container>

      <Container width="wide" className="mt-6 lg:mt-8">
        <div className="ledger-grid">
          <section className="ledger-sheet" aria-labelledby="bookings-heading">
            <div className="ledger-sheet-head">
              <h2 id="bookings-heading" className="py-4 font-serif text-2xl text-forest-900 dark:text-cream-50">My bookings</h2>
            </div>
            <div className="ledger-page">
                {notice && (
                  <Alert tone={notice.tone === 'good' ? 'success' : 'danger'} className="mb-5">
                    {notice.text}
                  </Alert>
                )}

                {!loading && bookings.length > 0 && (
                  <div className="ledger-tools" data-tour="account-tools">
                    <Input
                      className="ledger-tool"
                      placeholder="Search bookings"
                      aria-label="Search bookings"
                      value={q}
                      maxLength={80}
                      onChange={(e) => {
                        setQ(e.target.value)
                        setPage(1)
                      }}
                    />
                    <Select
                      className="ledger-tool"
                      aria-label="Filter by status"
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
                    </Select>
                    <Select
                      className="ledger-tool"
                      aria-label="Sort bookings"
                      value={sortKey}
                      onChange={(e) => setSortKey(e.target.value as typeof sortKey)}
                    >
                      <option value="created_at">Newest booked first</option>
                      <option value="check_in">By check-in date</option>
                      <option value="accommodation">By accommodation</option>
                    </Select>
                  </div>
                )}

                {loading && (
                  <div className="ledger-loading" role="status" aria-live="polite">
                    <span className="sr-only">Reading your bookings…</span>
                    <SkeletonLines rows={4} />
                  </div>
                )}

                {!loading && bookings.length === 0 && (
                  <div className="ledger-empty">
                    <h2 className="ledger-empty-title">No bookings on this account yet</h2>
                    <p className="ledger-empty-copy">
                      A request only shows up here if it was made while you were signed in with this
                      account. Requests made before you signed up stay with the browser that made
                      them — ask the Admin and they will find it by name.
                    </p>
                    <div className="ledger-empty-actions">
                      <Link to="/book" className="btn-primary">
                        Book your first stay
                      </Link>
                      <Link to="/stay" className="btn-ghost">
                        Browse accommodations
                      </Link>
                    </div>
                  </div>
                )}

                {!loading && bookings.length > 0 && filtered.length === 0 && (
                  <div className="ledger-empty">
                    <h2 className="ledger-empty-title">No bookings match those filters</h2>
                    <p className="ledger-empty-copy">
                      {bookings.length} booking{bookings.length === 1 ? '' : 's'} on this account, none
                      matching {q.trim() ? `“${q.trim()}”` : 'the selected status'}. Widen the search or
                      choose All statuses.
                    </p>
                    <div className="ledger-empty-actions">
                      <button
                        type="button"
                        onClick={() => {
                          setQ('')
                          setStatusFilter('all')
                          setPage(1)
                        }}
                        className="btn-ghost"
                      >
                        Clear search and filters
                      </button>
                    </div>
                  </div>
                )}

                <div className="ledger-entries">
                  {paged.items.map((booking) => {
                    const status = effectiveStatus(booking)
                    return (
                      <StayEntry
                        key={booking.id}
                        booking={booking}
                        actions={
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setViewingInvoice(booking)}
                                className="btn-quiet btn-sm"
                              >
                                <CreditCard size={14} aria-hidden="true" />
                                Invoice
                              </button>

                              {can('booking:update:own') && CANCELLABLE.includes(status) && (
                                <button
                                  onClick={() => setConfirmingCancel(booking)}
                                  disabled={busy === booking.id}
                                  className="btn-danger-quiet btn-sm"
                                >
                                  {busy === booking.id ? 'Cancelling…' : 'Cancel booking'}
                                </button>
                              )}

                              {can('booking:update:own') && WITHDRAWABLE.includes(status) && (
                                <button
                                  onClick={() => setConfirmingWithdraw(booking)}
                                  disabled={busy === booking.id}
                                  className="btn-danger-quiet btn-sm"
                                >
                                  {busy === booking.id ? 'Withdrawing…' : 'Withdraw this request'}
                                </button>
                              )}
                            </div>

                            {!WITHDRAWABLE.includes(status) &&
                              !CANCELLABLE.includes(status) &&
                              status !== 'Cancelled' &&
                              status !== 'Rejected' && (
                                <span className="ledger-actions-note">
                                  <Sparkle size={12} aria-hidden="true" />
                                  Contact the Admin to change dates
                                </span>
                              )}
                          </div>
                        }
                        review={
                          ['Checked-Out', 'Completed'].includes(status) && user?.uid ? (
                            <div data-testid="review-entry">
                              <ReviewForm bookingId={booking.id} uid={user.uid} bookingStatus={status} />
                            </div>
                          ) : undefined
                        }
                      >
                        <HoldCountdown booking={booking} />

                        {/* Money and stay extensions are forms, not buttons: they
                            belong in the entry's body, not in its action row. */}
                        {can('booking:update:own') && ['Payment Pending', 'Reserved'].includes(status) && (
                          <PaymentStep booking={booking} />
                        )}

                        {['Approved', 'Reserved', 'Checked-In', 'Staying'].includes(status) && (
                          <LateCheckoutRequest booking={booking} />
                        )}

                        {booking.rejection_reason && (
                          <Alert tone="danger" className="text-xs">
                            <strong>Admin declined:</strong> &ldquo;{booking.rejection_reason}&rdquo;. Those
                            dates are free again.
                          </Alert>
                        )}
                      </StayEntry>
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

                {!loading && bookings.length > 0 && (
                  <p className="ledger-summary">
                    <span className="guest-num">{stats.total}</span>{' '}
                    {stats.total === 1 ? 'stay' : 'stays'} on this account
                    {stats.future > 0 && (
                      <>
                        , <span className="guest-num">{stats.future}</span> coming up
                      </>
                    )}
                    {stats.pending > 0 ? (
                      <>
                        , <span className="guest-num">{stats.pending}</span> waiting on the Hacienda.
                      </>
                    ) : (
                      '.'
                    )}
                  </p>
                )}
              </div>

          </section>

          <Flyleaf name={fullName} email={user?.email} memberSince={profile?.created_at} />
        </div>
      </Container>

      <Drawer
        open={notificationSidebarOpen}
        onClose={() => setNotificationSidebarOpen(false)}
        title="Notifications"
        description="Booking decisions and messages from the Admin."
        headerAction={
          unreadCount > 0 ? (
            <button type="button" onClick={() => void markAllRead()} className="text-xs text-link text-forest-700">
              Mark all read
            </button>
          ) : undefined
        }
      >
        {notifications.length === 0 ? (
          <p className="px-1 py-8 text-sm leading-relaxed text-forest-700">
            Nothing yet. Decisions about your bookings and messages from the Admin appear here.
          </p>
        ) : (
          <ul className="space-y-3">
            {notifications.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => void handleMarkRead(n.id)}
                  className={`w-full rounded-[12px] border p-4 text-left text-xs transition hover:border-forest-900/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-forest-600 dark:focus-visible:ring-brass-400 ${
                    n.read
                      ? 'border-forest-900/10 bg-white text-forest-800 dark:border-cream-100/10 dark:bg-forest-900/60'
                      : 'border-emerald-200 bg-emerald-50/70 font-medium text-emerald-950'
                  }`}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="text-sm font-bold text-forest-900">{n.title}</span>
                    {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-label="Unread" />}
                  </span>
                  <span className="mt-2 block leading-relaxed">{n.message}</span>
                  <span className="mt-3 block text-[11px] text-forest-600/90">
                    {new Date(n.created_at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Drawer>

      <ConfirmDialog
        open={confirmingWithdraw !== null}
        danger
        title="Withdraw this request?"
        body={
          confirmingWithdraw
            ? `Request ${bookingReference(confirmingWithdraw)} for ${accommodationName(
                confirmingWithdraw.accommodation,
              )} (${confirmingWithdraw.check_in} → ${confirmingWithdraw.check_out}) will be cancelled and those dates released for other Guests. The Admin cannot undo this from their own app.\n\nNo money has been verified on a pending request, so nothing is charged and nothing is refunded.`
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

      <ConfirmDialog
        open={confirmingCancel !== null}
        danger
        title="Cancel this booking?"
        body={
          confirmingCancel
            ? `${bookingReference(confirmingCancel)} for ${accommodationName(confirmingCancel.accommodation)} (${confirmingCancel.check_in} → ${confirmingCancel.check_out}). The dates are released and this cannot be undone.\n\n${cancellationTerms(confirmingCancel)}`
            : ''
        }
        confirmLabel="Cancel booking"
        cancelLabel="Keep it"
        busy={busy === confirmingCancel?.id}
        onCancel={() => setConfirmingCancel(null)}
        onConfirm={() => {
          if (confirmingCancel) void withdraw(confirmingCancel, 'cancel')
        }}
      />

      <Modal open={viewingInvoice !== null} onClose={() => setViewingInvoice(null)} title="Booking invoice">
        {viewingInvoice && <BookingInvoice booking={viewingInvoice} onClose={() => setViewingInvoice(null)} />}
      </Modal>
    </Page>
  )
}
