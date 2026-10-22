import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
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
import { Calendar, Sparkle, Bell, Clock, CreditCard, Home, LogOut } from '../lib/icons'
import { Alert, Card, Container, Drawer, EmptyState, Field, Input, Modal, Page, PageHeader, Select, SkeletonLines, StatCard, StatusBadge, StatusIconTile, Tabs } from '../components/ui'
import { useNotifications } from '../hooks/useNotifications'
import { notifyAdmin } from '../lib/notifications'
import {
  composeFullName,
  validateBirthdate,
  validateNamePart,
  validatePhMobile,
} from '../lib/validation'
import { doc, setDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'

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

function accommodationName(id: string) {
  return ACCOMMODATIONS.find((accommodation) => accommodation.id === id)?.name ?? id
}

function daysUntil(dateStr: string): number {
  const checkIn = new Date(dateStr)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  checkIn.setHours(0, 0, 0, 0)
  const diff = checkIn.getTime() - today.getTime()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
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
  const { user, profile, role, can, actor, logout, refresh } = useAuth()
  const [params] = useSearchParams()
  const tabParam = params.get('tab')
  const [activeTab, setActiveTab] = useState<'bookings' | 'profile'>(tabParam === 'profile' ? 'profile' : 'bookings')
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [notificationSidebarOpen, setNotificationSidebarOpen] = useState(tabParam === 'notifications')

  // The header bell and this page open from ?tab=… and also react when it changes.
  useEffect(() => {
    if (tabParam === 'profile') setActiveTab('profile')
    else if (tabParam === 'notifications') setNotificationSidebarOpen(true)
  }, [tabParam])

  // Profile Form state
  const [firstName, setFirstName] = useState(profile?.first_name ?? '')
  const [middleName, setMiddleName] = useState(profile?.middle_name ?? '')
  const [lastName, setLastName] = useState(profile?.last_name ?? '')
  const [phone, setPhone] = useState(profile?.phone ?? '')
  const [birthdate, setBirthdate] = useState(profile?.birthdate ?? '')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMsg, setProfileMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)

  useEffect(() => {
    if (profile) {
      setFirstName(profile.first_name ?? '')
      setMiddleName(profile.middle_name ?? '')
      setLastName(profile.last_name ?? '')
      setPhone(profile.phone ?? '')
      setBirthdate(profile.birthdate ?? '')
    }
  }, [profile])

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setProfileMsg(null)

    if (!user?.uid) return

    const fn = validateNamePart(firstName, 'First name')
    if (!fn.ok) {
      setProfileMsg({ tone: 'bad', text: fn.message })
      return
    }
    const ln = validateNamePart(lastName, 'Last name')
    if (!ln.ok) {
      setProfileMsg({ tone: 'bad', text: ln.message })
      return
    }
    const mn = validateNamePart(middleName, 'Middle name', { required: false, min: 1 })
    if (!mn.ok) {
      setProfileMsg({ tone: 'bad', text: mn.message })
      return
    }
    const ph = validatePhMobile(phone)
    if (!ph.ok) {
      setProfileMsg({ tone: 'bad', text: ph.message })
      return
    }
    if (birthdate.trim()) {
      const bd = validateBirthdate(birthdate)
      if (!bd.ok) {
        setProfileMsg({ tone: 'bad', text: bd.message })
        return
      }
    }

    setProfileSaving(true)
    try {
      const displayName = composeFullName({ first: firstName, middle: middleName, last: lastName })
      const payload = {
        uid: user.uid,
        role: profile?.role ?? 'guest',
        display_name: displayName,
        first_name: firstName.trim(),
        middle_name: middleName.trim() || null,
        last_name: lastName.trim(),
        phone: phone.trim(),
        birthdate: birthdate.trim() || null,
        updated_at: new Date().toISOString(),
      }

      if (db) {
        const profileRef = doc(db, 'profiles', user.uid)
        await setDoc(profileRef, payload, { merge: true })
      } else {
        const key = 'hdl:auth:profiles'
        const local = JSON.parse(localStorage.getItem(key) || '{}')
        local[user.uid] = { ...(local[user.uid] || {}), ...payload }
        localStorage.setItem(key, JSON.stringify(local))
      }

      await refresh()
      setProfileMsg({ tone: 'good', text: 'Your profile details have been saved successfully!' })
    } catch (err: any) {
      setProfileMsg({ tone: 'bad', text: err?.message || 'Failed to update profile.' })
    } finally {
      setProfileSaving(false)
    }
  }
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
                  ? `Booking ${reference(booking)} was cancelled. Those dates are free again.`
                  : `Request ${reference(booking)} was withdrawn. Those dates are free again.`,
            }
          : { tone: 'bad', text: result.reason },
      )
      if (result.ok) {
        void notifyAdmin({
          bookingId: booking.id,
          type: 'cancellation_by_guest',
          title: how === 'cancel' ? 'Guest cancelled a booking' : 'Guest withdrew a request',
          message: `${booking.guest_name} ${how === 'cancel' ? 'cancelled' : 'withdrew'} ${reference(booking)} (${booking.check_in} → ${booking.check_out}).`,
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

  // Calculate stats
  const stats = useMemo(() => {
    const total = bookings.length
    const pending = bookings.filter((b) => effectiveStatus(b) === 'Pending').length
    const upcoming = bookings.filter((b) => {
      const status = effectiveStatus(b)
      const days = daysUntil(b.check_in)
      return (status === 'Approved' || status === 'Reserved' || status === 'Pending') && days > 0 && days <= 30
    }).length
    return { total, pending, upcoming }
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

  return (
    <Page>
      <Container width="content">
        <PageHeader
          eyebrow={`Your stay · ${role ? ROLE_LABELS[role] : 'Guest'}`}
          title={profile?.display_name || user?.displayName || 'Guest account'}
          lead={
            <p>
              {user?.email}
              {profile?.created_at && (
                <>
                  {' '}
                  · Member since{' '}
                  {new Date(profile.created_at).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}
                </>
              )}
            </p>
          }
          actions={
            <>
              <button
                type="button"
                onClick={() => setNotificationSidebarOpen(true)}
                className="btn-quiet"
              >
                <Bell size={16} />
                Notifications
                {unreadCount > 0 && (
                  <span className="ml-0.5 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
              <Link to="/book" className="btn-primary">
                Book a stay
              </Link>
            </>
          }
        />

        {/* The three numbers a Guest actually acts on. Everything else is the list. */}
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <StatCard label="Total bookings" value={stats.total} icon={Calendar} />
          <StatCard label="Pending requests" value={stats.pending} icon={Clock} tone="pending" />
          <StatCard label="Upcoming stays" value={stats.upcoming} icon={Home} tone="success" />
        </div>

        {nextStay && (
          <section className="mt-6 overflow-hidden rounded-[28px] border border-forest-900/20 bg-forest-900 text-cream-100 shadow-soft">
            <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-eyebrow text-cream-100/60">Your next stay</div>
                <h2 className="mt-1 font-serif text-2xl text-cream-50">
                  {accommodationName(nextStay.accommodation)}
                </h2>
                <p className="mt-1 text-sm text-cream-100/80">
                  {nextStay.check_in} → {nextStay.check_out} · {formatStayDuration(nextStay.check_in, nextStay.check_out)}
                  {daysUntil(nextStay.check_in) > 0 && (
                    <span className="ml-2 text-cream-100/60">
                      ({daysUntil(nextStay.check_in)} day{daysUntil(nextStay.check_in) === 1 ? '' : 's'} away)
                    </span>
                  )}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <StatusBadge status={effectiveStatus(nextStay)} />
                  {typeof nextStay.amount_claimed === 'number' && (
                    <span className="text-xs text-cream-100/70">
                      Downpayment ₱{nextStay.amount_claimed.toLocaleString('en-PH')}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewingInvoice(nextStay)}
                className="btn btn-sm shrink-0 border border-cream-100/25 bg-white/10 text-cream-100 hover:bg-white/20"
              >
                View invoice
              </button>
            </div>
          </section>
        )}

        <Tabs
          className="mt-10"
          label="Account sections"
          value={activeTab}
          onChange={setActiveTab}
          items={[
            { key: 'bookings', label: 'My bookings', meta: `(${bookings.length})` },
            { key: 'profile', label: 'My profile' },
          ]}
        />

        {activeTab === 'profile' && (
          <Card padding="lg" className="mt-6 max-w-2xl">
            <h2 className="h3">Personal information</h2>
            <p className="mt-1 text-sm text-forest-700/80">
              Keep your contact details current so the Admin can reach you about your stay.
            </p>

            {profileMsg && (
              <Alert tone={profileMsg.tone === 'good' ? 'success' : 'danger'} className="mt-4">
                {profileMsg.text}
              </Alert>
            )}

            <form onSubmit={handleSaveProfile} className="mt-6 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="First name" required>
                  <Input
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                    placeholder="First name"
                    autoComplete="given-name"
                  />
                </Field>
                <Field label="Last name" required>
                  <Input
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                    placeholder="Last name"
                    autoComplete="family-name"
                  />
                </Field>
              </div>

              <Field label="Middle name" hint="Optional — an initial is enough.">
                <Input
                  value={middleName}
                  onChange={(e) => setMiddleName(e.target.value)}
                  placeholder="Middle name"
                  autoComplete="additional-name"
                />
              </Field>

              <Field label="Mobile phone number" required hint="Philippine mobile format: 09XX XXX XXXX">
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  placeholder="09171234567"
                  inputMode="tel"
                  autoComplete="tel"
                />
              </Field>

              <Field label="Date of birth" hint="Optional.">
                <Input type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} />
              </Field>

              <Field label="Email address" hint="The sign-in address cannot be changed here.">
                <Input value={user?.email ?? ''} disabled />
              </Field>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button type="submit" disabled={profileSaving} className="btn-primary">
                  {profileSaving ? 'Saving…' : 'Save changes'}
                </button>
                <button type="button" onClick={() => void logout()} className="btn-ghost">
                  <LogOut size={16} />
                  Sign out
                </button>
              </div>
            </form>
          </Card>
        )}

        {activeTab === 'bookings' && (
          <div className="mt-6">
            {notice && (
              <Alert tone={notice.tone === 'good' ? 'success' : 'danger'} className="mb-5">
                {notice.text}
              </Alert>
            )}

            {loading && (
              <div className="card mt-6 p-6" role="status" aria-live="polite">
                <span className="sr-only">Reading your bookings…</span>
                <SkeletonLines rows={4} />
              </div>
            )}

            {!loading && bookings.length === 0 && (
              <EmptyState
                icon={Home}
                title="No bookings on this account yet"
                body="A request only shows up here if it was made while you were signed in with this account. Requests made before you signed up stay with the browser that made them — ask the Admin and they will find it by name."
                actions={
                  <>
                    <Link to="/book" className="btn-primary">
                      Book your first stay
                    </Link>
                    <Link to="/stay" className="btn-ghost">
                      Browse accommodations
                    </Link>
                  </>
                }
              />
            )}

            {!loading && bookings.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-3" data-tour="account-tools">
                <Input
                  className="text-sm"
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
                  className="text-sm"
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
                  className="text-sm"
                  aria-label="Sort bookings"
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as typeof sortKey)}
                >
                  <option value="created_at">Newest first</option>
                  <option value="check_in">By check-in date</option>
                  <option value="accommodation">By accommodation</option>
                </Select>
              </div>
            )}

            <div className="mt-6 space-y-5">
              {!loading && bookings.length > 0 && filtered.length === 0 && (
                <EmptyState
                  title="No bookings match those filters"
                  body={`${bookings.length} booking${bookings.length === 1 ? '' : 's'} on this account, none matching${
                    q.trim() ? ` “${q.trim()}”` : ' the selected status'
                  }. Widen the search or choose All statuses.`}
                  actions={
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
                  }
                />
              )}

              {paged.items.map((booking) => {
                const status = effectiveStatus(booking)
                const days = daysUntil(booking.check_in)
                return (
                  <article key={booking.id} className="card overflow-hidden" data-tour="booking-card">
                    <div className="flex items-start justify-between gap-4 border-b border-forest-900/5 px-6 py-4">
                      <div className="flex min-w-0 items-start gap-3">
                        <StatusIconTile status={status} />
                        <div className="min-w-0">
                          <div className="data-label">Request {reference(booking)}</div>
                          <h2 className="mt-0.5 truncate font-serif text-xl text-forest-900">
                            {accommodationName(booking.accommodation)}
                          </h2>
                        </div>
                      </div>
                      <StatusBadge status={status} size="md" />
                    </div>

                    <div className="p-6">
                      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                        {[
                          ['Check-in', booking.check_in],
                          ['Check-out', booking.check_out],
                          ['Duration', formatStayDuration(booking.check_in, booking.check_out)],
                          ['Guests', `${booking.guests} guest${booking.guests === 1 ? '' : 's'}`],
                        ].map(([label, value]) => (
                          <div key={label}>
                            <dt className="data-label">{label}</dt>
                            <dd className="mt-0.5 font-medium text-forest-900">{value}</dd>
                          </div>
                        ))}
                      </dl>

                      {days > 0 && days <= 30 && (
                        <p className="mt-4 inline-flex items-center gap-2 rounded-xl bg-cream-50 px-3 py-2 text-xs text-forest-700">
                          <Clock size={14} />
                          {days} day{days === 1 ? '' : 's'} until check-in
                        </p>
                      )}

                      <div className="mt-4">
                        <HoldCountdown booking={booking} />
                      </div>

                      {booking.rejection_reason && (
                        <Alert tone="danger" className="mt-4 text-xs">
                          <strong>Admin declined:</strong> &ldquo;{booking.rejection_reason}&rdquo;. Those dates are free
                          again.
                        </Alert>
                      )}
                    </div>

                    <div className="border-t border-forest-900/5 bg-cream-50/60 px-6 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap gap-2">
                          {can('booking:update:own') && ['Payment Pending', 'Reserved'].includes(status) && (
                            <PaymentStep booking={booking} />
                          )}

                          {['Approved', 'Reserved', 'Checked-In', 'Staying'].includes(status) && (
                            <LateCheckoutRequest booking={booking} />
                          )}

                          <button
                            type="button"
                            onClick={() => setViewingInvoice(booking)}
                            className="btn-quiet btn-sm"
                          >
                            <CreditCard size={14} />
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

                        {!WITHDRAWABLE.includes(status) && !CANCELLABLE.includes(status) && status !== 'Cancelled' && status !== 'Rejected' && (
                          <span className="flex items-center gap-1 text-[11px] text-forest-600">
                            <Sparkle size={12} /> Contact Admin to modify dates
                          </span>
                        )}
                      </div>

                      <div className="mt-4 border-t border-forest-900/10 pt-4">
                        <BookingHistory bookingId={booking.id} />

                        {['Checked-Out', 'Completed'].includes(status) && user?.uid && (
                          <div data-testid="review-entry" className="mt-4">
                            {isReviewableStatus(status) && (
                              <p className="mb-2 text-sm text-forest-800">
                                <strong className="font-medium">Your stay is complete.</strong> How was it?
                              </p>
                            )}
                            <ReviewForm bookingId={booking.id} uid={user.uid} bookingStatus={status} />
                          </div>
                        )}

                        {user?.uid && (
                          <div className="mt-4">
                            <DisputeForm bookingId={booking.id} guestId={user.uid} />
                          </div>
                        )}
                      </div>
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
          </div>
        )}
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
          <EmptyState compact icon={Bell} title="No notifications yet" body="Decisions about your bookings appear here." />
        ) : (
          <ul className="space-y-3">
            {notifications.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => void handleMarkRead(n.id)}
                  className={`card-tight w-full p-4 text-left text-xs transition hover:shadow-md ${
                    n.read
                      ? 'bg-cream-50/60 text-forest-800'
                      : 'border-emerald-200 bg-emerald-50/60 font-medium text-emerald-950'
                  }`}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="text-sm font-bold text-forest-900">{n.title}</span>
                    {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-label="Unread" />}
                  </span>
                  <span className="mt-2 block leading-relaxed">{n.message}</span>
                  <span className="mt-3 block text-[10px] text-forest-600/70">
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
            ? `Request ${reference(confirmingWithdraw)} for ${accommodationName(
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
            ? `${reference(confirmingCancel)} · ${accommodationName(confirmingCancel.accommodation)} (${confirmingCancel.check_in} → ${confirmingCancel.check_out}). The dates are released and this cannot be undone.\n\n${cancellationTerms(confirmingCancel)}`
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

function reference(booking: Booking) {
  return booking.ref_id || booking.id.slice(0, 8).toUpperCase()
}
