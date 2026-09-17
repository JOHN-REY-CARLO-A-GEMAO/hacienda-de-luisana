// Rider-style pickup -> drop-off tracking.
// Pickup = guest live GPS (one-tap), Drop-off = hotel fixed coords.
// Verified hotel pin from https://maps.app.goo.gl/GajLm6NHCqsMBnj57
// -> Hacienda De LuisAna @ 14.1754304, 121.519389
import { BUSINESS } from '../config/site'
import type { Booking } from './storage'

export const HOTEL_LAT = BUSINESS.coordinates.lat
export const HOTEL_LNG = BUSINESS.coordinates.lng

export function hotelMapsUrl() {
  return `https://www.google.com/maps/search/?api=1&query=${HOTEL_LAT},${HOTEL_LNG}`
}

/** Google Maps directions: guest pickup -> hotel. Rider-style. */
export function directionsUrl(pickupLat: number, pickupLng: number) {
  return (
    `https://www.google.com/maps/dir/?api=1` +
    `&origin=${pickupLat},${pickupLng}` +
    `&destination=${HOTEL_LAT},${HOTEL_LNG}`
  )
}

/** Guest one-tap share link (same coords, for Messenger copy). */
export function pickupMapsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
}

export function hasPickup(b: Booking) {
  return typeof b.pickup_lat === 'number' && typeof b.pickup_lng === 'number'
}

export function pickupAge(b: Booking): string {
  if (!b.pickup_updated_at) return 'unknown time'
  const t = new Date(b.pickup_updated_at).getTime()
  if (Number.isNaN(t)) return 'unknown time'
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`
  return new Date(b.pickup_updated_at).toLocaleString('en-PH')
}

/** One-tap browser geolocation -> { lat, lng }. Throws with human message. */
export function getOneTapPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Geolocation not supported on this device.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) reject(new Error('Location permission denied — allow location then tap again.'))
        else if (err.code === err.TIMEOUT) reject(new Error('Location timed out — try again outside / with GPS on.'))
        else reject(new Error('Could not get location — try again.'))
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    )
  })
}
