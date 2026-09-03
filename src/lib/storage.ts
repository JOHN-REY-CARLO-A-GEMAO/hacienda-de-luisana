// Lightweight local-storage backed "database" for booking inquiries.
// This lets the /admin dashboard work end-to-end without a live backend.
// Swap for a real Supabase/Postgres client later without changing the UI.

export type BookingStatus = 'Pending' | 'Confirmed' | 'Cancelled' | 'Completed'

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
