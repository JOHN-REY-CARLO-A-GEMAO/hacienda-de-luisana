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
import { ArrowRight, Calendar, Sparkle, Close, Bell, User, CheckCircle, Clock, XCircle, CreditCard, Home, MessageCircle, LogOut, Settings } from '../lib/icons'
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

function statusChip(status: ReturnType<typeof effectiveStatus>) {
  if (status === 'Approved' || status === 'Reserved') return 'bg-emerald-100 text-emerald-800'
  if (status === 'Pending') return 'bg-amber-100 text-amber-800'
  if (status === 'Rejected' || status === 'Expired' || status === 'Cancelled') return 'bg-red-100 text-red-700'
  return 'bg-cream-100 text-forest-700'
}

function statusIcon(status: ReturnType<typeof effectiveStatus>) {
  if (status === 'Approved' || status === 'Reserved') return <CheckCircle size={16} />
  if (status === 'Pending') return <Clock size={16} />
  if (status === 'Rejected' || status === 'Expired' || status === 'Cancelled') return <XCircle size={16} />
  return <Sparkle size={16} />
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
    <div className="pt-28 pb-24 bg-cream-50 min-h-screen">
      <div className="mx-auto max-w-5xl px-5 lg:px-8">
        {/* Header with Profile Summary */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-forest-900 to-forest-700 flex items-center justify-center text-white text-2xl font-bold shadow-lg">
              {profile?.display_name?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || 'G'}
            </div>
            <div>
              <div className="eyebrow">Your stay · {role ? ROLE_LABELS[role] : 'Guest'}</div>
              <h1 className="display text-4xl sm:text-5xl mt-1 text-forest-900">
                {profile?.display_name || user?.displayName || 'Guest Account'}
              </h1>
              <p className="mt-1 text-sm text-forest-700/80 max-w-xl leading-relaxed">
                {user?.email} · Member since {profile?.created_at ? new Date(profile.created_at).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }) : 'Today'}
              </p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            <button
              type="button"
              onClick={() => setNotificationSidebarOpen(true)}
              className="btn bg-white border border-forest-900/10 text-forest-800 hover:bg-cream-100 text-xs relative"
            >
              <Bell size={16} className="mr-1.5" />
              Notifications
              {unreadCount > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-red-600 text-white text-[10px] font-bold">
                  {unreadCount}
                </span>
              )}
            </button>
            <Link to="/messages" className="btn-ghost text-xs">
              <MessageCircle size={16} className="mr-1.5" />
              Messages
            </Link>
            <Link to="/book" className="btn-primary text-xs">
              <Home size={16} className="mr-1.5" />
              Book a stay
            </Link>
            <button
              onClick={() => void logout()}
              className="btn bg-white border border-forest-900/10 text-forest-800 hover:bg-cream-100 text-xs"
            >
              <LogOut size={16} className="mr-1.5" />
              Sign out
            </button>
          </div>
        </div>

        {/* Quick Stats Dashboard */}
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl border border-forest-900/5 shadow-sm p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-eyebrow text-forest-600">Total Bookings</div>
                <div className="text-3xl font-bold text-forest-900 mt-1">{stats.total}</div>
              </div>
              <div className="w-10 h-10 rounded-full bg-cream-100 text-forest-700 flex items-center justify-center">
                <Calendar size={20} />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-forest-900/5 shadow-sm p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-eyebrow text-forest-600">Pending Requests</div>
                <div className="text-3xl font-bold text-amber-600 mt-1">{stats.pending}</div>
              </div>
              <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
                <Clock size={20} />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-forest-900/5 shadow-sm p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-eyebrow text-forest-600">Upcoming Stays</div>
                <div className="text-3xl font-bold text-emerald-600 mt-1">{stats.upcoming}</div>
              </div>
              <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                <Home size={20} />
              </div>
            </div>
          </div>
        </div>

        {/* Next Stay Highlight */}
        {nextStay && (
          <div className="mt-6 bg-gradient-to-r from-forest-900 to-forest-800 rounded-2xl shadow-lg p-6 text-white">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <Home size={18} />
                  <span className="text-sm font-semibold text-cream-100">Your Next Stay</span>
                  {daysUntil(nextStay.check_in) > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-200 text-[11px] font-medium">
                      {daysUntil(nextStay.check_in)} day{daysUntil(nextStay.check_in) === 1 ? '' : 's'} away
                    </span>
                  )}
                </div>
                <h3 className="font-serif text-2xl mt-1">{accommodationName(nextStay.accommodation)}</h3>
                <div className="mt-2 text-sm text-cream-100/80">
                  {nextStay.check_in} → {nextStay.check_out} · {formatStayDuration(nextStay.check_in, nextStay.check_out)}
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <span className={`px-3 py-1 rounded-full text-[11px] font-bold ${statusChip(effectiveStatus(nextStay))}`}>
                    {effectiveStatus(nextStay)}
                  </span>
                  {nextStay.amount_claimed && (
                    <span className="text-sm text-cream-100/80">
                      Downpayment: ₱{nextStay.amount_claimed.toLocaleString('en-PH')}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setViewingInvoice(nextStay)}
                  className="btn bg-white/10 hover:bg-white/20 text-white text-xs border-white/20"
                >
                  View Details
                </button>
                <Link to="/messages" className="btn bg-white/10 hover:bg-white/20 text-white text-xs border-white/20">
                  Contact Admin
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Account Center Tabs */}
        <div className="mt-8 flex gap-3 border-b border-forest-900/10 pb-1">
          <button
            type="button"
            onClick={() => setActiveTab('bookings')}
            className={`px-4 py-2 text-sm font-semibold rounded-t-xl transition ${
              activeTab === 'bookings'
                ? 'bg-forest-900 text-white shadow-sm'
                : 'text-forest-700 hover:bg-cream-100'
            }`}
          >
            My Bookings ({bookings.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            className={`px-4 py-2 text-sm font-semibold rounded-t-xl transition ${
              activeTab === 'profile'
                ? 'bg-forest-900 text-white shadow-sm'
                : 'text-forest-700 hover:bg-cream-100'
            }`}
          >
            My Profile
          </button>
        </div>

        {/* Notification Sidebar */}
        {notificationSidebarOpen && (
          <>
            <div
              className="fixed inset-0 bg-forest-950/50 backdrop-blur-sm z-40"
              onClick={() => setNotificationSidebarOpen(false)}
            />
            <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 overflow-y-auto">
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="font-serif text-2xl text-forest-900">Notifications</h2>
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={() => void markAllRead()}
                      className="text-xs underline text-forest-700 hover:text-forest-900"
                    >
                      Mark all read
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setNotificationSidebarOpen(false)}
                    className="text-forest-600 hover:text-forest-900 p-1"
                    aria-label="Close notifications"
                  >
                    <Close size={24} />
                  </button>
                </div>
                {notifications.length === 0 ? (
                  <div className="text-center py-12">
                    <Bell size={48} className="mx-auto text-forest-300 mb-4" />
                    <p className="text-sm text-forest-700/70">No notifications yet.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {notifications.map((n) => (
                      <div
                        key={n.id}
                        className={`p-4 rounded-2xl border text-xs transition cursor-pointer hover:shadow-md ${
                          n.read ? 'bg-cream-50/50 border-forest-900/5 text-forest-800' : 'bg-emerald-50/60 border-emerald-200 text-emerald-950 font-medium'
                        }`}
                        onClick={() => void handleMarkRead(n.id)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-bold text-sm text-forest-900">{n.title}</div>
                          {!n.read && (
                            <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0 mt-1.5" />
                          )}
                        </div>
                        <p className="mt-2 text-xs leading-relaxed">{n.message}</p>
                        <div className="mt-3 text-[10px] text-forest-600/70">
                          {new Date(n.created_at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {activeTab === 'profile' && (
          <div className="mt-8 bg-white rounded-[28px] border border-forest-900/5 shadow-card p-6 sm:p-8 max-w-2xl">
            <div className="flex items-start gap-6 mb-6">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-forest-900 to-forest-700 flex items-center justify-center text-white text-3xl font-bold shadow-lg flex-shrink-0">
                {profile?.display_name?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || 'G'}
              </div>
              <div>
                <h2 className="font-serif text-2xl text-forest-900">{profile?.display_name || user?.displayName || 'Guest'}</h2>
                <p className="mt-1 text-sm text-forest-700/80">{user?.email}</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${role === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-cream-100 text-forest-700'}`}>
                    {role ? ROLE_LABELS[role] : 'Guest'}
                  </span>
                  {profile?.created_at && (
                    <span className="text-[10px] text-forest-600">
                      Since {new Date(profile.created_at).toLocaleDateString('en-PH', { month: 'short', year: 'numeric' })}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <hr className="border-forest-900/10 my-6" />

            <h3 className="font-serif text-xl text-forest-900">Personal Information</h3>
            <p className="mt-1 text-sm text-forest-700/80">
              Keep your contact details up to date so the Admin can easily reach you regarding your stay.
            </p>

            {profileMsg && (
              <div
                className={`mt-4 rounded-xl border p-3.5 text-xs font-medium ${
                  profileMsg.tone === 'good'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-red-50 border-red-200 text-red-800'
                }`}
              >
                {profileMsg.text}
              </div>
            )}

            <form onSubmit={handleSaveProfile} className="mt-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className="label">First Name *</span>
                  <input
                    className="field"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                    placeholder="First Name"
                  />
                </label>
                <label className="block">
                  <span className="label">Last Name *</span>
                  <input
                    className="field"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                    placeholder="Last Name"
                  />
                </label>
              </div>

              <label className="block">
                <span className="label">Middle Name (optional)</span>
                <input
                  className="field"
                  value={middleName}
                  onChange={(e) => setMiddleName(e.target.value)}
                  placeholder="Middle Name"
                />
              </label>

              <label className="block">
                <span className="label">Mobile Phone Number *</span>
                <input
                  className="field"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  placeholder="09171234567"
                />
                <span className="text-[11px] text-forest-600 mt-1 block">
                  Philippine mobile format: 09XX XXX XXXX
                </span>
              </label>

              <label className="block">
                <span className="label">Date of Birth (optional)</span>
                <input
                  className="field"
                  type="date"
                  value={birthdate}
                  onChange={(e) => setBirthdate(e.target.value)}
                />
              </label>

              <label className="block">
                <span className="label">Email Address</span>
                <input
                  className="field bg-cream-50/50 cursor-not-allowed"
                  value={user?.email ?? ''}
                  disabled
                />
                <span className="text-[11px] text-forest-600 mt-1 block">
                  Email address cannot be changed directly.
                </span>
              </label>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={profileSaving}
                  className="btn-primary text-xs disabled:opacity-60"
                >
                  {profileSaving ? 'Saving Changes…' : 'Save Profile Changes'}
                </button>
              </div>
            </form>
          </div>
        )}

        {activeTab === 'bookings' && (
          <>
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
              <div className="mt-10 rounded-[28px] bg-white border border-forest-900/5 shadow-card p-12 text-center">
                <div className="mx-auto w-20 h-20 rounded-full bg-gradient-to-br from-cream-100 to-cream-200 text-forest-700 flex items-center justify-center mb-6">
                  <Home size={32} />
                </div>
                <h2 className="font-serif text-2xl text-forest-900">No bookings on this account yet</h2>
                <p className="mt-3 text-sm text-forest-700/80 max-w-md mx-auto leading-relaxed">
                  A request only shows up here if it was made while you were signed in with this account. Requests made
                  before you signed up stay with the browser that made them — ask the Admin and they will find it by name.
                </p>
                <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
                  <Link to="/book" className="btn-primary text-xs">
                    <Home size={16} className="mr-1.5" />
                    Book your first stay
                  </Link>
                  <Link to="/book" className="btn-ghost text-xs">
                    Browse accommodations
                  </Link>
                </div>
              </div>
            )}

            {!loading && bookings.length > 0 && (
              <div className="mt-8 grid sm:grid-cols-3 gap-3" data-tour="account-tools">
                <input
                  className="field text-sm"
                  placeholder="Search bookings"
                  aria-label="Search bookings"
                  value={q}
                  maxLength={80}
                  onChange={(e) => {
                    setQ(e.target.value)
                    setPage(1)
                  }}
                />
                <select
                  className="field text-sm"
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
                </select>
                <select
                  className="field text-sm"
                  aria-label="Sort bookings"
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as typeof sortKey)}
                >
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
                const days = daysUntil(booking.check_in)
                return (
                  <article
                    key={booking.id}
                    className="rounded-[28px] bg-white border border-forest-900/5 shadow-card overflow-hidden hover:shadow-lg transition-shadow"
                    data-tour="booking-card"
                  >
                    {/* Card Header */}
                    <div className="bg-gradient-to-r from-cream-50 to-white px-6 py-4 border-b border-forest-900/5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${statusChip(status)}`}>
                            {statusIcon(status)}
                          </div>
                          <div>
                            <div className="eyebrow text-forest-600">Request {reference(booking)}</div>
                            <h2 className="font-serif text-xl text-forest-900 mt-0.5">
                              {accommodationName(booking.accommodation)}
                            </h2>
                          </div>
                        </div>
                        <span
                          className={`px-3 py-1.5 rounded-full text-[11px] font-bold flex items-center gap-1.5 ${statusChip(status)}`}
                        >
                          {statusIcon(status)}
                          {status}
                        </span>
                      </div>
                    </div>

                    {/* Card Body */}
                    <div className="p-6">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                        <div>
                          <div className="text-[10px] uppercase tracking-eyebrow text-forest-600">Check-in</div>
                          <div className="font-medium text-forest-900 mt-0.5">{booking.check_in}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-eyebrow text-forest-600">Check-out</div>
                          <div className="font-medium text-forest-900 mt-0.5">{booking.check_out}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-eyebrow text-forest-600">Duration</div>
                          <div className="font-medium text-forest-900 mt-0.5">{formatStayDuration(booking.check_in, booking.check_out)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-eyebrow text-forest-600">Guests</div>
                          <div className="font-medium text-forest-900 mt-0.5">{booking.guests} guest{booking.guests === 1 ? '' : 's'}</div>
                        </div>
                      </div>

                      {days > 0 && days <= 30 && (
                        <div className="mt-4 text-xs text-forest-700 bg-cream-50 rounded-xl px-3 py-2 inline-flex items-center gap-2">
                          <Clock size={14} />
                          {days} day{days === 1 ? '' : 's'} until check-in
                        </div>
                      )}

                      <div className="mt-4">
                        <HoldCountdown booking={booking} />
                      </div>

                      {booking.rejection_reason && (
                        <div className="mt-4 text-xs text-red-800 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                          <strong>Admin declined:</strong> "{booking.rejection_reason}". Those dates are free again.
                        </div>
                      )}
                    </div>

                    {/* Card Footer */}
                    <div className="px-6 py-4 bg-cream-50/50 border-t border-forest-900/5">
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
                            className="btn bg-white border border-forest-900/10 text-forest-800 hover:bg-cream-100 text-xs"
                          >
                            <CreditCard size={14} className="mr-1.5" />
                            Invoice
                          </button>

                          {can('booking:update:own') && CANCELLABLE.includes(status) && (
                            <button
                              onClick={() => setConfirmingCancel(booking)}
                              disabled={busy === booking.id}
                              className="btn-ghost text-xs disabled:opacity-50 text-red-700 hover:bg-red-50"
                            >
                              {busy === booking.id ? 'Cancelling…' : 'Cancel booking'}
                            </button>
                          )}

                          {can('booking:update:own') && WITHDRAWABLE.includes(status) && (
                            <button
                              onClick={() => setConfirmingWithdraw(booking)}
                              disabled={busy === booking.id}
                              className="btn-ghost text-xs disabled:opacity-50 text-red-700 hover:bg-red-50"
                            >
                              {busy === booking.id ? 'Withdrawing…' : 'Withdraw this request'}
                            </button>
                          )}
                        </div>

                        {!WITHDRAWABLE.includes(status) && !CANCELLABLE.includes(status) && status !== 'Cancelled' && status !== 'Rejected' && (
                          <span className="text-[11px] text-forest-600 flex items-center gap-1">
                            <Sparkle size={12} /> Contact Admin to modify dates
                          </span>
                        )}
                      </div>

                      {/* Collapsible Details */}
                      <div className="mt-4 pt-4 border-t border-forest-900/10">
                        <BookingHistory bookingId={booking.id} />

                        {['Checked-Out', 'Completed'].includes(status) && user?.uid && (
                          <div data-testid="review-entry" className="mt-4">
                            {isReviewableStatus(status) && (
                              <p className="text-sm text-forest-800 mb-2">
                                <strong className="font-medium">Your stay is complete!</strong> How was your stay?
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
          </>
        )}

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
