// Lightweight local-storage backed "database" for booking inquiries.
// This lets the /admin dashboard work end-to-end without a live backend.
// Swap for a real Supabase/Postgres client later without changing the UI.

export type BookingStatus = 'Pending' | 'Confirmed' | 'Cancelled' | 'Completed'

export type KycStatus = 'required' | 'submitted' | 'approved' | 'rejected'

export type Booking = {
  id: string
  guest_name: string
  phone: string
  email: string
  check_in: string       // ISO YYYY-MM-DD
  check_out: string      // ISO YYYY-MM-DD
  guests: number
  accommodation: string  // Accommodation.id or 'other'
  special_requests: string
  status: BookingStatus
  created_at: string     // ISO
  // P3 Real KYC (Flutter app writes these; web-only bookings omit them)
  ref_id?: string
  uid?: string
  source?: string
  kyc_status?: KycStatus
  kyc_id_url?: string
  kyc_receipt_url?: string
  kyc_reject_reason?: string
  eta_share_url?: string
  // Rider-style one-tap pickup (guest live) -> dropoff (hotel fixed).
  // pickup = guest GPS at tap time, dropoff = BUSINESS.coordinates.
  pickup_lat?: number
  pickup_lng?: number
  pickup_updated_at?: string // ISO
  pickup_label?: string
}

const KEY = 'hdl:bookings'

function readAll(): Booking[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Booking[]) : []
  } catch {
    return []
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
      id: crypto.randomUUID(),
      status: 'Pending',
      created_at: new Date().toISOString(),
    }
    const list = readAll()
    list.push(b)
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
