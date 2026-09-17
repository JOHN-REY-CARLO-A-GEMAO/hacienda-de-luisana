// ----------------------------------------------------------------------------
// Live Tracking & Booker Proximity Service
// Hacienda de LuisAna — Real-time location sharing & ETA tracking
// ----------------------------------------------------------------------------
// Enables bookers to share their live GPS coordinates and allows the client/host
// to monitor whether the guest is nearby ("Malapit na") or in what area they are.
// Verified hotel pin: Hacienda De LuisAna @ 14.1754304, 121.519389 (Luisiana, Laguna).
// ----------------------------------------------------------------------------

import { BUSINESS } from '../config/site'
import type { Booking } from './storage'

export const HOTEL_LAT = BUSINESS.coordinates.lat
export const HOTEL_LNG = BUSINESS.coordinates.lng

export function hotelMapsUrl() {
  return `https://www.google.com/maps/search/?api=1&query=${HOTEL_LAT},${HOTEL_LNG}`
}

/** Google Maps directions: guest pickup -> hotel. */
export function directionsUrl(pickupLat: number, pickupLng: number) {
  return (
    `https://www.google.com/maps/dir/?api=1` +
    `&origin=${pickupLat},${pickupLng}` +
    `&destination=${HOTEL_LAT},${HOTEL_LNG}`
  )
}

/** Guest share link / Maps pin */
export function pickupMapsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
}

/** Haversine formula to compute distance in kilometers */
export function calculateDistanceKm(lat1: number, lon1: number, lat2: number = HOTEL_LAT, lon2: number = HOTEL_LNG): number {
  const R = 6371 // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return Math.round(R * c * 10) / 10
}

/** Estimate ETA in minutes given distance in km */
export function estimateEtaMinutes(distanceKm: number, avgSpeedKmh: number = 32): number {
  if (distanceKm <= 0.15) return 0
  const hours = distanceKm / avgSpeedKmh
  return Math.max(1, Math.round(hours * 60))
}

export type ProximityCategory = 'arrived' | 'malapit_na' | 'on_the_way' | 'en_route'

export interface ProximityInfo {
  category: ProximityCategory
  badgeText: string
  tagalogText: string
  tone: 'emerald' | 'amber' | 'sky' | 'indigo'
  isNearby: boolean
  isArrived: boolean
}

/** Get proximity category based on distance to Hacienda */
export function getProximityStatus(distanceKm: number): ProximityInfo {
  if (distanceKm <= 0.15) {
    return {
      category: 'arrived',
      badgeText: 'ARRIVED AT HACIENDA',
      tagalogText: 'Nandito na sa Hacienda! 🏁',
      tone: 'emerald',
      isNearby: true,
      isArrived: true,
    }
  }
  if (distanceKm <= 5.0) {
    return {
      category: 'malapit_na',
      badgeText: 'MALAPIT NA',
      tagalogText: 'Malapit na si Booker! (Wala pang 15 mins) 🟢',
      tone: 'emerald',
      isNearby: true,
      isArrived: false,
    }
  }
  if (distanceKm <= 35.0) {
    return {
      category: 'on_the_way',
      badgeText: 'ON THE WAY',
      tagalogText: 'Papunta na sa Luisiana, Laguna 🟡',
      tone: 'amber',
      isNearby: false,
      isArrived: false,
    }
  }
  return {
    category: 'en_route',
    badgeText: 'EN ROUTE / TRAVELING',
    tagalogText: 'Bumibiyahe pa 🔵',
    tone: 'sky',
    isNearby: false,
    isArrived: false,
  }
}

