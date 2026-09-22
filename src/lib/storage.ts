// ----------------------------------------------------------------------------
// Local Storage Backed Database for Bookings & Length of Stay Tracking
// Hacienda de LuisAna
// ----------------------------------------------------------------------------

// The canonical Booking vocabulary lives in the lifecycle module; this store is
// an adapter at that seam, so it re-exports rather than redefining it.
// `Confirmed` is retired: a stored Confirmed Booking reads as `Reserved`.
export type { BookingStatus } from './booking'
export type { KycStatus } from './booking'

import { normalizeStatus } from './booking'
import type { ActivityLogEntry, BookingState, BookingStatus, KycStatus } from './booking'

/**
 * A Booking as stored.
 *
 * Everything the lifecycle module needs to reason about a Booking is here, so a
 * stored Booking can be handed straight to `applyAction` with no translation.
 */
export type Booking = BookingState & {
  guest_name: string
  phone: string
  email: string
  guests: number
  special_requests: string
  created_at: string // ISO
  uid?: string
  source?: string
  // Live location does not live here: it is a fact about the present moment,
  // written by the traveller's phone, and it rides on its own document —
  // tracking_sessions/{bookingId} (G6, src/lib/trackingSessions.ts). A Booking
  // is the promise about the stay; the session is where the guest is right now.
}

const KEY = 'hdl:bookings'
const ACTIVITY_KEY = 'hdl:activity'

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
      status: 'Reserved',
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 18).toISOString(),
      ref_id: 'HDL-7821',
      kyc_status: 'approved',
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

/**
 * The Activity log, in local persistence.
 *
 * Append-only by construction: the interface offers no edit and no delete, so a
 * caller cannot rewrite history even by accident (CONTEXT.md § Activity log).
 * Entries are kept in insertion order, which is the order they happened.
 */
export const activityLogStorage = {
  list(bookingId: string): ActivityLogEntry[] {
    return inOrder(readActivity().filter((entry) => entry.booking_id === bookingId))
  },
  append(entries: readonly ActivityLogEntry[]): void {
    if (entries.length === 0) return
    writeActivity([...readActivity(), ...withSequence(entries)])
  },
}

/**
 * Put entries in the order they happened.
 *
 * The clock is not enough: two changes can land in the same millisecond, and a
 * Host reading the log the wrong way round draws the wrong conclusion.
 */
function inOrder(entries: readonly ActivityLogEntry[]): ActivityLogEntry[] {
  return [...entries].sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? -1 : 1
    return (a.seq ?? 0) - (b.seq ?? 0)
  })
}

/** Assign each entry its position in its Booking's log, continuing from the last. */
function withSequence(entries: readonly ActivityLogEntry[]): ActivityLogEntry[] {
  const stored = readActivity()
  return entries.map((entry) => {
    const last = stored
      .filter((e) => e.booking_id === entry.booking_id)
      .reduce((max, e) => Math.max(max, e.seq ?? -1), -1)
    return { ...entry, seq: last + 1 }
  })
}

function readActivity(): ActivityLogEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(ACTIVITY_KEY)
    return raw ? (JSON.parse(raw) as ActivityLogEntry[]) : []
  } catch {
    return []
  }
}

function writeActivity(entries: ActivityLogEntry[]) {
  window.localStorage.setItem(ACTIVITY_KEY, JSON.stringify(entries))
  window.dispatchEvent(new CustomEvent('hdl:activity-updated'))
}

/**
 * Migrate a stored Booking on read.
 *
 * Documents written before the vocabulary change still say `Confirmed`; every
 * read turns that into `Reserved` instead of rewriting what is stored (spec #9).
 * Both adapters apply this, so a Guest view and the Host view can never
 * disagree about the same Booking.
 */
function migrateOnRead(booking: Booking): Booking {
  return { ...booking, status: normalizeStatus(booking.status) }
}

export const bookingsDB = {
  list(): Booking[] {
    return readAll()
      .map(migrateOnRead)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  },
  get(id: string): Booking | undefined {
    const found = readAll().find((b) => b.id === id)
    return found ? migrateOnRead(found) : undefined
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
