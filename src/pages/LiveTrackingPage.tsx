import { useEffect, useState, useMemo } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { BUSINESS } from '../config/site'
import { cloudBookingsDB } from '../lib/firestoreBookings'
import { trackingSessionsDB, type TrackingSession } from '../lib/trackingSessions'
import type { Booking } from '../lib/storage'
import {
  calculateDistanceKm,
  estimateEtaMinutes,
  getProximityStatus,
  guessAreaFromCoords,
  directionsUrl,
  hotelMapsUrl,
  startLiveLocationWatch,
  getOneTapPosition,
  pickupMapsUrl,
  SIMULATION_CHECKPOINTS,
  HOTEL_LAT,
  HOTEL_LNG,
} from '../lib/tracking'
import { formatStayDuration } from '../lib/storage'
import { useAuth } from '../hooks/useAuth'
import { HoldCountdown } from '../components/Booking/HoldCountdown'
import { KycUpload } from '../components/Booking/KycUpload'
import { MapPin, Navigation, Phone, Messenger, Copy, Check, Sparkle, ArrowRight, Clock } from '../lib/icons'

export function LiveTrackingPage() {
  const [params] = useSearchParams()
  const { user, can } = useAuth()
  const bookingId = params.get('id') || ''
  // The Host and Staff read every Booking; a Guest reads the ones that are
  // theirs. Asking Firestore for the whole collection as a Guest is refused by
  // the rules, so the page never asks — and never shows somebody else's name,
  // phone or location by falling back to "the most recent one".
  const readsAll = can('bookings:read:all')

  const [booking, setBooking] = useState<Booking | null>(null)
  const [loading, setLoading] = useState(true)
  // The session IS the sharing: its existence is the ON state, its consent is
  // the Share click that created it, and deleting it is stopping (G6).
  const [session, setSession] = useState<TrackingSession | null>(null)
  const isSharing = session !== null
  const [currentCoords, setCurrentCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [copied, setCopied] = useState(false)
  const [simActive, setSimActive] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState('')

  // Subscribe to the bookings this person may read
  useEffect(() => {
    const onList = (list: Booking[]) => {
      if (bookingId) {
        const found = list.find((b) => b.id === bookingId || b.ref_id === bookingId)
        if (found) {
          setBooking(found)
        }
      } else if (list.length > 0) {
        // Fallback to most recent booking
        setBooking(list[0])
      }
      setLoading(false)
    }

    const unsub = readsAll
      ? cloudBookingsDB.subscribe(onList)
      : cloudBookingsDB.subscribeMine(user?.uid, onList)
    return () => unsub()
  }, [bookingId, readsAll, user?.uid])

  // Subscribe to the live session. The traveller reads their own; the Host and
  // Staff read every session (their radar), so a Host opening the share link
  // sees the same state the traveller does — but never controls it.
  useEffect(() => {
    if (readsAll) {
      return trackingSessionsDB.subscribe((sessions) => {
        setSession(sessions.find((s) => s.bookingId === bookingId) ?? null)
      })
    }
    return trackingSessionsDB.subscribeMine(user?.uid, (mine) => {
      setSession(mine && mine.bookingId === bookingId ? mine : null)
    })
  }, [bookingId, readsAll, user?.uid])

  // Real GPS live watch while the session exists. Each ping is an update to
  // the session — never a write to the Booking, and never a touch to the
  // consent that started it.
  useEffect(() => {
    if (!isSharing || !booking) return

    setStatusMessage('Live GPS tracking active. Streaming coordinates to Client App...')
    const stopWatch = startLiveLocationWatch(
      async (coords) => {
        const dist = calculateDistanceKm(coords.lat, coords.lng)
        const eta = estimateEtaMinutes(dist)
        const area = guessAreaFromCoords(coords.lat, coords.lng)

        setCurrentCoords({ lat: coords.lat, lng: coords.lng })
        await trackingSessionsDB.update(booking.id, {
          latitude: coords.lat,
          longitude: coords.lng,
          area,
          distance_km: dist,
          eta_minutes: eta,
          lastUpdated: new Date().toISOString(),
          last_speed_kmh: coords.speed ? Math.round(coords.speed * 3.6) : undefined,
        })
      },
      (err) => {
        setStatusMessage(`GPS notice: ${err.message}. You can also use the preset checkpoints below.`)
      },
    )

    return () => {
      stopWatch()
    }
  }, [isSharing, booking?.id])

  // Calculate metrics — from the live watch first, then the session's last ping
  const activeLat = currentCoords?.lat ?? session?.latitude ?? 14.1850
  const activeLng = currentCoords?.lng ?? session?.longitude ?? 121.5150
  const distanceKm = useMemo(() => calculateDistanceKm(activeLat, activeLng), [activeLat, activeLng])
  const etaMinutes = useMemo(() => estimateEtaMinutes(distanceKm), [distanceKm])
  const proximity = useMemo(() => getProximityStatus(distanceKm), [distanceKm])
  const currentArea = session?.area || guessAreaFromCoords(activeLat, activeLng)

  // The traveller's own uid for a new session: their signed-in identity first,
  // the Booking's recorded identity if this link was opened from an older
  // session. The rules refuse a session whose uid is not the writer's own.
  const sessionUid = () => user?.uid ?? booking?.uid ?? ''

  const handleSimulateCheckpoint = async (checkpoint: (typeof SIMULATION_CHECKPOINTS)[0]) => {
    setSimActive(checkpoint.id)
    const dist = calculateDistanceKm(checkpoint.lat, checkpoint.lng)
    const eta = estimateEtaMinutes(dist)
    const now = new Date().toISOString()

    setCurrentCoords({ lat: checkpoint.lat, lng: checkpoint.lng })
    setStatusMessage(`Location updated: ${checkpoint.area}. Client can now see your area in real-time!`)

    if (!booking) return
    if (session) {
      await trackingSessionsDB.update(booking.id, {
        latitude: checkpoint.lat,
        longitude: checkpoint.lng,
        area: checkpoint.area,
        label: checkpoint.label,
        distance_km: dist,
        eta_minutes: eta,
        lastUpdated: now,
      })
    } else {
      // Tapping a checkpoint with no session is itself sharing, so the
      // consent goes in the same write as the position.
      await trackingSessionsDB.create({
        bookingId: booking.id,
        uid: sessionUid(),
        tracking_consent_at: now,
        latitude: checkpoint.lat,
        longitude: checkpoint.lng,
        lastUpdated: now,
        area: checkpoint.area,
        label: checkpoint.label,
        distance_km: dist,
        eta_minutes: eta,
      })
    }
  }

  const handleToggleSharing = async () => {
    if (!booking) return

    if (session) {
      // Stopping the share: the session document is the consent, so deleting
      // it removes the position and the consent together.
      await trackingSessionsDB.remove(booking.id)
      setStatusMessage('Live location sharing paused. The Client can no longer see your route.')
      return
    }

    try {
      setStatusMessage('Locating you — this tap is the consent, and it is stored with your first position…')
      const pos = await getOneTapPosition()
      const dist = calculateDistanceKm(pos.lat, pos.lng)
      const eta = estimateEtaMinutes(dist)
      const now = new Date().toISOString()
      setCurrentCoords({ lat: pos.lat, lng: pos.lng })
      await trackingSessionsDB.create({
        bookingId: booking.id,
        uid: sessionUid(),
        tracking_consent_at: now,
        latitude: pos.lat,
        longitude: pos.lng,
        lastUpdated: now,
        area: guessAreaFromCoords(pos.lat, pos.lng),
        distance_km: dist,
        eta_minutes: eta,
        eta_share_url: pickupMapsUrl(pos.lat, pos.lng),
      })
      setStatusMessage('Live location sharing activated! The Client / Host can now see your route and proximity.')
    } catch (err: any) {
      setStatusMessage(`Sharing did not start: ${err?.message || 'location unavailable'}`)
    }
  }

  const copyShareLink = () => {
    const url = window.location.href
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  if (loading) {
    return (
      <div className="pt-28 pb-20 min-h-screen bg-cream-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-forest-200 border-t-forest-700 rounded-full animate-spin mx-auto" />
          <p className="mt-4 text-sm text-forest-700/70">Connecting to Live Journey Tracker…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="pt-24 pb-20 bg-cream-50 min-h-screen">
      <div className="mx-auto max-w-3xl px-5 lg:px-8">
        {/* Header Breadcrumb */}
        <div className="flex items-center justify-between text-xs text-forest-700/70 mb-4">
          <Link to="/book" className="hover:underline flex items-center gap-1">
            ← Back to Booking
          </Link>
          <span className="font-mono">Ref: {booking?.ref_id || booking?.id.slice(0, 8).toUpperCase() || 'HDL-GUEST'}</span>
        </div>

        {/* Hero Card */}
        <div className="bg-forest-950 text-cream-50 rounded-[28px] p-6 sm:p-8 shadow-card relative overflow-hidden">
          <div className="absolute top-0 right-0 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
          
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[11px] uppercase tracking-eyebrow text-cream-100/60 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Live Sharing Portal for Bookers
            </div>
            <button
              onClick={copyShareLink}
              className="text-xs px-3 py-1.5 rounded-full bg-cream-50/10 hover:bg-cream-50/20 text-cream-100 flex items-center gap-1.5 transition"
            >
              {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
              {copied ? 'Link Copied!' : 'Copy Share Link'}
            </button>
          </div>

          <h1 className="font-serif text-3xl sm:text-4xl text-cream-50 mt-3">
            {booking ? `Kumusta, ${booking.guest_name}!` : 'Live Journey Sharing'}
          </h1>
          <p className="mt-2 text-sm text-cream-100/75 leading-relaxed max-w-xl">
            Ibahagi ang iyong live location sa Hacienda de LuisAna para makita ng Client kung nasaang area ka na o kung malapit ka na sa resort.
          </p>

          {booking && (
            <div className="mt-4 pt-4 border-t border-cream-100/10 flex flex-wrap gap-4 text-xs text-cream-100/80">
              <div>
                <span className="opacity-60 block text-[10px] uppercase tracking-eyebrow">Stay Duration</span>
                <span className="font-medium text-cream-50">{formatStayDuration(booking.check_in, booking.check_out)}</span>
              </div>
              <div>
                <span className="opacity-60 block text-[10px] uppercase tracking-eyebrow">Dates</span>
                <span className="font-medium text-cream-50">{booking.check_in} → {booking.check_out}</span>
              </div>
              <div>
                <span className="opacity-60 block text-[10px] uppercase tracking-eyebrow">Guests</span>
                <span className="font-medium text-cream-50">{booking.guests} Guests</span>
              </div>
            </div>
          )}
        </div>

        {/* Date hold — how long the Guest has left for the Host to review (#12) */}
        {booking && (
          <div className="mt-4">
            <HoldCountdown booking={booking} />
          </div>
        )}

        {/* KYC — the Guest sends their ID from here, not only from the app (#13) */}
        {booking && (
          <div className="mt-3">
            <KycUpload booking={booking} />
          </div>
        )}

        {/* Live Status Banner */}
        <div className="mt-6 bg-white rounded-3xl border border-forest-900/5 shadow-card p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-eyebrow text-forest-600 mb-1">Status ng Pagbiyahe</div>
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs font-semibold px-3 py-1 rounded-full border ${
                    proximity.category === 'malapit_na' || proximity.category === 'arrived'
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200 animate-pulse'
                      : proximity.category === 'on_the_way'
                      ? 'bg-amber-50 text-amber-800 border-amber-200'
                      : 'bg-sky-50 text-sky-800 border-sky-200'
                  }`}
                >
                  {proximity.badgeText}
                </span>
                <span className="text-sm font-medium text-forest-900">{proximity.tagalogText}</span>
              </div>
            </div>

            {readsAll ? (
              <div className="px-5 py-3 rounded-2xl text-xs font-medium bg-cream-100 text-forest-800">
                Host view — sharing is controlled by the Guest on their phone.
              </div>
            ) : (
              <button
                onClick={handleToggleSharing}
                className={`px-5 py-3 rounded-2xl text-sm font-medium transition flex items-center justify-center gap-2 ${
                  isSharing
                    ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-md'
                    : 'bg-forest-800 text-cream-50 hover:bg-forest-900'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${isSharing ? 'bg-white animate-ping' : 'bg-cream-100/50'}`} />
                {isSharing ? 'Live Sharing Naka-ON' : 'Simulan ang Live Sharing'}
              </button>
            )}
          </div>

          {statusMessage && (
            <div className="mt-4 rounded-xl bg-forest-50 border border-forest-100 p-3 text-xs text-forest-800 flex items-center gap-2">
              <Sparkle size={15} className="text-forest-600 shrink-0" />
              <span>{statusMessage}</span>
            </div>
          )}

          {/* Metrics Grid */}
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="bg-cream-50 rounded-2xl p-4">
              <div className="text-[10px] uppercase tracking-eyebrow text-forest-600">Layo sa Hacienda</div>
              <div className="mt-1 font-serif text-2xl sm:text-3xl text-forest-900">
                {distanceKm} <span className="text-base font-sans text-forest-700">km</span>
              </div>
              <div className="text-[11px] text-forest-700/60 mt-0.5">
                {distanceKm <= 5 ? '🟢 Malapit na!' : 'Diretsong biyahe'}
              </div>
            </div>

            <div className="bg-cream-50 rounded-2xl p-4">
              <div className="text-[10px] uppercase tracking-eyebrow text-forest-600">Tinatayang Dating (ETA)</div>
              <div className="mt-1 font-serif text-2xl sm:text-3xl text-forest-900">
                ~{etaMinutes} <span className="text-base font-sans text-forest-700">min</span>
              </div>
              <div className="text-[11px] text-forest-700/60 mt-0.5 flex items-center gap-1">
                <Clock size={12} /> tinatayang oras
              </div>
            </div>

            <div className="col-span-2 sm:col-span-1 bg-cream-50 rounded-2xl p-4">
              <div className="text-[10px] uppercase tracking-eyebrow text-forest-600">Kasalukuyang Area</div>
              <div className="mt-1 font-medium text-sm sm:text-base text-forest-900 truncate" title={currentArea}>
                {currentArea}
              </div>
              <div className="text-[11px] text-forest-700/60 mt-0.5 font-mono">
                {activeLat.toFixed(4)}, {activeLng.toFixed(4)}
              </div>
            </div>
          </div>
        </div>

        {/* Route Visualizer Card */}
        <div className="mt-6 bg-white rounded-3xl border border-forest-900/5 shadow-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-serif text-xl text-forest-900">Live Journey Route</h2>
              <p className="text-xs text-forest-700/70">Mula sa iyong kinalalagyan patungo sa Hacienda de LuisAna</p>
            </div>
            <a
              href={directionsUrl(activeLat, activeLng)}
              target="_blank"
              rel="noreferrer"
              className="text-xs px-3 py-1.5 rounded-lg bg-forest-100 text-forest-900 hover:bg-forest-200 transition flex items-center gap-1 shrink-0"
            >
              <Navigation size={13} />
              Open Maps Navigation ↗
            </a>
          </div>

          {/* Interactive Visual Map / Route Bar */}
          <div className="relative bg-gradient-to-r from-forest-900 via-forest-800 to-emerald-800 rounded-2xl p-6 text-cream-50 overflow-hidden">
            <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:16px_16px]" />
            
            <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-6">
              {/* Booker Location */}
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-emerald-500/30 border border-emerald-400 flex items-center justify-center text-emerald-200 font-bold animate-pulse">
                  📍
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-eyebrow text-emerald-300">Booker Location (Ikaw)</div>
                  <div className="font-semibold text-cream-50 text-sm sm:text-base">{currentArea}</div>
                  <div className="text-xs text-cream-100/70">
                    {distanceKm} km away mula sa Luisiana
                  </div>
                </div>
              </div>

              {/* Progress Line */}
              <div className="hidden md:flex flex-1 items-center px-4">
                <div className="w-full relative">
                  <div className="h-1 bg-cream-50/20 rounded-full w-full" />
                  <div
                    className="h-1 bg-emerald-400 rounded-full absolute top-0 left-0 transition-all duration-500"
                    style={{ width: `${Math.max(10, Math.min(100, Math.round((1 - distanceKm / 80) * 100)))}%` }}
                  />
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-forest-950/80 px-2 py-0.5 rounded-full text-[10px] text-cream-100 border border-cream-100/20">
                    {etaMinutes} mins left
                  </div>
                </div>
              </div>

              {/* Destination */}
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-cream-50 text-forest-900 flex items-center justify-center font-bold shadow-md">
                  🏡
                </div>
                <div className="text-right md:text-left">
                  <div className="text-[10px] uppercase tracking-eyebrow text-cream-100/70">Drop-off Destination</div>
                  <div className="font-semibold text-cream-50 text-sm sm:text-base">{BUSINESS.name}</div>
                  <div className="text-xs text-cream-100/70">Luisiana, Laguna</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Demo Simulation Checkpoints */}
        <div className="mt-6 bg-white rounded-3xl border border-forest-900/5 shadow-card p-6">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="eyebrow text-forest-600">Testing & Demo Simulation</div>
              <h3 className="font-serif text-lg text-forest-900">Subukan ang Live Movement (One-Tap Checkpoints)</h3>
            </div>
            <span className="text-xs px-2.5 py-1 rounded-full bg-cream-100 text-forest-700">Sim Mode</span>
          </div>
          <p className="text-xs text-forest-700/70 mb-4">
            Kung hindi ka pa nagmamaneho, i-tap ang alinman sa mga checkpoints sa ibaba upang i-simulate ang biyahe at makita kung paano ito nagre-reflect sa Client App nang live:
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {SIMULATION_CHECKPOINTS.map((cp) => {
              const cpDist = calculateDistanceKm(cp.lat, cp.lng)
              const isCpNearby = cpDist <= 5
              const isSelected = simActive === cp.id || (Math.abs(activeLat - cp.lat) < 0.001 && Math.abs(activeLng - cp.lng) < 0.001)

              return (
                <button
                  key={cp.id}
                  disabled={readsAll}
                  onClick={() => handleSimulateCheckpoint(cp)}
                  className={`text-left p-3.5 rounded-2xl border transition text-xs flex items-center justify-between disabled:opacity-40 ${
                    isSelected
                      ? 'bg-forest-900 text-cream-50 border-forest-900 ring-2 ring-emerald-400'
                      : 'bg-cream-50/60 hover:bg-cream-100/80 border-forest-900/10 text-forest-800'
                  }`}
                >
                  <div>
                    <div className="font-medium flex items-center gap-1.5">
                      {isCpNearby && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />}
                      {cp.label}
                    </div>
                    <div className={`text-[11px] mt-0.5 ${isSelected ? 'text-cream-100/70' : 'text-forest-700/60'}`}>
                      {cp.area}
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    <span className={`font-semibold ${isSelected ? 'text-emerald-300' : 'text-forest-900'}`}>
                      {cpDist} km
                    </span>
                    <div className={`text-[10px] ${isSelected ? 'text-cream-100/60' : 'text-forest-700/50'}`}>
                      ~{estimateEtaMinutes(cpDist)}m
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Contact and Share Buttons */}
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            onClick={copyShareLink}
            className="flex-1 min-w-[200px] btn-primary flex items-center justify-center gap-2"
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? 'Kopyado na ang Link!' : 'Kopyahin ang Live Sharing Link'}
          </button>
          
          <a
            href={BUSINESS.contact.messenger}
            target="_blank"
            rel="noreferrer"
            className="btn bg-white border border-forest-900/10 text-forest-800 hover:bg-cream-100 flex items-center gap-2"
          >
            <Messenger size={16} /> I-send sa Messenger
          </a>

          <a
            href={`tel:${BUSINESS.contact.phone.replace(/\s+/g, '')}`}
            className="btn bg-white border border-forest-900/10 text-forest-800 hover:bg-cream-100 flex items-center gap-2"
          >
            <Phone size={16} /> Tawagan si Client
          </a>
        </div>
      </div>
    </div>
  )
}
