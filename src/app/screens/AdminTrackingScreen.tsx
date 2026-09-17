import { useEffect, useState } from 'react'
import { BUSINESS } from '../../config/site'
import { cloudBookingsDB } from '../../lib/firestoreBookings'
import type { Booking } from '../../lib/storage'
import { directionsUrl, hasPickup, hotelMapsUrl, pickupAge, pickupMapsUrl } from '../../lib/tracking'
import { Screen, ScreenTitle } from '../components/Screen'

// Rider-style: PICKUP (guest, moving) -> DROP-OFF (hotel, fixed).
// Guest sends location with ONE TAP from /book success screen.
// Owner sees list + directions link per booking.
export function AdminTrackingScreen() {
  const [items, setItems] = useState<Booking[]>([])

  useEffect(() => {
    const unsub = cloudBookingsDB.subscribe(setItems)
    return () => unsub()
  }, [])

  const withPickup = items.filter(hasPickup)
  const waiting = items.filter((b) => !hasPickup(b) && b.status !== 'Cancelled' && b.status !== 'Completed')

  return (
    <Screen>
      <ScreenTitle eyebrow="Owner · Tracking" title="Pickup → Drop-off">
        <p className="mt-1 text-sm text-forest-800/70">
          Guest taps once to share pickup. You navigate to them, then to the hotel.
        </p>
      </ScreenTitle>

      <div className="rounded-[22px] bg-forest-900 text-cream-50 p-4">
        <div className="text-[10px] uppercase tracking-eyebrow text-cream-100/60">Drop-off · fixed</div>
        <div className="font-serif text-xl mt-0.5">{BUSINESS.name}</div>
        <div className="mt-1 text-xs text-cream-100/70 font-mono">
          {BUSINESS.coordinates.lat}, {BUSINESS.coordinates.lng}
        </div>
        <div className="mt-3 flex gap-2">
          <a href={hotelMapsUrl()} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg text-xs bg-cream-50 text-forest-900">
            Open hotel in Maps
          </a>
          <a href={BUSINESS.contact.directions} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg text-xs border border-cream-50/30 text-cream-50">
            Directions
          </a>
        </div>
      </div>

      <div className="mt-6 eyebrow">Live pickups · {withPickup.length}</div>
      {withPickup.length === 0 ? (
        <div className="mt-2 rounded-[22px] border border-dashed border-forest-900/15 bg-white/60 p-5 text-center text-sm text-forest-800/75">
          No pickup shared yet. When a booker taps “Share my pickup location”, it shows here.
        </div>
      ) : (
        <div className="mt-2 space-y-3">
          {withPickup.map((b) => (
            <TrackingCard key={b.id} booking={b} />
          ))}
        </div>
      )}

      {waiting.length > 0 && (
        <>
          <div className="mt-6 eyebrow">Waiting for pickup · {waiting.length}</div>
          <div className="mt-2 space-y-2">
            {waiting.map((b) => (
              <div key={b.id} className="rounded-2xl bg-white border border-forest-900/5 px-4 py-3 text-sm">
                <span className="font-medium text-forest-900">{b.guest_name}</span>
                <span className="text-forest-700/70"> · {b.phone} · {b.status}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Screen>
  )
}

function TrackingCard({ booking: b }: { booking: Booking }) {
  const lat = b.pickup_lat as number
  const lng = b.pickup_lng as number
  return (
    <div className="rounded-[22px] bg-white border border-forest-900/5 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium text-forest-900">{b.guest_name}</div>
        <span className="text-[11px] text-forest-700/70">{pickupAge(b)}</span>
      </div>
      <div className="mt-2 space-y-1.5 text-sm">
        <div className="flex items-center gap-2">
          <span className="inline-flex w-5 h-5 items-center justify-center rounded-full bg-emerald-600 text-white text-[10px]">A</span>
          <span className="text-forest-800">Pickup (guest): <span className="font-mono text-xs">{lat.toFixed(5)}, {lng.toFixed(5)}</span></span>
        </div>
        <div className="ml-2.5 h-4 w-px bg-forest-900/15" />
        <div className="flex items-center gap-2">
          <span className="inline-flex w-5 h-5 items-center justify-center rounded-full bg-forest-800 text-cream-50 text-[10px]">B</span>
          <span className="text-forest-800">Drop-off: Hacienda de LuisAna</span>
        </div>
      </div>
      <div className="mt-3 flex gap-2 flex-wrap">
        <a href={directionsUrl(lat, lng)} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg text-xs bg-forest-700 text-cream-50">
          Navigate pickup → hotel
        </a>
        <a href={pickupMapsUrl(lat, lng)} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg text-xs bg-cream-100 text-forest-800">
          Guest pin only
        </a>
        <a href={`tel:${b.phone.replace(/\s+/g, '')}`} className="px-3 py-1.5 rounded-lg text-xs bg-white border border-forest-900/10 text-forest-800">
          Call guest
        </a>
      </div>
    </div>
  )
}
