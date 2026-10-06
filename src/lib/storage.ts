// ----------------------------------------------------------------------------
// Local Storage Backed Database for Bookings & Length of Stay Tracking
// Hacienda de LuisAna
// ----------------------------------------------------------------------------

// The canonical Booking vocabulary lives in the lifecycle module; this store is
// an adapter at that seam, so it re-exports rather than redefining it.
// `Confirmed` is retired: a stored Confirmed Booking reads as `Reserved`.
export type { BookingStatus } from './booking'

import { interpretStoredStatus } from './booking'
import type { ActivityLogEntry, BookingState, BookingStatus } from './booking'

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
  // Live location tracking was retired (ADR-0009). Access logs remain on access_logs.
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
//
// Every sample names one of the three canonical Accommodations
// (`src/config/site.ts`): main-house, annex, house-a-camping. A sample naming
// anything else rendered its raw id to a Guest, because the pages that resolve an
// id to a name had nothing to resolve it against. A retired fourth property used
// to sit here and leaked exactly that way.
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
    },
    {
      id: 'book-sample-2',
      guest_name: 'Maria Clarissa Reyes',
      phone: '0928 554 9912',
      email: 'maria.reyes@gmail.com',
      check_in: d(1),
      check_out: d(4), // 3 nights
      guests: 4,
      accommodation: 'annex',
      special_requests: 'Bringing 1 small friendly corgi dog. Inquiring about bonfire setup on evening.',
      status: 'Pending',
      created_at: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
      ref_id: 'HDL-5510',
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
 * Admin reading the log the wrong way round draws the wrong conclusion.
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
 * Both adapters apply this, so a Guest view and the Admin view can never
 * disagree about the same Booking.
 */
function migrateOnRead(booking: Booking): Booking {
  return {
    ...booking,
    status: interpretStoredStatus(booking.status, {
      payment_status: booking.payment_status,
      payment_proof_url: booking.payment_proof_url,
    }),
  }
}

/** The demo-mode screenshot stored for a proof path, or null when there is none. */
export function readLocalPaymentProof(path: string | null | undefined): string | null {
  if (!path || typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(LOCAL_PROOF_KEY)
    if (!raw) return null
    const store = JSON.parse(raw) as Record<string, unknown>
    const value = store[path]
    return typeof value === 'string' ? value : null
  } catch {
    return null
  }
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

// ----------------------------------------------------------------------------
// Payment proof storage (ADR-0011): the bytes land in Supabase Storage's
// `payment-proofs` bucket in cloud mode, and in this browser's localStorage in
// demo mode (no VITE_SUPABASE_* keys) — the same demo-mode fallback the site
// already uses for Firebase itself. Either way the caller records the returned
// file path on the Booking as `paymentProofUrl` / `payment_proof_url`.
// ----------------------------------------------------------------------------

/** Why a proof could not be stored. */
export type ProofStorageFailure = {
  ok: false
  message: string
}

/** The stored proof: its path inside the bucket (or local store), and where it went. */
export type ProofStorageSuccess = {
  ok: true
  /** The file path to record on the Booking — `payment-proof` path, not a URL. */
  path: string
  /** `supabase` in cloud mode, `local` in this browser. */
  mode: 'supabase' | 'local'
}

export type ProofStorageOutcome = ProofStorageSuccess | ProofStorageFailure

/** localStorage key holding demo-mode proofs: { [path]: dataURL }. */
const LOCAL_PROOF_KEY = 'hdl:payment-proofs'

/**
 * How long one proof upload may run before the UI stops waiting for it.
 * A stalled connection otherwise leaves the form on "Uploading…" forever.
 */
const PROOF_UPLOAD_TIMEOUT_MS = 60_000

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('upload-timeout')), ms)
    // Node/jsdom timers are objects and would keep the test process alive.
    ;(timer as { unref?: () => void }).unref?.()
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('read-failed'))
    reader.readAsDataURL(file)
  })
}

/**
 * Uploads one downpayment screenshot to the Supabase Storage bucket
 * `payment-proofs` under `path` and returns that same path for the Booking
 * document. Files are validated by the caller (payments/contract).
 *
 * Demo mode — neither `VITE_SUPABASE_URL` nor `VITE_SUPABASE_ANON_KEY` set —
 * keeps the file in this browser's localStorage as a data URL so the Admin-side
 * story stays honest: nothing pretends to reach the Hacienda (see ADR-0011).
 */
export async function uploadPaymentProofFile(input: {
  file: File
  path: string
}): Promise<ProofStorageOutcome> {
  const { supabase, PAYMENT_PROOFS_BUCKET, isSupabaseConfigured } = await import('./supabase')

  if (isSupabaseConfigured && supabase) {
    try {
      const { error } = await withTimeout(
        supabase.storage.from(PAYMENT_PROOFS_BUCKET).upload(input.path, input.file, {
          contentType: input.file.type || 'application/octet-stream',
          // Deliberately not `upsert: true`. That sends
          // `Prefer: resolution=merge-duplicates`, which evaluates the *update*
          // policy alongside the insert one; the `anon` role has no read grant
          // on `payment-proofs`, so every upsert is refused with
          // `42501 new row violates row-level security policy` — on the very
          // first upload of a Booking, not only a re-send. The way to allow it
          // would be an `anon` select policy, which would publish every Guest's
          // receipt. So each attempt gets its own object name instead (see
          // `proofObjectPath`), the bytes are written once, and a re-send is a
          // second object rather than a replacement.
        }),
        PROOF_UPLOAD_TIMEOUT_MS,
      )
      if (error) {
        console.warn('[Payments] Supabase upload failed', error)
        return { ok: false, message: describeProofFailure(error.message, false) }
      }
      return { ok: true, path: input.path, mode: 'supabase' }
    } catch (e) {
      console.warn('[Payments] Supabase upload failed', e)
      const stalled = e instanceof Error && e.message === 'upload-timeout'
      return { ok: false, message: describeProofFailure(undefined, stalled) }
    }
  }

  // Demo mode: this browser only.
  try {
    const dataUrl = await withTimeout(fileToDataUrl(input.file), PROOF_UPLOAD_TIMEOUT_MS)
    const raw = window.localStorage.getItem(LOCAL_PROOF_KEY)
    const store: Record<string, string> = raw ? JSON.parse(raw) : {}
    store[input.path] = dataUrl
    window.localStorage.setItem(LOCAL_PROOF_KEY, JSON.stringify(store))
    return { ok: true, path: input.path, mode: 'local' }
  } catch (e) {
    console.warn('[Payments] local demo storage failed', e)
    const quota = e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')
    return {
      ok: false,
      message: quota
        ? 'This browser is out of storage space for demo receipts. Use a smaller photo, ' +
          'or a deployment with Supabase keys configured, and try again.'
        : describeProofFailure(undefined, false),
    }
  }
}

function describeProofFailure(detail: string | undefined, stalled: boolean): string {
  if (stalled) {
    return 'That upload is taking too long — your connection may have stalled. Please try ' +
      'again on a steadier connection, with a smaller photo.'
  }
  return detail
    ? `That upload did not go through (${detail}). Please check your connection and try again.`
    : 'That upload did not go through. Please check your connection and try again.'
}
