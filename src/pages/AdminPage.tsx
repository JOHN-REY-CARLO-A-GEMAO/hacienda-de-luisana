import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { type Booking, type BookingStatus, calculateNights, formatStayDuration } from '../lib/storage'
import { cloudBookingsDB } from '../lib/firestoreBookings'
import { trackingSessionsDB, type TrackingSession } from '../lib/trackingSessions'
import { directionsUrl, sessionAge } from '../lib/tracking'
import { smartLockDB, DOORS, type SmartLockRecord, type SmartLockAction } from '../lib/smartLockStorage'
import { ACCOMMODATIONS } from '../config/site'
import { BookingHistory } from '../components/Booking/BookingHistory'
import { effectiveStatus } from '../lib/booking'
import { BookingReview } from '../components/Booking/BookingReview'
import { PaymentReview } from '../components/Booking/PaymentReview'
import {
  Calendar,
  Users,
  Sparkle,
  Close,
  Lock,
  Unlock,
  Key,
  Refresh,
  Check,
  MapPin,
  Clock,
  ArrowRight,
  Phone,
} from '../lib/icons'
import { useAuth } from '../hooks/useAuth'
import { getFirebaseStatus } from '../lib/firebase'
import { ROLE_LABELS } from '../lib/auth'
import { TeamPanel } from '../components/Auth/TeamPanel'
import { RatesPanel } from '../components/Admin/RatesPanel'

/**
 * Every status the Host filters by. Intermediate money and review stages are
 * listed, not collapsed: a Booking waiting on payment verification must be
 * findable, not hidden behind Reserved (ticket #14).
 */
const STATUSES: BookingStatus[] = [
  'Pending',
  'KYC Submitted',
  'Approved',
  'Payment Pending',
  'Payment Verified',
  'Reserved',
  'Cancelled',
  'Completed',
]

/** The tabs of the Host dashboard. `team` and `rates` are the Host's alone. */
type AdminTab = 'smartlock' | 'bookings' | 'analytics' | 'team' | 'rates'

