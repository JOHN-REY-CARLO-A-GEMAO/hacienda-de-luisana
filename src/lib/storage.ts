// ----------------------------------------------------------------------------
// Local Storage Backed Database for Bookings & Length of Stay Tracking
// Hacienda de LuisAna
// ----------------------------------------------------------------------------

export type BookingStatus = 'Pending' | 'Confirmed' | 'Cancelled' | 'Completed'

export type KycStatus = 'required' | 'submitted' | 'approved' | 'rejected'

export type Booking = {
  id: string
  guest_name: string
  phone: string
  email: string
  check_in: string // ISO YYYY-MM-DD
  check_out: string // ISO YYYY-MM-DD
  guests: number
  accommodation: string // Accommodation.id or 'other'
  special_requests: string
  status: BookingStatus
  created_at: string // ISO
  // KYC verification
  ref_id?: string
  uid?: string
  source?: string
  kyc_status?: KycStatus
  kyc_id_url?: string
  kyc_receipt_url?: string
  kyc_reject_reason?: string
  eta_share_url?: string
  // Booker live location sharing
  pickup_lat?: number
  pickup_lng?: number
  pickup_updated_at?: string // ISO
  pickup_label?: string
  pickup_area?: string // e.g. 'Luisiana Town Proper'
  distance_km?: number // Distance to Hacienda in km
  eta_minutes?: number // Estimated time of arrival
  is_live_sharing?: boolean // Whether live location is active
  last_speed_kmh?: number
}

const KEY = 'hdl:bookings'

/** Calculate nights between two dates */
export function calculateNights(checkIn: string, checkOut: string): number {
  if (!checkIn || !checkOut) return 1
  const a = new Date(checkIn).getTime()
  const b = new Date(checkOut).getTime()
  if (Number.isNaN(a) || Number.isNaN(b)) return 1
  return Math.max(1, Math.round((b - a) / (1000 * 60 * 60 * 24)))
}

/** Formatted length of stay: e.g. "3 Days · 2 Nights" or "2 Days · 1 Night" */
export function formatStayDuration(checkIn: string, checkOut: string): string {
  const nights = calculateNights(checkIn, checkOut)
  const days = nights + 1
  return `${days} Days · ${nights} Night${nights > 1 ? 's' : ''}`
}

/** Check if guest is staying right now, and calculate progress */
export function getStayProgress(checkIn: string, checkOut: string) {
  const nights = calculateNights(checkIn, checkOut)
  const totalDays = nights + 1
  const todayIso = new Date().toISOString().slice(0, 10)
  const now = Date.now()

  const checkInTime = new Date(`${checkIn}T14:00:00`).getTime() // standard 2:00 PM check-in
  const checkOutTime = new Date(`${checkOut}T12:00:00`).getTime() // standard 12:00 PM check-out

  const isCurrentStay = now >= checkInTime && now <= checkOutTime
  const isPast = now > checkOutTime
  const isUpcoming = now < checkInTime

  const totalDurationMs = Math.max(1, checkOutTime - checkInTime)
  const elapsedMs = Math.max(0, Math.min(totalDurationMs, now - checkInTime))
  const progressPercent = Math.round((elapsedMs / totalDurationMs) * 100)

  const hoursRemaining = Math.max(0, Math.round((checkOutTime - now) / (1000 * 60 * 60)))
  const daysElapsed = Math.min(totalDays, Math.floor(elapsedMs / (1000 * 60 * 60 * 24)) + 1)

  return {
    isCurrentStay,
    isPast,
    isUpcoming,
    totalNights: nights,
    totalDays,
    dayNumber: isCurrentStay ? daysElapsed : 0,
    hoursRemaining,
    progressPercent: isCurrentStay ? progressPercent : isPast ? 100 : 0,
  }
}

