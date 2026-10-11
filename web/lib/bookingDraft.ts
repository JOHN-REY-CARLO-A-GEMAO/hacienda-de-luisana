// The stay details a Guest has filled in, held in this tab until the
// downpayment screenshot is attached and the Booking is actually submitted.
// Nothing here is a Booking: closing the tab drops it, and the Hacienda has
// not been told.

export type BookingDraft = {
  check_in: string
  check_out: string
  guests: number
  accommodation: string
  name: string
  phone: string
  email: string
  special_requests: string
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
    return {
      check_in: parsed.check_in,
      check_out: parsed.check_out,
      guests: Number(parsed.guests) || 1,
      accommodation: parsed.accommodation,
      name: parsed.name,
      phone: parsed.phone ?? '',
      email: parsed.email,
      special_requests: parsed.special_requests ?? '',
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
