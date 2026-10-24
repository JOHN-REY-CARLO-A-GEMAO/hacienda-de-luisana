import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ROLE_LABELS } from '../lib/auth'
import { effectiveStatus } from '../lib/booking'
import { cloudBookingsDB } from '../lib/firestoreBookings'
import { formatStayDuration, type Booking } from '../lib/storage'
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
import { isReviewableStatus } from '../lib/reviewPolicy'
import { Calendar, Sparkle, Bell, Clock, CreditCard, Home, LogOut, User } from '../lib/icons'
import { Alert, Container, Drawer, EmptyState, Field, Input, Modal, Page, Select, SkeletonLines, StatCard, StatusBadge, Tabs } from '../components/ui'
import {
  AccountRail,
  BookingFolio,
  HelpPanel,
  RailFacts,
  RailPanel,
  StayMasthead,
  accommodationName,
  bookingReference,
  daysUntil,
  peso,
} from '../components/Account'
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

  const greeting = profile?.display_name || user?.displayName || 'Your stay at the Hacienda'

  return (
    <Page className="guest-ground">
      {/* The one loud element on the page: the stay that is coming, on the
          Hacienda's own photograph. Everything below it is a quiet document. */}
      <Container width="wide">
        <StayMasthead
          booking={nextStay}
          greeting={greeting}
          roleLabel={role ? ROLE_LABELS[role] : 'Guest'}
          hasBookings={bookings.length > 0}
          email={user?.email}
          memberSince={profile?.created_at}
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
                  <span className="guest-num rounded-full bg-cream-50/25 px-1.5 py-0.5 text-[11px] font-bold leading-none text-cream-50">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
              <Link to="/book" className="btn-on-dark btn-sm">
                Book a stay
              </Link>
            </>
          }
        />
      </Container>

      <Container width="wide" className="mt-8">
        <Tabs
          label="Account sections"
          value={activeTab}
          onChange={setActiveTab}
          items={[
            { key: 'bookings', label: 'My bookings', meta: String(bookings.length) },
            { key: 'profile', label: 'My profile' },
          ]}
        />

        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          {/* ---------------------------------------------------------- */}
          {/* Bookings                                                    */}
          {/* ---------------------------------------------------------- */}
          {activeTab === 'bookings' ? (
            <div className="min-w-0">
              {notice && (
                <Alert tone={notice.tone === 'good' ? 'success' : 'danger'} className="mb-5">
                  {notice.text}
                </Alert>
              )}

              {loading && (
                <div className="guest-panel p-6" role="status" aria-live="polite">
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
                <div className="guest-panel flex flex-col gap-2 p-2.5 sm:flex-row sm:items-center" data-tour="account-tools">
                  <Input
                    className="text-sm sm:flex-1"
                    placeholder="Search bookings"
                    aria-label="Search bookings"
                    value={q}
                    maxLength={80}
                    onChange={(e) => {
                      setQ(e.target.value)
                      setPage(1)
                    }}
                  />
                  <div className="flex gap-2">
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
                </div>
              )}

              <div className="mt-5 space-y-5">
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
                  return (
                    <BookingFolio
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

                          {!WITHDRAWABLE.includes(status) && !CANCELLABLE.includes(status) && status !== 'Cancelled' && status !== 'Rejected' && (
                            <span className="flex items-center gap-1.5 text-[11px] text-forest-600 dark:text-sage-400">
                              <Sparkle size={12} aria-hidden="true" /> Contact the Admin to change dates
                            </span>
                          )}
                        </div>
                      }
                      trailing={
                        <>
                          <BookingHistory bookingId={booking.id} />

                          {['Checked-Out', 'Completed'].includes(status) && user?.uid && (
                            <div data-testid="review-entry" className="mt-4">
                              {isReviewableStatus(status) && (
                                <p className="mb-2 text-sm text-forest-800 dark:text-cream-100">
                                  <strong className="font-medium">Your stay is complete.</strong> How was it?
                                </p>
                              )}
                              <ReviewForm bookingId={booking.id} uid={user.uid} bookingStatus={status} />
                            </div>
                          )}
                        </>
                      }
                    >
                      <HoldCountdown booking={booking} />

                      {/* Money and stay extensions are forms, not buttons: they
                          belong in the document's body, not in its action bar. */}
                      {can('booking:update:own') && ['Payment Pending', 'Reserved'].includes(status) && (
                        <PaymentStep booking={booking} />
                      )}

                      {['Approved', 'Reserved', 'Checked-In', 'Staying'].includes(status) && (
                        <LateCheckoutRequest booking={booking} />
                      )}

                      {booking.rejection_reason && (
                        <Alert tone="danger" className="text-xs">
                          <strong>Admin declined:</strong> &ldquo;{booking.rejection_reason}&rdquo;. Those dates are
                          free again.
                        </Alert>
                      )}
                    </BookingFolio>
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
          ) : (
            /* -------------------------------------------------------- */
            /* Profile                                                   */
            /* -------------------------------------------------------- */
            <div className="min-w-0">
              <section className="guest-panel px-5 py-6 sm:px-7">
                <h2 className="font-serif text-2xl text-forest-900 dark:text-cream-50">
                  Personal information
                </h2>
                <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-forest-800/80 dark:text-cream-100/75">
                  Keep your contact details current so the Admin can reach you about your stay.
                </p>

                {profileMsg && (
                  <Alert tone={profileMsg.tone === 'good' ? 'success' : 'danger'} className="mt-5">
                    {profileMsg.text}
                  </Alert>
                )}

                <form onSubmit={handleSaveProfile} className="mt-6 space-y-5">
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
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

                  <div className="guest-rule -mx-5 mt-6 flex flex-wrap items-center justify-between gap-3 px-5 pt-5 sm:-mx-7 sm:px-7">
                    <button type="submit" disabled={profileSaving} className="btn-primary">
                      {profileSaving ? 'Saving…' : 'Save changes'}
                    </button>
                    <button type="button" onClick={() => void logout()} className="btn-ghost">
                      <LogOut size={16} aria-hidden="true" />
                      Sign out
                    </button>
                  </div>
                </form>
              </section>
            </div>
          )}

          {/* ---------------------------------------------------------- */}
          {/* The rail                                                    */}
          {/* ---------------------------------------------------------- */}
          <AccountRail>
            <RailPanel title={activeTab === 'bookings' ? 'Your bookings' : 'Your account'}>
              {activeTab === 'bookings' ? (
                <>
                  <StatCard label="Total bookings" value={stats.total} icon={Calendar} />
                  <StatCard label="Waiting on the Hacienda" value={stats.pending} icon={Clock} tone="pending" />
                  <StatCard label="Coming up in 30 days" value={stats.upcoming} icon={Home} tone="success" />
                </>
              ) : (
                <RailFacts
                  icon={User}
                  rows={[
                    { label: 'Name', value: profile?.display_name || user?.displayName || '—' },
                    { label: 'Phone', value: profile?.phone || 'Not saved yet' },
                    {
                      label: 'Role',
                      value: role ? ROLE_LABELS[role] : 'Guest',
                    },
                  ]}
                />
              )}
            </RailPanel>

            {nextStay && (
              <RailPanel
                title="Next stay"
                footer={
                  <button
                    type="button"
                    onClick={() => setViewingInvoice(nextStay)}
                    className="btn-quiet btn-sm w-full"
                  >
                    <CreditCard size={14} aria-hidden="true" />
                    View invoice
                  </button>
                }
              >
                <RailFacts
                  rows={[
                    { label: 'Accommodation', value: accommodationName(nextStay.accommodation) },
                    {
                      label: 'Dates',
                      value: (
                        <span className="guest-num">
                          {nextStay.check_in} → {nextStay.check_out}
                        </span>
                      ),
                    },
                    { label: 'Length', value: formatStayDuration(nextStay.check_in, nextStay.check_out) },
                    { label: 'Guests', value: <span className="guest-num">{nextStay.guests}</span> },
                    ...(typeof nextStay.amount_claimed === 'number'
                      ? [{ label: 'Downpayment', value: peso(nextStay.amount_claimed) }]
                      : []),
                  ]}
                />
                <div className="mt-3 flex items-center justify-between gap-3">
                  <StatusBadge status={effectiveStatus(nextStay)} />
                  <span className="text-[11px] text-forest-600 dark:text-sage-400">
                    {daysUntil(nextStay.check_in)} day{daysUntil(nextStay.check_in) === 1 ? '' : 's'} away
                  </span>
                </div>
              </RailPanel>
            )}

            <HelpPanel />
          </AccountRail>
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
          <EmptyState compact icon={Bell} title="No notifications yet" body="Decisions about your bookings appear here." />
        ) : (
          <ul className="space-y-3">
            {notifications.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => void handleMarkRead(n.id)}
                  className={`w-full rounded-[14px] border p-4 text-left text-xs transition hover:border-forest-900/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-forest-600 dark:focus-visible:ring-brass-400 ${
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
            ? `${bookingReference(confirmingCancel)} · ${accommodationName(confirmingCancel.accommodation)} (${confirmingCancel.check_in} → ${confirmingCancel.check_out}). The dates are released and this cannot be undone.\n\n${cancellationTerms(confirmingCancel)}`
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