function fmtDate(iso: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtTimestamp(iso: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const dateStr = d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
  const timeStr = d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return `${dateStr} · ${timeStr}`
}

function timeAgo(iso: string) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const secs = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function accName(id: string) {
  return ACCOMMODATIONS.find((a) => a.id === id)?.name || (id === 'other' ? 'Other / Ask Us' : id)
}

/** One read of the rule per row, rather than four. */
function statusChip(status: ReturnType<typeof effectiveStatus>): string {
  if (status === 'Reserved' || status === 'Payment Verified') return 'bg-emerald-100 text-emerald-800'
  if (status === 'Pending' || status === 'KYC Submitted' || status === 'Approved') {
    return 'bg-amber-100 text-amber-800'
  }
  if (status === 'Payment Pending') return 'bg-sky-100 text-sky-800'
  if (status === 'Expired' || status === 'Rejected' || status === 'Cancelled') return 'bg-red-100 text-red-700'
  return 'bg-cream-100 text-forest-700'
}

/** Bordered tone for the bookings-table badge, by what the Booking reads as. */
function badgeTone(status: ReturnType<typeof effectiveStatus>): string {
  if (status === 'Reserved' || status === 'Payment Verified') {
    return 'bg-emerald-50 text-emerald-800 border-emerald-200'
  }
  if (status === 'Pending' || status === 'KYC Submitted' || status === 'Approved') {
    return 'bg-amber-50 text-amber-800 border-amber-200'
  }
  if (status === 'Payment Pending') return 'bg-sky-50 text-sky-800 border-sky-200'
  if (status === 'Completed') return 'bg-forest-50 text-forest-800 border-forest-200'
  return 'bg-red-50 text-red-800 border-red-200'
}

export function AdminPage() {
  const [params, setParams] = useSearchParams()
  const initialTab = (params.get('tab') as AdminTab) || 'smartlock'
  const [activeTab, setActiveTab] = useState<AdminTab>(initialTab)

  const { user, logout, isConfigured, role, can, actor: sessionActor } = useAuth()
  const [bookings, setBookings] = useState<Booking[]>([])
  const [smartLockRecords, setSmartLockRecords] = useState<SmartLockRecord[]>([])
  const [loading, setLoading] = useState(true)

  // Smart lock filters
  const [doorFilter, setDoorFilter] = useState<string>('all')
  const [actionFilter, setActionFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [simMessage, setSimMessage] = useState<string | null>(null)
  const [isSimulating, setIsSimulating] = useState(false)

  // Booking filters
  const [bookingFilter, setBookingFilter] = useState<'All' | BookingStatus>('All')
  const [viewingBooking, setViewingBooking] = useState<Booking | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  // Where the Guests are right now: one document per sharing Booking (G6)
  const [sessions, setSessions] = useState<TrackingSession[]>([])

  // Sync tab with URL
  const switchTab = (tab: AdminTab) => {
    setActiveTab(tab)
    setParams({ tab })
  }

  // Subscribe to bookings, live sessions and smart lock records
  useEffect(() => {
    setLoading(true)
    const unsubBookings = cloudBookingsDB.subscribe((list) => {
      setBookings(list)
      setLoading(false)
    })
    const unsubSessions = trackingSessionsDB.subscribe(setSessions)
    const unsubSmartLock = smartLockDB.subscribe((logs) => {
      setSmartLockRecords(logs)
    })
    return () => {
      unsubBookings()
      unsubSessions()
      unsubSmartLock()
    }
  }, [])

  // One session per sharing booking, keyed by the booking id
  const sessionByBooking = useMemo(
    () => new Map(sessions.map((s) => [s.bookingId, s])),
    [sessions],
  )

  // Smart lock stats computation ("naka ilang lock at unlock sila ng pinto")
  const lockStats = useMemo(() => {
    return smartLockDB.getStats(smartLockRecords)
  }, [smartLockRecords])

  // Filtered smart lock records ("kung anong oras")
  const filteredRecords = useMemo(() => {
    return smartLockRecords.filter((rec) => {
      if (doorFilter !== 'all' && rec.door_id !== doorFilter) return false
      if (actionFilter === 'unlock' && rec.action !== 'unlock') return false
      if (actionFilter === 'lock' && rec.action !== 'lock' && rec.action !== 'auto_relock') return false
      if (actionFilter === 'denied' && rec.action !== 'denied' && rec.success) return false
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchName = rec.guest_name.toLowerCase().includes(q)
        const matchRef = rec.ref_id?.toLowerCase().includes(q)
        const matchDoor = rec.door_name.toLowerCase().includes(q)
        const matchRfid = rec.rfid_uid?.toLowerCase().includes(q)
        if (!matchName && !matchRef && !matchDoor && !matchRfid) return false
      }
      return true
    })
  }, [smartLockRecords, doorFilter, actionFilter, searchQuery])

  // Filtered bookings, by what each Booking reads as right now — the read-time
  // rule from ADR-0002, so an expired hold never hides behind a stored Pending.
  const filteredBookings = useMemo(() => {
    if (bookingFilter === 'All') return bookings
    return bookings.filter((b) => effectiveStatus(b) === bookingFilter)
  }, [bookings, bookingFilter])

  // Simulate smart lock actions
  const handleSimulateAction = async (doorId: string, actionType: 'unlock' | 'lock' | 'denied' | 'master') => {
    setIsSimulating(true)
    const door = DOORS.find((d) => d.id === doorId) || DOORS[0]
    const sampleGuest = bookings.find((b) => b.status === 'Reserved') || bookings[0]
    const guestName = sampleGuest?.guest_name || 'Bisita (Live Booker)'
    const refId = sampleGuest?.ref_id || 'HDL-DEMO'

    try {
      if (actionType === 'unlock') {
        await smartLockDB.simulateUnlock(door.id, guestName, refId, 'mobile_key')
        setSimMessage(`🟢 UNLOCK RECORDED: Na-unlock ang "${door.name}" ni ${guestName} (${fmtTimestamp(new Date().toISOString())}). Naka-schedule ang 5s auto-relock!`)
      } else if (actionType === 'lock') {
        await smartLockDB.add({
          door_id: door.id,
          door_name: door.name,
          action: 'lock',
          method: 'admin_remote',
          guest_name: 'Admin / Caretaker',
          reason: 'Manual Remote Lock triggered via Admin Website',
          success: true,
        })
        setSimMessage(`🔵 LOCK RECORDED: Naka-lock na ang "${door.name}" (${fmtTimestamp(new Date().toISOString())}).`)
      } else if (actionType === 'denied') {
        await smartLockDB.simulateDenied(door.id, 'Unregistered Device')
        setSimMessage(`🔴 DENIED ATTEMPT RECORDED: Tanggihang access sa "${door.name}" (${fmtTimestamp(new Date().toISOString())}).`)
      } else if (actionType === 'master') {
        await smartLockDB.simulateMasterOverride(door.id)
        setSimMessage(`🟣 MASTER OVERRIDE RECORDED: Master code ginamit sa "${door.name}" (${fmtTimestamp(new Date().toISOString())}).`)
      }
      setTimeout(() => setSimMessage(null), 7000)
    } finally {
      setIsSimulating(false)
    }
  }

  // Export CSV
  const handleExportCSV = () => {
    const headers = ['Timestamp', 'Door Name', 'Action', 'Guest/Booker', 'Method', 'Reason', 'Success', 'RFID/Ref']
    const rows = filteredRecords.map((r) => [
      `"${r.timestamp}"`,
      `"${r.door_name}"`,
      `"${r.action}"`,
      `"${r.guest_name}"`,
      `"${r.method}"`,
      `"${r.reason.replace(/"/g, '""')}"`,
      `"${r.success ? 'Success' : 'Failed'}"`,
      `"${r.rfid_uid || r.ref_id || ''}"`,
    ])
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n')
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', `smartlock_records_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleUpdateBooking = async (id: string, patch: Partial<Booking>) => {
    if (!can('bookings:cancel:any')) return
    setUpdatingId(id)
    try {
      // The actor goes with the write, so the Activity log names the person who
      // cancelled rather than whoever happens to be reading it later.
      await cloudBookingsDB.update(id, patch, sessionActor ?? undefined)
    } finally {
      setUpdatingId(null)
    }
  }

  const handleDeleteBooking = async (id: string) => {
    if (!can('bookings:delete')) return
    if (!confirm('I-delete ang booking na ito? Hindi na ito mababawi.')) return
    setUpdatingId(id)
    try {
      await cloudBookingsDB.remove(id)
    } finally {
      setUpdatingId(null)
    }
  }

  // The modal must show what is stored now, not the snapshot the Host clicked:
  // approving re-checks availability and can change this Booking under them.
  const viewedBooking = viewingBooking
    ? bookings.find((b) => b.id === viewingBooking.id) ?? viewingBooking
    : null
  const viewedSession = viewedBooking ? sessionByBooking.get(viewedBooking.id) : undefined

  // Every decision here is attributed to the person who made it, in the role the
  // session resolved for them — not in a role this page assumed. A session that
  // is not the Host's cannot produce a Host's approval: the lifecycle refuses it
  // and firestore.rules refuses it again (ticket #11, ADR-0005).
  const hostActor = sessionActor ?? { actor: 'host' as const, actor_id: 'host', actor_name: 'Host' }

  const firebaseStatus = getFirebaseStatus()

  return (
    <div className="pt-24 pb-24 min-h-screen bg-cream-50">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        {/* Top Header */}
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div>
            <div className="eyebrow">Website for Admin · Property Operations</div>
            <h1 className="display text-3xl sm:text-4xl lg:text-5xl mt-2 text-forest-900">
              Admin Control Center
            </h1>
            <p className="mt-2 text-forest-700/80 text-sm max-w-2xl leading-relaxed">
              Dito papasok ang <strong>Smart lock records</strong> kung naka ilang lock at unlock sila ng pinto and kung anong oras, kasama ang pamamahala ng lahat ng bookings mula sa website bookers.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-forest-900 px-3 py-1 text-cream-50">
                Signed in as {role ? ROLE_LABELS[role] : '…'}
                {user?.email ? ` · ${user.email}` : ''}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-emerald-800">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Smart Lock Engine: Online ({DOORS.length} Doors Active)
              </span>
              <span className="rounded-full bg-cream-100 px-3 py-1 text-forest-700">
                {smartLockRecords.length} Lock/Unlock Events Recorded
              </span>
              <span className="rounded-full bg-cream-100 px-3 py-1 text-forest-700">
                {bookings.length} Bookings Synced
              </span>
            </div>
          </div>

          <div className="flex gap-2 flex-wrap items-center">
            <Link
              to="/app"
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-forest-800 text-cream-50 hover:bg-forest-900 shadow-sm flex items-center gap-1.5 transition"
            >
              Buksan ang App for Client →
            </Link>
            <Link to="/book" className="btn-ghost text-xs">
              Website for Bookers
            </Link>
            {user && (
              <button
                onClick={() => logout()}
                className="btn bg-white border border-forest-900/10 text-forest-800 hover:bg-cream-100 text-xs"
              >
                Sign out
              </button>
            )}
          </div>
        </div>

        {/* Simulator Feedback Notification */}
        {simMessage && (
          <div className="mt-6 rounded-2xl bg-emerald-800 text-cream-50 p-4 text-xs font-medium shadow-md flex items-center justify-between animate-fadeIn">
            <div className="flex items-center gap-2">
              <Check size={18} className="text-emerald-300 shrink-0" />
              <span>{simMessage}</span>
            </div>
            <button onClick={() => setSimMessage(null)} className="opacity-70 hover:opacity-100 p-1">
              <Close size={16} />
            </button>
          </div>
        )}

        {/* Navigation Tabs on Admin Website */}
        <div className="mt-8 border-b border-forest-900/10 flex gap-4 sm:gap-8 overflow-x-auto">
          <button
            onClick={() => switchTab('smartlock')}
            className={`pb-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition whitespace-nowrap ${
              activeTab === 'smartlock'
                ? 'border-forest-800 text-forest-900'
                : 'border-transparent text-forest-600 hover:text-forest-900'
            }`}
          >
            <Lock size={16} />
            Smart Lock Records & Door Logs
            <span className="px-2 py-0.5 rounded-full bg-forest-100 text-forest-800 text-[11px]">
              {lockStats.totalUnlocks} unlocks · {lockStats.totalLocks} locks
            </span>
          </button>

          <button
            onClick={() => switchTab('bookings')}
            className={`pb-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition whitespace-nowrap ${
              activeTab === 'bookings'
                ? 'border-forest-800 text-forest-900'
                : 'border-transparent text-forest-600 hover:text-forest-900'
            }`}
          >
            <Calendar size={16} />
            Booking Requests & Approvals
            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px]">
              {bookings.filter((b) => effectiveStatus(b) === 'Pending').length} pending
            </span>
          </button>

          <button
            onClick={() => switchTab('analytics')}
            className={`pb-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition whitespace-nowrap ${
              activeTab === 'analytics'
                ? 'border-forest-800 text-forest-900'
                : 'border-transparent text-forest-600 hover:text-forest-900'
            }`}
          >
            <Clock size={16} />
            Analytics & Length of Stay
          </button>

          {can('team:manage') && (
            <button
              onClick={() => switchTab('team')}
              className={`pb-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition whitespace-nowrap ${
                activeTab === 'team'
                  ? 'border-forest-800 text-forest-900'
                  : 'border-transparent text-forest-600 hover:text-forest-900'
              }`}
            >
              <Users size={16} />
              Team & Roles
            </button>
          )}

          {can('rates:publish') && (
            <button
              onClick={() => switchTab('rates')}
              className={`pb-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition whitespace-nowrap ${
                activeTab === 'rates'
                  ? 'border-forest-800 text-forest-900'
                  : 'border-transparent text-forest-600 hover:text-forest-900'
              }`}
            >
              <Sparkle size={16} />
              Rates & Policy
            </button>
          )}
        </div>

        {/* TAB 1: SMART LOCK RECORDS & DOOR LOGS */}
        {activeTab === 'smartlock' && (
          <div className="mt-8 space-y-8">
            {/* Headline Counters ("kung naka ilang lock at unlock sila ng pinto") */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="rounded-3xl p-5 bg-emerald-700 text-white shadow-card">
                <div className="flex items-center justify-between opacity-90 text-[11px] uppercase tracking-eyebrow font-semibold">
                  <span>Kabuuang Unlocks</span>
                  <Unlock size={18} />
                </div>
                <div className="mt-2 font-serif text-4xl lg:text-5xl">{lockStats.totalUnlocks}</div>
                <div className="mt-1 text-xs text-emerald-100">
                  Naka-unlock ang pinto (RFID / Mobile BLE)
                </div>
              </div>

              <div className="rounded-3xl p-5 bg-forest-900 text-cream-50 shadow-card">
                <div className="flex items-center justify-between opacity-90 text-[11px] uppercase tracking-eyebrow font-semibold">
                  <span>Kabuuang Locks / Relocks</span>
                  <Lock size={18} />
                </div>
                <div className="mt-2 font-serif text-4xl lg:text-5xl">{lockStats.totalLocks}</div>
                <div className="mt-1 text-xs text-cream-100/70">
                  Naka-lock / auto-secured ang pinto
                </div>
              </div>

              <div className="rounded-3xl p-5 bg-white border border-forest-900/5 shadow-card">
                <div className="flex items-center justify-between text-forest-600 text-[11px] uppercase tracking-eyebrow font-semibold">
                  <span>Tanggihang Access (Denied)</span>
                  <span className="text-red-500 font-bold">🚫</span>
                </div>
                <div className="mt-2 font-serif text-4xl lg:text-5xl text-forest-900">
                  {lockStats.totalDenied}
                </div>
                <div className="mt-1 text-xs text-forest-700/60">
                  Maling token, expired key, o hindi rehistrado
                </div>
              </div>

              <div className="rounded-3xl p-5 bg-white border border-forest-900/5 shadow-card">
                <div className="flex items-center justify-between text-forest-600 text-[11px] uppercase tracking-eyebrow font-semibold">
                  <span>Kabuuang Kaganapan (Total Logs)</span>
                  <Sparkle size={18} className="text-forest-600" />
                </div>
                <div className="mt-2 font-serif text-4xl lg:text-5xl text-forest-900">
                  {lockStats.totalEvents}
                </div>
                <div className="mt-1 text-xs text-forest-700/60">
                  Audit trail records na may exact timestamp
                </div>
              </div>
            </div>

            {/* Per-Door Lock and Unlock Breakdown Cards */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-[10px] uppercase tracking-eyebrow text-forest-600 font-semibold">
                    Door-by-Door Breakdown
                  </div>
                  <h3 className="font-serif text-2xl text-forest-900">Ilang Lock at Unlock Kada Pinto?</h3>
                </div>
                <span className="text-xs text-forest-700/60">Real-time status per door</span>
              </div>

              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {DOORS.map((door) => {
                  const dStats = lockStats.perDoor[door.id] || { unlocks: 0, locks: 0, denied: 0 }
                  const totalDoorOps = dStats.unlocks + dStats.locks

                  return (
                    <div
                      key={door.id}
                      className="bg-white rounded-3xl p-5 border border-forest-900/5 shadow-card relative flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-semibold text-forest-900 truncate" title={door.name}>
                            {door.name}
                          </span>
                          <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" title="Lock Online" />
                        </div>
                        <div className="text-[11px] text-forest-700/60 mt-0.5">{door.location}</div>

                        {/* Counts Grid */}
                        <div className="grid grid-cols-2 gap-2 mt-4 text-center">
                          <div className="bg-emerald-50 border border-emerald-200/60 rounded-2xl p-2.5">
                            <span className="text-[10px] uppercase tracking-eyebrow text-emerald-800 font-semibold block">
                              Unlocks
                            </span>
                            <span className="font-serif text-2xl font-bold text-emerald-950">
                              {dStats.unlocks}
                            </span>
                          </div>
                          <div className="bg-forest-50 border border-forest-100 rounded-2xl p-2.5">
                            <span className="text-[10px] uppercase tracking-eyebrow text-forest-700 font-semibold block">
                              Locks
                            </span>
                            <span className="font-serif text-2xl font-bold text-forest-950">
                              {dStats.locks}
                            </span>
                          </div>
                        </div>

                        <div className="mt-3 text-[11px] text-forest-700/70 flex justify-between">
                          <span>Battery: {door.battery}%</span>
                          <span>Signal: {door.signalRssi} dBm</span>
                        </div>
                      </div>

                      {/* Quick Trigger Button for this door */}
                      <button
                        disabled={isSimulating}
                        onClick={() => handleSimulateAction(door.id, 'unlock')}
                        className="mt-4 w-full py-2 rounded-xl text-xs font-semibold bg-cream-100 hover:bg-forest-800 hover:text-cream-50 text-forest-900 transition flex items-center justify-center gap-1.5 disabled:opacity-50"
                      >
                        <Unlock size={13} />
                        Simulate Unlock Door
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Smart Lock Testing & Live Simulation Console */}
            <div className="bg-gradient-to-r from-forest-900 to-forest-950 text-cream-50 rounded-3xl p-6 shadow-card">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="text-[11px] uppercase tracking-eyebrow text-cream-100/60 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    Live Smart Lock Simulator & Hardware Console
                  </div>
                  <h3 className="font-serif text-2xl text-cream-50 mt-1">
                    Subukan ang Pag-lock at Pag-unlock sa Pinto
                  </h3>
                  <p className="mt-1 text-xs text-cream-100/75 max-w-xl">
                    I-click ang mga buttons sa ibaba upang mag-simulate ng aktwal na lock o unlock event. Agad itong papasok sa talaan na may eksaktong oras (exact timestamp).
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    disabled={isSimulating}
                    onClick={() => handleSimulateAction('villa_front', 'unlock')}
                    className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Unlock size={14} />
                    Test Villa Unlock (800ms BLE + 5s Relock)
                  </button>

                  <button
                    disabled={isSimulating}
                    onClick={() => handleSimulateAction('main_entrance', 'unlock')}
                    className="px-3.5 py-2.5 rounded-xl text-xs font-medium bg-cream-50/10 hover:bg-cream-50/20 text-cream-100 transition flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Key size={14} />
                    Test Main Gate RFID Tap
                  </button>

                  <button
                    disabled={isSimulating}
                    onClick={() => handleSimulateAction('casita_a', 'denied')}
                    className="px-3.5 py-2.5 rounded-xl text-xs font-medium bg-red-950/60 hover:bg-red-900/80 text-red-200 border border-red-500/30 transition flex items-center gap-1.5 disabled:opacity-50"
                  >
                    Test Access Denied
                  </button>

                  <button
                    disabled={isSimulating}
                    onClick={() => handleSimulateAction('villa_front', 'master')}
                    className="px-3.5 py-2.5 rounded-xl text-xs font-medium bg-purple-950/60 hover:bg-purple-900/80 text-purple-200 border border-purple-500/30 transition flex items-center gap-1.5 disabled:opacity-50"
                  >
                    Test Master Override
                  </button>
                </div>
              </div>
            </div>

            {/* Smart Lock Detailed Records Table ("kung anong oras") */}
            <div className="bg-white rounded-3xl border border-forest-900/5 shadow-card overflow-hidden">
              <div className="p-5 border-b border-forest-900/5 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="font-serif text-xl text-forest-900">
                    Talaan ng Smart Lock (Audit Trail)
                  </h3>
                  <p className="text-xs text-forest-700/70 mt-0.5">
                    Naka-record ang bawat lock at unlock ng pinto at kung anong eksaktong oras
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Search */}
                  <input
                    type="text"
                    placeholder="Search bisita, ref, RFID…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="px-3 py-1.5 rounded-xl border border-forest-900/10 text-xs text-forest-800 placeholder-forest-700/50 outline-none focus:border-forest-700 w-44 sm:w-56"
                  />

                  {/* Filter by Door */}
                  <select
                    value={doorFilter}
                    onChange={(e) => setDoorFilter(e.target.value)}
                    className="px-3 py-1.5 rounded-xl border border-forest-900/10 text-xs text-forest-800 outline-none focus:border-forest-700 bg-white"
                  >
                    <option value="all">Lahat ng Pinto</option>
                    {DOORS.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>

                  {/* Filter by Action */}
                  <select
                    value={actionFilter}
                    onChange={(e) => setActionFilter(e.target.value)}
                    className="px-3 py-1.5 rounded-xl border border-forest-900/10 text-xs text-forest-800 outline-none focus:border-forest-700 bg-white"
                  >
                    <option value="all">Lahat ng Aksyon</option>
                    <option value="unlock">Unlocks Lamang</option>
                    <option value="lock">Locks Lamang</option>
                    <option value="denied">Denied Lamang</option>
                  </select>

                  {/* Export CSV */}
                  <button
                    onClick={handleExportCSV}
                    className="px-3 py-1.5 rounded-xl bg-cream-100 hover:bg-cream-200 text-forest-800 text-xs font-medium transition"
                  >
                    I-export CSV
                  </button>
                </div>
              </div>

              {/* Table Body */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left min-w-[800px]">
                  <thead>
                    <tr className="bg-cream-50/60 uppercase text-[10px] tracking-eyebrow text-forest-600 border-b border-forest-900/5">
                      <th className="px-5 py-3.5">Oras (Exact Timestamp)</th>
                      <th className="px-5 py-3.5">Aksyon</th>
                      <th className="px-5 py-3.5">Pinto</th>
                      <th className="px-5 py-3.5">Bisita / Booker</th>
                      <th className="px-5 py-3.5">Pamamaraan (Method)</th>
                      <th className="px-5 py-3.5">Dahilan / Resulta</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-forest-900/5">
                    {filteredRecords.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-5 py-10 text-center text-forest-700/60">
                          Walang natagpuang talaan na tumutugma sa filter.
                        </td>
                      </tr>
                    ) : (
                      filteredRecords.map((rec) => {
                        const isUnlock = rec.action === 'unlock'
                        const isLock = rec.action === 'lock' || rec.action === 'auto_relock'
                        const isDenied = rec.action === 'denied' || !rec.success
                        const isMaster = rec.action === 'master_override'

                        return (
                          <tr key={rec.id} className="hover:bg-cream-50/50 transition">
                            {/* Timestamp ("kung anong oras") */}
                            <td className="px-5 py-3.5 whitespace-nowrap">
                              <div className="font-semibold text-forest-900 font-mono text-[11px]">
                                {fmtTimestamp(rec.timestamp)}
                              </div>
                              <div className="text-[10px] text-forest-700/50 mt-0.5">
                                {timeAgo(rec.timestamp)}
                              </div>
                            </td>

                            {/* Action ("naka ilang lock at unlock sila ng pinto") */}
                            <td className="px-5 py-3.5 whitespace-nowrap">
                              <span
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                                  isUnlock
                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                    : isLock
                                    ? 'bg-forest-50 text-forest-800 border-forest-200'
                                    : isMaster
                                    ? 'bg-purple-50 text-purple-800 border-purple-200'
                                    : 'bg-red-50 text-red-800 border-red-200'
                                }`}
                              >
                                {isUnlock && <Unlock size={11} className="text-emerald-600" />}
                                {isLock && <Lock size={11} className="text-forest-700" />}
                                {isDenied && <span>✕</span>}
                                {isMaster && <Key size={11} className="text-purple-600" />}
                                {rec.action.replace('_', ' ').toUpperCase()}
                              </span>
                            </td>

                            {/* Door Name */}
                            <td className="px-5 py-3.5 whitespace-nowrap">
                              <div className="font-medium text-forest-900">{rec.door_name}</div>
                              <div className="text-[10px] text-forest-700/60 font-mono">{rec.door_id}</div>
                            </td>

                            {/* Booker / Guest */}
                            <td className="px-5 py-3.5 whitespace-nowrap">
                              <div className="font-medium text-forest-900">{rec.guest_name}</div>
                              {rec.ref_id && (
                                <div className="text-[10px] text-forest-700/60 font-mono">
                                  Ref: {rec.ref_id}
                                </div>
                              )}
                            </td>

                            {/* Method */}
                            <td className="px-5 py-3.5 whitespace-nowrap">
                              <div className="capitalize text-forest-800">
                                {rec.method === 'mobile_key'
                                  ? '📱 Mobile BLE Key'
                                  : rec.method === 'rfid_card'
                                  ? '💳 RFID Keycard'
                                  : rec.method === 'auto_timer'
                                  ? '⏱️ Auto-relock Timer'
                                  : rec.method === 'master_key'
                                  ? '🔑 Master Override'
                                  : '💻 Admin Remote'}
                              </div>
                              {rec.rfid_uid && (
                                <div className="text-[10px] text-forest-700/50 font-mono">
                                  {rec.rfid_uid}
                                </div>
                              )}
                            </td>

                            {/* Reason / Details */}
                            <td className="px-5 py-3.5 text-forest-800 max-w-xs truncate" title={rec.reason}>
                              {rec.reason}
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Booker Lock Activity Summary */}
            <div className="bg-white rounded-3xl border border-forest-900/5 shadow-card p-6">
              <div className="text-[10px] uppercase tracking-eyebrow text-forest-600 font-semibold">
                Per-Guest Access Tally
              </div>
              <h3 className="font-serif text-xl text-forest-900 mt-0.5">
                Ilang Beses Nag-Lock at Nag-Unlock ang Bawat Booker?
              </h3>
              <p className="text-xs text-forest-700/70 mt-1 mb-4">
                Buod ng smart lock utilization ng bawat guest habang nanunuluyan sa Hacienda:
              </p>

              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {lockStats.perGuest.map((g, i) => (
                  <div key={i} className="p-4 rounded-2xl bg-cream-50/70 border border-forest-900/5 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-bold text-forest-900 text-sm">{g.guest_name}</div>
                      {g.ref_id && <div className="text-[10px] font-mono text-forest-700/60 mt-0.5">{g.ref_id}</div>}
                    </div>
                    <div className="text-right">
                      <div className="text-emerald-800 font-bold">
                        {g.unlocks} unlocks
                      </div>
                      <div className="text-forest-700 font-medium">
                        {g.locks} locks
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: BOOKING MANAGEMENT */}
        {activeTab === 'bookings' && (
          <div className="mt-8 space-y-6">
            <div className="bg-white rounded-3xl border border-forest-900/5 shadow-card overflow-hidden">
              <div className="p-5 border-b border-forest-900/5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-serif text-xl text-forest-900">Website Booker Requests</h2>
                  <p className="text-xs text-forest-700/70">
                    Lahat ng submissions mula sa Website for Bookers (/book)
                  </p>
                </div>
                <div className="flex gap-1 bg-cream-100/70 rounded-full p-1">
                  {(['All', ...STATUSES] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setBookingFilter(s)}
                      className={`px-3 py-1.5 rounded-full text-xs transition ${
                        bookingFilter === s
                          ? 'bg-forest-800 text-cream-50'
                          : 'text-forest-800 hover:bg-white'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {filteredBookings.length === 0 ? (
                <div className="p-12 text-center text-forest-700/60 text-sm">
                  Walang requests sa filter na ito.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[760px]">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-eyebrow text-forest-600 bg-cream-50/50">
                        <th className="px-5 py-3.5">Bisita (Booker)</th>
                        <th className="px-5 py-3.5">Stay Dates & Duration</th>
                        <th className="px-5 py-3.5">Bisita</th>
                        <th className="px-5 py-3.5">Accommodation</th>
                        <th className="px-5 py-3.5">Status</th>
                        <th className="px-5 py-3.5 text-right">Aksyon</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-forest-900/5">
                      {filteredBookings.map((b) => (
                        <tr key={b.id} className="hover:bg-cream-50/50 transition">
                          <td className="px-5 py-4">
                            <div className="font-semibold text-forest-900">{b.guest_name}</div>
                            <div className="text-xs text-forest-700/70">
                              {b.phone} · {b.email}
                            </div>
                            <div className="text-[10px] text-forest-600 font-mono mt-0.5">
                              {b.ref_id || b.id.slice(0, 8).toUpperCase()}
                            </div>
                          </td>
                          <td className="px-5 py-4 text-xs">
                            <div className="font-medium text-forest-900">
                              {b.check_in} → {b.check_out}
                            </div>
                            <div className="text-forest-700/70 font-semibold mt-0.5">
                              {formatStayDuration(b.check_in, b.check_out)}
                            </div>
                          </td>
                          <td className="px-5 py-4 text-xs text-forest-900 font-medium">
                            {b.guests} Bisita
                          </td>
                          <td className="px-5 py-4 text-xs text-forest-800">
                            {accName(b.accommodation)}
                          </td>
                          <td className="px-5 py-4">
                            <span
                              className={`text-[10px] uppercase tracking-eyebrow px-2.5 py-1 rounded-full font-bold border ${badgeTone(effectiveStatus(b))}`}
                            >
                              {effectiveStatus(b)}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-right">
                            <div className="inline-flex gap-1.5">
                              <button
                                onClick={() => setViewingBooking(b)}
                                className="px-2.5 py-1.5 rounded-lg text-xs bg-cream-100 hover:bg-cream-200 text-forest-800 transition"
                              >
                                View
                              </button>
                              {['Pending', 'KYC Submitted'].includes(effectiveStatus(b)) && (
                                <button
                                  onClick={() => setViewingBooking(b)}
                                  className="px-2.5 py-1.5 rounded-lg text-xs bg-emerald-700 hover:bg-emerald-800 text-white font-medium transition"
                                >
                                  Review
                                </button>
                              )}
                              {can('bookings:cancel:any') &&
                                !['Cancelled', 'Completed', 'Expired', 'Rejected'].includes(effectiveStatus(b)) && (
                                <button
                                  onClick={() => handleUpdateBooking(b.id, { status: 'Cancelled' })}
                                  disabled={updatingId === b.id}
                                  className="px-2.5 py-1.5 rounded-lg text-xs bg-white border border-forest-900/10 text-forest-800 hover:bg-cream-100 transition disabled:opacity-50"
                                >
                                  Cancel
                                </button>
                              )}
                              <button
                                onClick={() => handleDeleteBooking(b.id)}
                                hidden={!can('bookings:delete')}
                                disabled={updatingId === b.id}
                                className="px-2 py-1.5 rounded-lg text-xs bg-red-50 text-red-700 border border-red-100 hover:bg-red-100 transition disabled:opacity-50"
                              >
                                Del
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: ANALYTICS & LENGTH OF STAY */}
        {activeTab === 'analytics' && (
          <div className="mt-8 space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="rounded-3xl p-5 bg-forest-900 text-cream-50 shadow-card">
                <div className="text-[10px] uppercase tracking-eyebrow text-cream-100/60">Average Stay Duration</div>
                <div className="mt-2 font-serif text-4xl">
                  {bookings.length > 0
                    ? (
                        bookings.reduce((sum, b) => sum + calculateNights(b.check_in, b.check_out), 0) /
                        bookings.length
                      ).toFixed(1)
                    : '0'}{' '}
                  <span className="text-base font-sans font-normal text-cream-100/70">Nights</span>
                </div>
                <div className="mt-1 text-xs text-cream-100/60">Average nights per reservation</div>
              </div>

              <div className="rounded-3xl p-5 bg-emerald-700 text-white shadow-card">
                <div className="text-[10px] uppercase tracking-eyebrow text-emerald-200">Reserved Stays</div>
                <div className="mt-2 font-serif text-4xl">
                  {bookings.filter((b) => b.status === 'Reserved' || b.status === 'Completed').length}
                </div>
                <div className="mt-1 text-xs text-emerald-100">Out of {bookings.length} requests</div>
              </div>

              <div className="rounded-3xl p-5 bg-white border border-forest-900/5 shadow-card">
                <div className="text-[10px] uppercase tracking-eyebrow text-forest-600">Total Nights Booked</div>
                <div className="mt-2 font-serif text-4xl text-forest-900">
                  {bookings.reduce((sum, b) => sum + calculateNights(b.check_in, b.check_out), 0)}
                </div>
                <div className="mt-1 text-xs text-forest-700/60">Combined nights across guests</div>
              </div>

              <div className="rounded-3xl p-5 bg-white border border-forest-900/5 shadow-card">
                <div className="text-[10px] uppercase tracking-eyebrow text-forest-600">Smart Lock Operations</div>
                <div className="mt-2 font-serif text-4xl text-forest-900">
                  {smartLockRecords.length}
                </div>
                <div className="mt-1 text-xs text-forest-700/60">Unlocks and Locks combined</div>
              </div>
            </div>

            {/* Length of Stay Distribution on Admin */}
            <div className="bg-white rounded-3xl border border-forest-900/5 shadow-card p-6">
              <h3 className="font-serif text-xl text-forest-900 mb-2">
                Haba ng Pananatili (Length of Stay Distribution)
              </h3>
              <p className="text-xs text-forest-700/70 mb-4">
                Detalyadong impormasyon kung gaano katagal ang stay ng bawat booker sa Hacienda de LuisAna:
              </p>

              <div className="space-y-3">
                {bookings.map((b) => {
                  const nights = calculateNights(b.check_in, b.check_out)
                  return (
                    <div
                      key={b.id}
                      className="p-4 rounded-2xl bg-cream-50/70 border border-forest-900/5 flex flex-wrap items-center justify-between gap-3 text-xs"
                    >
                      <div>
                        <div className="font-semibold text-forest-900 text-sm">{b.guest_name}</div>
                        <div className="text-forest-700/70 mt-0.5">
                          {b.check_in} hanggang {b.check_out} ({accName(b.accommodation)})
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="font-bold text-forest-900 bg-white px-3 py-1 rounded-full border border-forest-900/10">
                          {formatStayDuration(b.check_in, b.check_out)}
                        </span>
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            statusChip(effectiveStatus(b))
                          }`}
                        >
                          {effectiveStatus(b)}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: TEAM & ROLES — the Host decides who is Staff */}
        {activeTab === 'team' && can('team:manage') && (
          <div className="mt-8">
            <TeamPanel />
          </div>
        )}

        {/* TAB 5: RATES & POLICY — the figures a payment choice is quoted from (#14) */}
        {activeTab === 'rates' && can('rates:publish') && (
          <div className="mt-8">
            <RatesPanel />
          </div>
        )}
      </div>

      {/* Booking View Modal */}
      {viewedBooking && (
        <div
          className="fixed inset-0 z-50 bg-forest-950/60 flex items-center justify-center p-4"
          onClick={() => setViewingBooking(null)}
        >
          <div
            className="bg-white max-w-lg w-full rounded-3xl p-6 lg:p-8 relative max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setViewingBooking(null)}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-cream-100 text-forest-800"
            >
              <Close size={18} />
            </button>
            <div className="eyebrow">
              Request {viewedBooking.ref_id || viewedBooking.id.slice(0, 8).toUpperCase()}
            </div>
            <h3 className="font-serif text-3xl text-forest-900 mt-2">{viewedBooking.guest_name}</h3>
            <div className="mt-1 text-sm text-forest-700/80">
              {viewedBooking.phone} · {viewedBooking.email}
            </div>

            {/* Length of stay */}
            <div className="mt-5 rounded-2xl bg-cream-50 p-4 border border-forest-900/10">
              <div className="text-[10px] uppercase tracking-eyebrow text-forest-600 font-semibold">
                Tagal ng Pananatili (Length of Stay)
              </div>
              <div className="font-serif text-xl text-forest-900 mt-1">
                {formatStayDuration(viewedBooking.check_in, viewedBooking.check_out)}
              </div>
              <div className="mt-2 text-xs text-forest-800 grid grid-cols-2 gap-2">
                <div>Check-in: <strong>{viewedBooking.check_in} (2:00 PM)</strong></div>
                <div>Check-out: <strong>{viewedBooking.check_out} (12:00 PM)</strong></div>
              </div>
            </div>

            {viewedBooking.special_requests && (
              <div className="mt-4">
                <div className="eyebrow">Special Requests</div>
                <p className="mt-1 text-xs text-forest-800 bg-cream-50 rounded-xl p-3">
                  {viewedBooking.special_requests}
                </p>
              </div>
            )}

            {/* Proximity / Location — the session, where the Guest's phone writes (G6) */}
            {viewedSession && (
              <div className="mt-4 rounded-2xl bg-emerald-50 border border-emerald-200 p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-900">Live Location: </span>
                  <a
                    href={directionsUrl(viewedSession.latitude, viewedSession.longitude)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-800 underline hover:text-emerald-900"
                  >
                    Directions ↗
                  </a>
                </div>
                <span>{viewedSession.area}</span>
                {typeof viewedSession.distance_km === 'number' && (
                  <span className="block mt-0.5 text-emerald-800 font-semibold">
                    {viewedSession.distance_km} km away sa Hacienda
                  </span>
                )}
                <span className="block mt-1 text-emerald-700/80">
                  Update {sessionAge(viewedSession.lastUpdated)} · inihahanap ng Guest {fmtDate(viewedSession.tracking_consent_at)}
                </span>
              </div>
            )}

            {/* Activity Log — who changed this, and when (ticket #11) */}
            <BookingHistory bookingId={viewedBooking.id} />

            {/* Review: read the ID, then approve or refuse through the lifecycle (ticket #13) */}
            <div className="mt-6">
              <BookingReview booking={viewedBooking} bookings={bookings} actor={hostActor} />
            </div>

            {/* Payment: verify the proof into a Reservation, or refuse it (ticket #14) */}
            <div className="mt-4">
              <PaymentReview booking={viewedBooking} actor={hostActor} />
            </div>

            <div className="mt-4 flex gap-2 flex-wrap justify-end">
              {can('bookings:cancel:any') && viewedBooking.status !== 'Cancelled' && (
                <button
                  onClick={() => {
                    handleUpdateBooking(viewedBooking.id, { status: 'Cancelled' })
                    setViewingBooking(null)
                  }}
                  className="btn-ghost text-xs"
                >
                  Cancel Booking
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