// Generate realistic default bookings so the app and admin are immediately populated
function generateSampleBookings(): Booking[] {
  const d = (offsetDays: number) => {
    const target = new Date()
    target.setDate(target.getDate() + offsetDays)
    return target.toISOString().slice(0, 10)
  }

  return [
    {
      id: 'book-sample-1',
      guest_name: 'Juan Dela Cruz',
      phone: '0917 892 3421',
      email: 'juan.delacruz@example.com',
      check_in: d(0), // Today
      check_out: d(2), // 2 nights
      guests: 6,
      accommodation: 'main-house',
      special_requests: 'Celebrating 10th anniversary with family. Requesting early arrival if possible.',
      status: 'Confirmed',
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 18).toISOString(),
      ref_id: 'HDL-7821',
      kyc_status: 'approved',
      is_live_sharing: true,
      pickup_lat: 14.1850,
      pickup_lng: 121.5150,
      pickup_area: 'Luisiana Town Proper (~2.4 km away)',
      distance_km: 2.4,
      eta_minutes: 6,
      pickup_updated_at: new Date(Date.now() - 1000 * 60 * 3).toISOString(),
    },
    {
      id: 'book-sample-2',
      guest_name: 'Maria Clarissa Reyes',
      phone: '0928 554 9912',
      email: 'maria.reyes@gmail.com',
      check_in: d(1),
      check_out: d(4), // 3 nights
      guests: 4,
      accommodation: 'casita-del-rio',
      special_requests: 'Bringing 1 small friendly corgi dog. Inquiring about bonfire setup on evening.',
      status: 'Pending',
      created_at: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
      ref_id: 'HDL-5510',
      kyc_status: 'submitted',
      is_live_sharing: true,
      pickup_lat: 14.2150,
      pickup_lng: 121.5050,
      pickup_area: 'Cavinti - Luisiana Road (~8.2 km away)',
      distance_km: 8.2,
      eta_minutes: 16,
      pickup_updated_at: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    },
    {
      id: 'book-sample-3',
      guest_name: 'JP & Bea Santos',
      phone: '0905 123 7788',
      email: 'jp.santos@outlook.com',
      check_in: d(4),
      check_out: d(5), // 1 night
      guests: 2,
      accommodation: 'house-a-camping',
      special_requests: 'Couple weekend glamping. Will arrive around 3:30 PM.',
      status: 'Pending',
      created_at: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
      ref_id: 'HDL-3199',
      kyc_status: 'required',
    },
    {
      id: 'book-sample-4',
      guest_name: 'Engr. Roberto Mendoza',
      phone: '0919 444 8821',
      email: 'roberto.mendoza@techcorp.ph',
      check_in: d(-3),
      check_out: d(-1), // Past completed stay
      guests: 8,
      accommodation: 'main-house',
      special_requests: 'Team building retreat. Highly rated stay.',
      status: 'Completed',
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 120).toISOString(),
      ref_id: 'HDL-2041',
      kyc_status: 'approved',
    },
  ]
}

function readAll(): Booking[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) {
      const initial = generateSampleBookings()
      window.localStorage.setItem(KEY, JSON.stringify(initial))
      return initial
    }
    const parsed = JSON.parse(raw) as Booking[]
    if (parsed.length === 0) {
      const initial = generateSampleBookings()
      window.localStorage.setItem(KEY, JSON.stringify(initial))
      return initial
    }
    return parsed
  } catch {
    return generateSampleBookings()
  }
}

function writeAll(list: Booking[]) {
  window.localStorage.setItem(KEY, JSON.stringify(list))
  window.dispatchEvent(new CustomEvent('hdl:bookings-updated'))
}

export const bookingsDB = {
  list(): Booking[] {
    return readAll().sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  },
  add(input: Omit<Booking, 'id' | 'status' | 'created_at'>): Booking {
    const b: Booking = {
      ...input,
      id: 'book-' + crypto.randomUUID().slice(0, 8),
      ref_id: 'HDL-' + Math.floor(1000 + Math.random() * 9000),
      status: 'Pending',
      created_at: new Date().toISOString(),
    }
    const list = readAll()
    list.unshift(b)
    writeAll(list)
    return b
  },
  update(id: string, patch: Partial<Booking>) {
    const list = readAll().map((b) => (b.id === id ? { ...b, ...patch } : b))
    writeAll(list)
  },
  remove(id: string) {
    writeAll(readAll().filter((b) => b.id !== id))
  },
}
