import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { cloudBookingsDB } from '../../lib/firestoreBookings'
import { formatStayDuration, calculateNights, getStayProgress, type Booking, type BookingStatus } from '../../lib/storage'
import { hasPickup, pickupAge, getProximityStatus } from '../../lib/tracking'
import { ACCOMMODATIONS } from '../../config/site'
import { Screen, ScreenTitle } from '../components/Screen'
import { BookingHistory } from '../../components/Booking/BookingHistory'
import { BookingReview } from '../../components/Booking/BookingReview'
import { useAuth } from '../../hooks/useAuth'
import { effectiveStatus } from '../../lib/booking'
import { Check, Close, Clock, MapPin, Phone, Users, Bed, Sparkle } from '../../lib/icons'

export function AdminBookingsScreen() {
  const [items, setItems] = useState<Booking[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | BookingStatus>('all')
  const [durationFilter, setDurationFilter] = useState<'all' | '1-night' | '2-nights' | '3-plus'>('all')
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null)
  const [notification, setNotification] = useState<string | null>(null)
  const { user } = useAuth()

  // Every decision here is attributed: the Activity log is worth nothing
  // without knowing which Host made it (ticket #11).
  const hostActor = {
    actor: 'host' as const,
    actor_id: user?.uid ?? 'host',
    actor_name: user?.email ?? 'Host',
  }

  // A Date hold that has run out is written down the first time a Host surface
  // sees it, so the Activity log says when the expiry happened instead of only
  // ever showing a Booking that reads as Expired (ticket #12). Reading never
  // rewrites anything (ADR-0002); this is the one place that records it, and it
  // refuses to do it twice.
  const expiryAttempted = useRef<Set<string>>(new Set())
  useEffect(() => {
    for (const b of items) {
      if (expiryAttempted.current.has(b.id)) continue
      if (effectiveStatus(b) !== 'Expired') continue
      expiryAttempted.current.add(b.id)
      void cloudBookingsDB.materialiseExpiry(b.id)
    }
  }, [items])

  useEffect(() => {
    const unsub = cloudBookingsDB.subscribe((list) => {
      setItems(list)
    })
    return () => unsub()
  }, [])

  const update = async (id: string, patch: Partial<Booking>, successNotice?: string) => {
    setBusy(id)
    try {
      await cloudBookingsDB.update(id, patch)
      if (successNotice) {
        setNotification(successNotice)
        setTimeout(() => setNotification(null), 3500)
      }
      if (selectedBooking && selectedBooking.id === id) {
        setSelectedBooking((prev) => (prev ? { ...prev, ...patch } : null))
      }
    } finally {
      setBusy(null)
    }
  }

  // Filter items
  // The modal shows what is stored now, not the card the Host tapped: approving
  // re-checks availability and can move this Booking underneath them.
  const viewedBooking = selectedBooking
    ? items.find((b) => b.id === selectedBooking.id) ?? selectedBooking
    : null

  const filtered = useMemo(() => {
    return items.filter((b) => {
      // Filtering answers the same question the badge does, or the Host filters
      // to "Expired" and gets nothing back.
      if (statusFilter !== 'all' && effectiveStatus(b) !== statusFilter) return false
      const nights = calculateNights(b.check_in, b.check_out)
      if (durationFilter === '1-night' && nights !== 1) return false
      if (durationFilter === '2-nights' && nights !== 2) return false
      if (durationFilter === '3-plus' && nights < 3) return false
      return true
    })
  }, [items, statusFilter, durationFilter])

  const pendingCount = items.filter((b) => effectiveStatus(b) === 'Pending').length
  const reservedCount = items.filter((b) => effectiveStatus(b) === 'Reserved').length

  const getAccommodationName = (accId: string) => {
    return ACCOMMODATIONS.find((a) => a.id === accId)?.name || (accId === 'other' ? 'Custom Accommodation' : accId)
  }

  return (
    <Screen>
      <ScreenTitle eyebrow="App for Client · Inquiries & Approvals" title="Booker Requests">
        <p className="mt-1 text-sm text-forest-800/70">
          Dito papasok ang information mula sa website booker. Kumpirmahin ang reservation at alamin ang tagal ng kanilang stay.
        </p>
      </ScreenTitle>

      {/* Real-time Notification Banner */}
      {notification && (
        <div className="mb-4 rounded-2xl bg-emerald-700 text-cream-50 p-3.5 text-xs font-medium shadow-md flex items-center justify-between animate-fadeIn">
          <div className="flex items-center gap-2">
            <Check size={16} className="text-emerald-200" />
            <span>{notification}</span>
          </div>
          <button onClick={() => setNotification(null)} className="opacity-70 hover:opacity-100">
            <Close size={14} />
          </button>
        </div>
      )}

      {/* Top Quick Status Pill Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-5">
        <div className="bg-white rounded-2xl p-3 border border-forest-900/5 shadow-sm">
          <div className="text-[10px] uppercase tracking-eyebrow text-amber-700">Needs Confirmation</div>
          <div className="font-serif text-2xl text-forest-900 mt-0.5">{pendingCount}</div>
          <div className="text-[10px] text-forest-700/60">bago mula sa booker</div>
        </div>
        <div className="bg-white rounded-2xl p-3 border border-forest-900/5 shadow-sm">
          <div className="text-[10px] uppercase tracking-eyebrow text-emerald-700">Reserved Stays</div>
          <div className="font-serif text-2xl text-forest-900 mt-0.5">{reservedCount}</div>
          <div className="text-[10px] text-forest-700/60">nakareserba na</div>
        </div>
        <div className="col-span-2 sm:col-span-1 bg-forest-900 text-cream-50 rounded-2xl p-3 shadow-sm flex flex-col justify-between">
          <div className="text-[10px] uppercase tracking-eyebrow text-cream-100/60">Live Sharing</div>
          <div className="font-serif text-xl text-emerald-300">
            {items.filter((b) => b.is_live_sharing || hasPickup(b)).length} Booker
          </div>
          <Link to="/app/tracking" className="text-[10px] text-cream-100/80 underline hover:text-white mt-1">
            Tingnan ang radar →
          </Link>
        </div>
      </div>

      {/* Filter Tabs: Status */}
      <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-none">
        {(['all', 'Pending', 'Reserved', 'Completed', 'Cancelled', 'Expired'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition ${
              statusFilter === s
                ? 'bg-forest-800 text-cream-50'
                : 'bg-white border border-forest-900/5 text-forest-700 hover:bg-cream-100'
            }`}
          >
            {s === 'all' ? 'Lahat ng Requests' : s}
            {s === 'Pending' && pendingCount > 0 && (
              <span className="ml-1.5 px-1.5 py-0.2 rounded-full bg-amber-500 text-white text-[10px]">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Filter Tabs: Length of Stay ("kung gaano katagal ang stay ni Booker") */}
      <div className="mt-2.5 flex items-center gap-1.5 overflow-x-auto pb-2 text-xs">
        <span className="text-[10px] uppercase tracking-eyebrow text-forest-600 font-semibold mr-1">
          Stay Duration:
        </span>
        {[
          { id: 'all', label: 'Lahat ng Tagal' },
          { id: '1-night', label: '1 Night (Short)' },
          { id: '2-nights', label: '2 Nights (Weekend)' },
          { id: '3-plus', label: '3+ Nights (Extended)' },
        ].map((f) => (
          <button
            key={f.id}
            onClick={() => setDurationFilter(f.id as any)}
            className={`px-2.5 py-1 rounded-lg text-[11px] whitespace-nowrap transition ${
              durationFilter === f.id
                ? 'bg-forest-900 text-cream-50 font-medium'
                : 'bg-cream-100/70 text-forest-800 hover:bg-cream-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Bookings List */}
      {filtered.length === 0 ? (
        <div className="mt-4 rounded-[22px] bg-white border border-forest-900/5 p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-forest-50 text-forest-700 flex items-center justify-center mx-auto mb-3">
            <Sparkle size={20} />
          </div>
          <div className="font-serif text-xl text-forest-900">Walang natagpuang requests</div>
          <p className="mt-2 text-xs text-forest-800/70 max-w-sm mx-auto">
            Kapag nag-fill up ang isang booker sa Website (/book), kusa itong papasok dito sa Client App nang real-time.
          </p>
          <Link to="/book" className="btn-ghost mt-4 text-xs inline-flex">
            Subukan ang booking form
          </Link>
        </div>
      ) : (
        <div className="mt-4 space-y-3.5">
          {filtered.map((b) => {
            const stayProgress = getStayProgress(b.check_in, b.check_out)
            const nights = calculateNights(b.check_in, b.check_out)
            const prox = b.distance_km ? getProximityStatus(b.distance_km) : null
            // ADR-0002: the Host reads the same status the Guest does, so a hold
            // that ran out shows as Expired here without anybody writing it.
            const readsAs = effectiveStatus(b)
            const isPending = readsAs === 'Pending'

            return (
              <div
                key={b.id}
                className={`rounded-[24px] bg-white border transition-all p-4 shadow-card ${
                  isPending ? 'border-amber-300 ring-1 ring-amber-200' : 'border-forest-900/5'
                }`}
              >
                {/* Booker Header */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-base text-forest-900">{b.guest_name}</span>
                      <span className="text-[10px] font-mono text-forest-600 bg-cream-100 px-2 py-0.5 rounded-full">
                        {b.ref_id || b.id.slice(0, 8).toUpperCase()}
                      </span>
                    </div>
                    <div className="text-xs text-forest-700/75 mt-0.5 flex items-center gap-2">
                      <span>{b.phone}</span>
                      <span>·</span>
                      <span className="truncate max-w-[160px]">{b.email}</span>
                    </div>
                  </div>

                  {/* Status Badge */}
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                      b.status === 'Pending'
                        ? 'bg-amber-50 text-amber-800 border-amber-200'
                        : b.status === 'Reserved'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : b.status === 'Completed'
                        ? 'bg-olive-50 text-olive-800 border-olive-200'
                        : 'bg-red-50 text-red-700 border-red-200'
                    }`}
                  >
                    {b.status}
                  </span>
                </div>

                {/* Length of Stay Highlight Box ("kung gaano katagal ang stay ni Booker") */}
                <div className="mt-3.5 rounded-2xl bg-cream-50/80 border border-forest-900/5 p-3">
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-[10px] uppercase tracking-eyebrow text-forest-600 font-semibold flex items-center gap-1">
                      <Clock size={12} /> Gaano Katagal ang Stay:
                    </span>
                    <span className="font-bold text-forest-900 bg-white px-2.5 py-0.5 rounded-full border border-forest-900/10 shadow-xs">
                      {formatStayDuration(b.check_in, b.check_out)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs text-forest-800 mt-2 pt-2 border-t border-forest-900/5">
                    <div>
                      <span className="text-forest-600 text-[10px] block">Check-in:</span>
                      <span className="font-medium">{b.check_in} (2:00 PM)</span>
                    </div>
                    <div>
                      <span className="text-forest-600 text-[10px] block">Check-out:</span>
                      <span className="font-medium">{b.check_out} (12:00 PM)</span>
                    </div>
                  </div>

                  {/* Active Stay Timer Progress if currently staying */}
                  {readsAs === 'Reserved' && stayProgress.isCurrentStay && (
                    <div className="mt-2.5 pt-2 border-t border-forest-900/5">
                      <div className="flex items-center justify-between text-[11px] text-emerald-800 font-medium">
                        <span>🟢 Kasalukuyang Nanunuluyan (Day {stayProgress.dayNumber} of {stayProgress.totalDays})</span>
                        <span>{stayProgress.hoursRemaining} hrs natitira</span>
                      </div>
                      <div className="w-full bg-forest-900/10 h-1.5 rounded-full mt-1 overflow-hidden">
                        <div
                          className="bg-emerald-600 h-1.5 rounded-full transition-all"
                          style={{ width: `${stayProgress.progressPercent}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Accommodation and Guest Party Details */}
                <div className="mt-3 flex items-center justify-between text-xs text-forest-800">
                  <div className="flex items-center gap-1.5">
                    <Bed size={14} className="text-forest-600" />
                    <span className="font-medium">{getAccommodationName(b.accommodation)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-forest-700">
                    <Users size={14} className="text-forest-600" />
                    <span>{b.guests} Guests</span>
                  </div>
                </div>

                {/* Special Requests (if any) */}
                {b.special_requests && (
                  <div className="mt-2 text-[11px] text-forest-700/80 bg-white/70 rounded-xl p-2 border border-forest-900/5 line-clamp-2">
                    <span className="font-medium text-forest-900">Note: </span>
                    {b.special_requests}
                  </div>
                )}

                {/* Live Location Alert / Booker Proximity */}
                {(b.is_live_sharing || hasPickup(b)) && (
                  <div className="mt-3 rounded-2xl bg-emerald-50/90 border border-emerald-200 p-2.5 text-xs flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                      <div>
                        <div className="font-semibold text-emerald-900 text-[11px]">
                          {prox ? prox.tagalogText : 'Live Location Ibinahagi'}
                        </div>
                        <div className="text-[10px] text-emerald-700">
                          {b.pickup_area || 'On route'} {b.distance_km ? `(${b.distance_km} km away)` : ''} · {pickupAge(b)}
                        </div>
                      </div>
                    </div>
                    <Link
                      to="/app/tracking"
                      className="px-2.5 py-1 rounded-lg bg-emerald-700 text-white text-[10px] font-medium hover:bg-emerald-800 shrink-0"
                    >
                      Bantayan →
                    </Link>
                  </div>
                )}

                {/* Booking Confirmation Actions ("dito din papasok ang confirmation for the booking") */}
                <div className="mt-4 pt-3 border-t border-forest-900/5 flex flex-wrap items-center gap-2 justify-between">
                  <div className="flex items-center gap-2">
                    {/* Review — approval re-checks the dates and can refuse (#13) */}
                    {['Pending', 'KYC Submitted'].includes(readsAs) && (
                      <button
                        onClick={() => setSelectedBooking(b)}
                        className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white shadow-sm flex items-center gap-1.5 transition"
                      >
                        <Check size={14} />
                        I-review (Review)
                      </button>
                    )}

                    {/* Mark as Completed */}
                    {readsAs === 'Reserved' && (
                      <button
                        disabled={busy === b.id}
                        onClick={() => update(b.id, { status: 'Completed' }, `Nai-tag bilang Completed ang stay ni ${b.guest_name}.`)}
                        className="px-3 py-1.5 rounded-xl text-xs font-medium bg-forest-800 hover:bg-forest-900 text-cream-50 disabled:opacity-50 transition"
                      >
                        Mark as Completed
                      </button>
                    )}

                    {/* Cancel / Decline button */}
                    {readsAs !== 'Cancelled' && readsAs !== 'Completed' && readsAs !== 'Expired' && (
                      <button
                        disabled={busy === b.id}
                        onClick={() => update(b.id, { status: 'Cancelled' }, `Nai-cancel ang booking ni ${b.guest_name}.`)}
                        className="px-3 py-1.5 rounded-xl text-xs font-medium bg-white border border-forest-900/10 text-red-700 hover:bg-red-50 disabled:opacity-50 transition"
                      >
                        Kanselahin
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <a
                      href={`tel:${b.phone.replace(/\s+/g, '')}`}
                      className="p-2 rounded-xl bg-cream-100 hover:bg-cream-200 text-forest-800 transition"
                      title="Call Booker"
                    >
                      <Phone size={14} />
                    </a>
                    <button
                      onClick={() => setSelectedBooking(b)}
                      className="px-3 py-1.5 rounded-xl text-xs font-medium bg-cream-100 hover:bg-cream-200 text-forest-800 transition"
                    >
                      Detalye
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Booker Full Details Modal */}
      {viewedBooking && (
        <div
          className="fixed inset-0 z-50 bg-forest-950/70 flex items-center justify-center p-4 backdrop-blur-xs"
          onClick={() => setSelectedBooking(null)}
        >
          <div
            className="bg-white rounded-3xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setSelectedBooking(null)}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-cream-100 text-forest-800"
            >
              <Close size={18} />
            </button>

            <div className="eyebrow">Booker Profile & Stay Information</div>
            <h3 className="font-serif text-2xl text-forest-900 mt-1">{viewedBooking.guest_name}</h3>
            <div className="text-xs text-forest-700/70">{viewedBooking.phone} · {viewedBooking.email}</div>

            {/* Stay Duration Box */}
            <div className="mt-4 rounded-2xl bg-cream-50 p-4 border border-forest-900/10">
              <div className="text-[10px] uppercase tracking-eyebrow text-forest-600 font-semibold">
                Tagal ng Pananatili (Length of Stay)
              </div>
              <div className="font-serif text-xl text-forest-900 mt-0.5">
                {formatStayDuration(viewedBooking.check_in, viewedBooking.check_out)}
              </div>
              <div className="mt-2 text-xs text-forest-800 space-y-1">
                <div>Check-in: <strong>{viewedBooking.check_in} (Standard 2:00 PM)</strong></div>
                <div>Check-out: <strong>{viewedBooking.check_out} (Standard 12:00 PM)</strong></div>
                <div>Kabuuang Gabi: <strong>{calculateNights(viewedBooking.check_in, viewedBooking.check_out)} Night(s)</strong></div>
              </div>
            </div>

            {/* Accommodation and Party */}
            <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <div className="bg-cream-50 rounded-xl p-3">
                <span className="text-[10px] uppercase tracking-eyebrow text-forest-600 block">Accommodation</span>
                <span className="font-semibold text-forest-900">{getAccommodationName(viewedBooking.accommodation)}</span>
              </div>
              <div className="bg-cream-50 rounded-xl p-3">
                <span className="text-[10px] uppercase tracking-eyebrow text-forest-600 block">Bilang ng Bisita</span>
                <span className="font-semibold text-forest-900">{viewedBooking.guests} Guests</span>
              </div>
            </div>

            {/* Special Request */}
            {viewedBooking.special_requests && (
              <div className="mt-4">
                <div className="text-[10px] uppercase tracking-eyebrow text-forest-600">Special Request ng Booker:</div>
                <p className="mt-1 text-xs text-forest-800 bg-cream-50 rounded-xl p-3 leading-relaxed">
                  {viewedBooking.special_requests}
                </p>
              </div>
            )}

            {/* Location Status */}
            <div className="mt-4 rounded-2xl border border-forest-900/10 p-3.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-eyebrow text-forest-600 font-semibold">Live Location Sharing</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] ${viewedBooking.is_live_sharing ? 'bg-emerald-100 text-emerald-800 font-bold' : 'bg-cream-100 text-forest-700'}`}>
                  {viewedBooking.is_live_sharing ? 'Aktibo / Sharing' : 'Hindi pa nag-share'}
                </span>
              </div>
              {viewedBooking.pickup_area && (
                <div className="mt-2 text-forest-900">
                  Kasalukuyang Area: <strong>{viewedBooking.pickup_area}</strong>
                </div>
              )}
              {viewedBooking.distance_km && (
                <div className="text-forest-800 text-[11px] mt-0.5">
                  Layo sa Hacienda: <strong>{viewedBooking.distance_km} km</strong> (Tinatayang {viewedBooking.eta_minutes || 10} mins)
                </div>
              )}
            </div>

            {/* Activity Log — who changed this, and when (ticket #11) */}
            <BookingHistory bookingId={viewedBooking.id} />

            {/* Host review — read the ID, approve or refuse through the lifecycle (#13) */}
            <div className="mt-6">
              <BookingReview booking={viewedBooking} bookings={items} actor={hostActor} />
            </div>

            {/* Actions Inside Modal */}
            <div className="mt-4 pt-4 border-t border-forest-900/10 flex flex-wrap gap-2 justify-end">
              <a
                href={`tel:${viewedBooking.phone.replace(/\s+/g, '')}`}
                className="btn-ghost text-xs inline-flex items-center gap-1.5"
              >
                <Phone size={13} /> Tawagan si Booker
              </a>
            </div>
          </div>
        </div>
      )}
    </Screen>
  )
}
