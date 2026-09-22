import { useEffect, useState, useMemo } from 'react'
import { BUSINESS } from '../../config/site'
import { cloudBookingsDB } from '../../lib/firestoreBookings'
import { trackingSessionsDB, sessionIsStale, type TrackingSession } from '../../lib/trackingSessions'
import type { Booking } from '../../lib/storage'
import {
  directionsUrl,
  hotelMapsUrl,
  sessionAge,
  calculateDistanceKm,
  estimateEtaMinutes,
  getProximityStatus,
  guessAreaFromCoords,
  HOTEL_LAT,
  HOTEL_LNG,
} from '../../lib/tracking'
import { Screen, ScreenTitle } from '../components/Screen'
import { Navigation, Phone, MapPin, Sparkle, Clock, Check } from '../../lib/icons'

export function AdminTrackingScreen() {
  const [items, setItems] = useState<Booking[]>([])
  // The radar is the sessions, joined to their Bookings for the names and the
  // status. A session without a readable Booking is a stranger's document, not
  // a booker, and a session that stopped pinging 30 days ago reads as gone.
  const [sessions, setSessions] = useState<TrackingSession[]>([])
  const [activeTab, setActiveTab] = useState<'all' | 'nearby' | 'traveling'>('all')

  useEffect(() => {
    const unsubBookings = cloudBookingsDB.subscribe(setItems)
    const unsubSessions = trackingSessionsDB.subscribe(setSessions)
    return () => {
      unsubBookings()
      unsubSessions()
    }
  }, [])

  const bookingById = useMemo(() => new Map(items.map((b) => [b.id, b])), [items])
  const sessionByBooking = useMemo(() => new Map(sessions.map((s) => [s.bookingId, s])), [sessions])

  // Process the sessions into radar rows
  const bookersWithLocation = useMemo(() => {
    return sessions
      .filter((s) => !sessionIsStale(s))
      .map((s) => ({ s, b: bookingById.get(s.bookingId) }))
      .filter(({ b }) => Boolean(b) && b!.status !== 'Cancelled')
      .map(({ s, b }) => {
        const lat = s.latitude
        const lng = s.longitude
        const dist = typeof s.distance_km === 'number' ? s.distance_km : calculateDistanceKm(lat, lng)
        const eta = typeof s.eta_minutes === 'number' ? s.eta_minutes : estimateEtaMinutes(dist)
        const area = s.area || guessAreaFromCoords(lat, lng)
        const proximity = getProximityStatus(dist)
        return {
          ...b!,
          session: s,
          computedLat: lat,
          computedLng: lng,
          computedDist: dist,
          computedEta: eta,
          computedArea: area,
          proximity,
        }
      })
      .sort((a, b) => a.computedDist - b.computedDist) // nearest first
  }, [sessions, bookingById])

  // Filter based on proximity
  const nearbyBookers = bookersWithLocation.filter((b) => b.proximity.isNearby)
  const waitingForShare = items.filter(
    (b) => b.status !== 'Cancelled' && !sessionByBooking.get(b.id),
  )

  const displayedList = useMemo(() => {
    if (activeTab === 'nearby') return nearbyBookers
    if (activeTab === 'traveling') return bookersWithLocation.filter((b) => !b.proximity.isArrived)
    return bookersWithLocation
  }, [bookersWithLocation, nearbyBookers, activeTab])

  return (
    <Screen>
      <ScreenTitle eyebrow="App for Client · Location Monitor" title="Booker Live Radar">
        <p className="mt-1 text-sm text-forest-800/70">
          Subaybayan ang kinalalagyan ng mga bisita. Makita kung nasaang area na sila o kung malapit na ba ang booker sa resort.
        </p>
      </ScreenTitle>

      {/* Urgent Proximity Alert: MALAPIT NA BANNER */}
      {nearbyBookers.length > 0 && (
        <div className="mb-6 rounded-[24px] bg-gradient-to-r from-emerald-800 to-forest-900 text-cream-50 p-5 shadow-lg border border-emerald-400/40 relative overflow-hidden animate-pulse">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-eyebrow text-emerald-300">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
            Urgent Notice: May Malapit Nang Booker!
          </div>
          <div className="mt-2 text-xl font-serif text-white">
            {nearbyBookers[0].guest_name} ay {nearbyBookers[0].computedDist} km na lang ang layo!
          </div>
          <p className="mt-1 text-xs text-cream-100/80">
            Nasa area na sila ng: <strong>{nearbyBookers[0].computedArea}</strong> (Tinatayang darating sa loob ng ~{nearbyBookers[0].computedEta} minuto). Maaari nang buksan ang gate o ihanda ang pinto.
          </p>
          <div className="mt-3 flex gap-2">
            <a
              href={`tel:${nearbyBookers[0].phone.replace(/\s+/g, '')}`}
              className="px-3.5 py-1.5 rounded-xl bg-white text-forest-900 text-xs font-semibold shadow-sm inline-flex items-center gap-1.5"
            >
              <Phone size={13} /> Tawagan si Booker
            </a>
            <a
              href={directionsUrl(nearbyBookers[0].computedLat, nearbyBookers[0].computedLng)}
              target="_blank"
              rel="noreferrer"
              className="px-3.5 py-1.5 rounded-xl bg-emerald-700/80 text-white text-xs font-medium inline-flex items-center gap-1.5 border border-emerald-400/30"
            >
              <Navigation size={13} /> Buksan sa Maps
            </a>
          </div>
        </div>
      )}

      {/* Destination Card */}
      <div className="rounded-[22px] bg-forest-900 text-cream-50 p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-eyebrow text-cream-100/60">Drop-off Destination · Fixed</div>
            <div className="font-serif text-lg mt-0.5">{BUSINESS.name}</div>
            <div className="text-xs text-cream-100/70 font-mono mt-0.5">
              {HOTEL_LAT.toFixed(5)}, {HOTEL_LNG.toFixed(5)} · Luisiana, Laguna
            </div>
          </div>
          <a
            href={hotelMapsUrl()}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 rounded-xl text-xs bg-cream-50 text-forest-900 font-medium hover:bg-white transition"
          >
            Hotel Pin ↗
          </a>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="mt-5 flex gap-2 text-xs">
        <button
          onClick={() => setActiveTab('all')}
          className={`px-3 py-1.5 rounded-full font-medium transition ${
            activeTab === 'all'
              ? 'bg-forest-800 text-cream-50'
              : 'bg-white border border-forest-900/5 text-forest-700'
          }`}
        >
          Lahat ({bookersWithLocation.length})
        </button>
        <button
          onClick={() => setActiveTab('nearby')}
          className={`px-3 py-1.5 rounded-full font-medium transition ${
            activeTab === 'nearby'
              ? 'bg-emerald-700 text-cream-50'
              : 'bg-white border border-forest-900/5 text-emerald-800'
          }`}
        >
          🟢 Malapit Na ({nearbyBookers.length})
        </button>
        <button
          onClick={() => setActiveTab('traveling')}
          className={`px-3 py-1.5 rounded-full font-medium transition ${
            activeTab === 'traveling'
              ? 'bg-amber-600 text-cream-50'
              : 'bg-white border border-forest-900/5 text-amber-800'
          }`}
        >
          🟡 En Route ({bookersWithLocation.filter((b) => !b.proximity.isArrived).length})
        </button>
      </div>

      {/* Booker Cards List */}
      <div className="mt-4 space-y-3">
        {displayedList.length === 0 ? (
          <div className="rounded-[22px] border border-dashed border-forest-900/15 bg-white p-6 text-center text-sm text-forest-800/70">
            Walang aktibong live location sa kategoryang ito. Kapag nag-click ang booker ng "Share Location" o binuksan ang tracking link sa kanilang phone, lalabas sila rito.
          </div>
        ) : (
          displayedList.map((b) => (
            <div
              key={b.id}
              className={`rounded-[24px] bg-white border p-4 shadow-card transition ${
                b.proximity.isNearby ? 'border-emerald-300 ring-2 ring-emerald-100' : 'border-forest-900/5'
              }`}
            >
              {/* Card Header */}
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-base text-forest-900 flex items-center gap-2">
                    <span>{b.guest_name}</span>
                    <span className="text-[10px] font-mono bg-cream-100 px-2 py-0.5 rounded-full text-forest-700">
                      {b.ref_id || b.id.slice(0, 8).toUpperCase()}
                    </span>
                  </div>
                  <div className="text-xs text-forest-700/70 mt-0.5">
                    {b.phone} · {b.guests} Bisita
                  </div>
                </div>

                {/* Proximity Badge */}
                <span
                  className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                    b.proximity.category === 'malapit_na' || b.proximity.category === 'arrived'
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-300 animate-pulse'
                      : b.proximity.category === 'on_the_way'
                      ? 'bg-amber-50 text-amber-800 border-amber-200'
                      : 'bg-sky-50 text-sky-800 border-sky-200'
                  }`}
                >
                  {b.proximity.badgeText}
                </span>
              </div>

              {/* Location Details Box */}
              <div className="mt-3 rounded-2xl bg-cream-50 p-3.5 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-forest-600 text-[11px] font-medium flex items-center gap-1.5">
                    <MapPin size={13} className="text-forest-600" />
                    Kasalukuyang Area:
                  </span>
                  <span className="font-semibold text-forest-900 text-right">{b.computedArea}</span>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-forest-900/5">
                  <span className="text-forest-600 text-[11px]">Distansya papuntang Resort:</span>
                  <span className="font-bold text-forest-900 text-sm">{b.computedDist} km</span>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-forest-900/5">
                  <span className="text-forest-600 text-[11px] flex items-center gap-1">
                    <Clock size={12} /> Tinatayang Dating (ETA):
                  </span>
                  <span className="font-semibold text-forest-900">
                    {b.computedEta === 0 ? 'Nandito na' : `~${b.computedEta} minuto`}
                  </span>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-forest-900/5 text-[10px] text-forest-700/60 font-mono">
                  <span>Huling Update: {sessionAge(b.session.lastUpdated)}</span>
                  <span>{b.computedLat.toFixed(4)}, {b.computedLng.toFixed(4)}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="mt-3.5 flex flex-wrap gap-2">
                <a
                  href={directionsUrl(b.computedLat, b.computedLng)}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 rounded-xl text-xs bg-forest-800 text-cream-50 hover:bg-forest-900 inline-flex items-center gap-1.5 transition"
                >
                  <Navigation size={13} />
                  I-navigate sa Google Maps ↗
                </a>

                <a
                  href={`tel:${b.phone.replace(/\s+/g, '')}`}
                  className="px-3 py-1.5 rounded-xl text-xs bg-white border border-forest-900/10 text-forest-800 hover:bg-cream-100 inline-flex items-center gap-1.5 transition"
                >
                  <Phone size={13} /> Tawagan si Booker
                </a>

                <button
                  onClick={() => {
                    const url = `${window.location.origin}/track?id=${b.id}`
                    navigator.clipboard.writeText(url)
                    alert(`Live tracker link para kay ${b.guest_name} nakopya na!`)
                  }}
                  className="px-3 py-1.5 rounded-xl text-xs bg-cream-100 hover:bg-cream-200 text-forest-800 transition"
                >
                  Kopyahin ang Link
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Waiting for Location Sharing Section */}
      {waitingForShare.length > 0 && (
        <div className="mt-8">
          <div className="eyebrow text-forest-700/70 mb-2">
            Hindi Pa Nag-sha-share ng Lokasyon ({waitingForShare.length})
          </div>
          <div className="space-y-2">
            {waitingForShare.map((b) => (
              <div
                key={b.id}
                className="rounded-2xl bg-white border border-forest-900/5 px-4 py-3 text-xs flex items-center justify-between"
              >
                <div>
                  <span className="font-semibold text-forest-900">{b.guest_name}</span>
                  <span className="text-forest-700/70"> · {b.phone} · {b.check_in}</span>
                </div>
                <button
                  onClick={() => {
                    const url = `${window.location.origin}/track?id=${b.id}`
                    navigator.clipboard.writeText(url)
                    alert(`Na-copy ang tracking link para ipadala kay ${b.guest_name} via SMS/Messenger!`)
                  }}
                  className="px-2.5 py-1 rounded-lg bg-cream-100 text-forest-800 hover:bg-cream-200 text-[11px]"
                >
                  I-send ang Link
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Screen>
  )
}
