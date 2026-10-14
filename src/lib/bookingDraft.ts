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
export const LAST_BOOKING_KEY = 'hdl:last-booking-id'

export function saveBookingDraft(draft: BookingDraft): void {
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
}

export function loadBookingDraft(): BookingDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY)
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

export function clearBookingDraft(): void {
  sessionStorage.removeItem(DRAFT_KEY)
}

export function rememberBookingId(id: string): void {
  localStorage.setItem(LAST_BOOKING_KEY, id)
}

export function rememberedBookingId(): string | null {
  return localStorage.getItem(LAST_BOOKING_KEY)
}