/** Estimate Philippine Laguna corridor landmark area from coordinates */
export function guessAreaFromCoords(lat: number, lng: number): string {
  const dist = calculateDistanceKm(lat, lng)
  if (dist <= 0.2) return 'Hacienda de LuisAna Entrance'
  if (dist <= 1.5) return 'Brgy. San Luis / Farm Road, Luisiana'
  if (dist <= 4.0) return 'Luisiana Town Proper, Laguna'
  if (dist <= 10.0) return 'Cavinti - Luisiana Boundary, Laguna'
  if (dist <= 22.0) return 'Pagsanjan - Cavinti Junction, Laguna'
  if (dist <= 35.0) return 'Sta. Cruz / Victoria, Laguna'
  if (dist <= 55.0) return 'Los Baños / Calamba Corridor'
  if (dist <= 85.0) return 'SLEX / South Luzon Expressway'
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`
}

/** Realistic Philippine travel checkpoints for testing live tracking without driving */
export const SIMULATION_CHECKPOINTS = [
  {
    id: 'manila',
    label: 'Metro Manila (SLEX Alabang)',
    area: 'Alabang, SLEX Tollway',
    lat: 14.4170,
    lng: 121.0450,
  },
  {
    id: 'calamba',
    label: 'Calamba / Turbina Exit (~45 km)',
    area: 'Calamba City, Laguna Highway',
    lat: 14.1950,
    lng: 121.1480,
  },
  {
    id: 'los_banos',
    label: 'Los Baños / Bay Junction (~30 km)',
    area: 'Los Baños Highway, Laguna',
    lat: 14.1820,
    lng: 121.2850,
  },
  {
    id: 'pagsanjan',
    label: 'Pagsanjan Rapids Crossing (~14 km)',
    area: 'Pagsanjan Town Center, Laguna',
    lat: 14.2740,
    lng: 121.4550,
  },
  {
    id: 'cavinti',
    label: 'Cavinti Junction (~8 km)',
    area: 'Cavinti - Luisiana Road',
    lat: 14.2150,
    lng: 121.5050,
  },
  {
    id: 'nearby',
    label: 'Luisiana Town Proper (~2.4 km — MALAPIT NA!)',
    area: 'Luisiana Poblacion (Malapit na!)',
    lat: 14.1850,
    lng: 121.5150,
  },
  {
    id: 'approaching',
    label: '500m to Gate (Very close!)',
    area: 'Luisiana Country Farm Lane',
    lat: 14.1770,
    lng: 121.5185,
  },
  {
    id: 'arrived',
    label: 'Arrived at Hacienda Gate',
    area: 'Hacienda de LuisAna Entrance',
    lat: HOTEL_LAT,
    lng: HOTEL_LNG,
  },
]

export function hasPickup(b: Booking): boolean {
  return typeof b.pickup_lat === 'number' && typeof b.pickup_lng === 'number'
}

export function pickupAge(b: Booking): string {
  if (!b.pickup_updated_at) return 'unknown time'
  const t = new Date(b.pickup_updated_at).getTime()
  if (Number.isNaN(t)) return 'unknown time'
  const secs = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (secs < 30) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`
  return new Date(b.pickup_updated_at).toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** One-tap browser geolocation -> { lat, lng }. */
export function getOneTapPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
      reject(new Error('Geolocation not supported on this device.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED)
          reject(new Error('Location permission denied — please allow location access in your browser.'))
        else if (err.code === err.TIMEOUT)
          reject(new Error('Location timed out — please check GPS or try outdoors.'))
        else reject(new Error('Could not get GPS location — please try again.'))
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    )
  })
}

/** Continuous live location watch */
export function startLiveLocationWatch(
  onUpdate: (coords: { lat: number; lng: number; accuracy?: number; speed?: number | null }) => void,
  onError?: (err: GeolocationPositionError) => void,
): () => void {
  if (typeof window === 'undefined' || !('geolocation' in navigator)) {
    return () => {}
  }

  const watchId = navigator.geolocation.watchPosition(
    (pos) => {
      onUpdate({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        speed: pos.coords.speed,
      })
    },
    (err) => {
      console.warn('[Tracking] watch error', err)
      onError?.(err)
    },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 },
  )

  return () => {
    navigator.geolocation.clearWatch(watchId)
  }
}
