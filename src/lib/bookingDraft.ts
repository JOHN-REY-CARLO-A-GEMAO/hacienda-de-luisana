// The stay details a Guest has filled in, held in this tab until the
// downpayment screenshot is attached and the Booking is actually submitted.
// Nothing here is a Booking: closing the tab drops it, and the Hacienda has
// not been told.

import { sanitizeStayRequests, type EventPurpose } from './booking'

export type BookingDraft = {
  check_in: string
  check_out: string
  guests: number
  accommodation: string
  name: string
  phone: string
  email: string
  /** The Guest's own free text; composed with the structured requests at submit. */
  special_requests: string
  // Structured add-ons & requests (src/lib/booking/requests.ts). Optional and
  // additive: a draft saved before they existed loads with zeroed/absent
  // values and behaves exactly as it did.
  pet_count?: number
  bonfire_wood_sets?: number
  late_checkout_hours?: number
  event_purpose?: EventPurpose | ''
  event_purpose_detail?: string
}

const DRAFT_KEY = 'hdl:booking-draft'
const PROGRESS_KEY = 'hdl:booking-progress'
export const LAST_BOOKING_KEY = 'hdl:last-booking-id'

// A draft is a convenience for this tab. QuotaExceededError and SecurityError
// (private mode, blocked site data, some in-app webviews) must never become a
// Guest-facing booking error — especially not after a Booking already exists.
function storageGet(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

function storageSet(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value)
  } catch {
    // ignore
  }
}

function storageDrop(storage: Storage, key: string): void {
  try {
    storage.removeItem(key)
  } catch {
    // ignore
  }
}

export function saveBookingDraft(draft: BookingDraft): void {
  storageSet(sessionStorage, DRAFT_KEY, JSON.stringify(draft))
  storageDrop(sessionStorage, PROGRESS_KEY)
}

export function loadBookingDraft(): BookingDraft | null {
  try {
    const raw = storageGet(sessionStorage, DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<BookingDraft>
    if (!parsed.check_in || !parsed.check_out || !parsed.accommodation || !parsed.name || !parsed.email) {
      return null
    }
    // A hand-edited or stale draft cannot smuggle a negative, fractional or
    // out-of-range quantity into the quote or the stored Booking.
    const requests = sanitizeStayRequests(parsed)
    return {
      check_in: parsed.check_in,
      check_out: parsed.check_out,
      guests: Number(parsed.guests) || 1,
      accommodation: parsed.accommodation,
      name: parsed.name,
      phone: parsed.phone ?? '',
      email: parsed.email,
      special_requests: typeof parsed.special_requests === 'string' ? parsed.special_requests : '',
      pet_count: requests.pet_count ?? 0,
      bonfire_wood_sets: requests.bonfire_wood_sets ?? 0,
      late_checkout_hours: requests.late_checkout_hours ?? 0,
      event_purpose: requests.event_purpose ?? '',
      ...(requests.event_purpose_detail ? { event_purpose_detail: requests.event_purpose_detail } : {}),
    }
  } catch {
    return null
  }
}

// Incomplete details are saved only when the guest explicitly leaves to sign in.
// They are never accepted by the payment page as a complete booking draft.
export function saveBookingProgress(progress: BookingDraft): void {
  storageSet(sessionStorage, PROGRESS_KEY, JSON.stringify(progress))
  storageDrop(sessionStorage, DRAFT_KEY)
}

export function loadBookingProgress(): BookingDraft | null {
  try {
    const raw = storageGet(sessionStorage, PROGRESS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<BookingDraft>
    if (!parsed || typeof parsed !== 'object') return null
    const text = (value: unknown) => typeof value === 'string' ? value : ''
    const requests = sanitizeStayRequests(parsed)
    return {
      check_in: text(parsed.check_in), check_out: text(parsed.check_out),
      accommodation: text(parsed.accommodation),
      guests: typeof parsed.guests === 'number' && Number.isFinite(parsed.guests) ? parsed.guests : 2,
      name: text(parsed.name), phone: text(parsed.phone), email: text(parsed.email),
      special_requests: text(parsed.special_requests),
      pet_count: requests.pet_count ?? 0, bonfire_wood_sets: requests.bonfire_wood_sets ?? 0,
      late_checkout_hours: requests.late_checkout_hours ?? 0,
      event_purpose: requests.event_purpose ?? '', event_purpose_detail: text(parsed.event_purpose_detail),
    }
  } catch { return null }
}

export function clearBookingDraft(): void {
  storageDrop(sessionStorage, DRAFT_KEY)
  storageDrop(sessionStorage, PROGRESS_KEY)
}

export function rememberBookingId(id: string): void {
  storageSet(localStorage, LAST_BOOKING_KEY, id)
}

export function rememberedBookingId(): string | null {
  return storageGet(localStorage, LAST_BOOKING_KEY)
}
