import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { cloudBookingsDB } from '../../lib/firestoreBookings'
import type { Booking } from '../../lib/storage'
import { hasPickup, pickupAge } from '../../lib/tracking'
import { Screen, ScreenTitle } from '../components/Screen'

export function AdminBookingsScreen() {
  const [items, setItems] = useState<Booking[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    const unsub = cloudBookingsDB.subscribe(setItems)
    return () => unsub()
  }, [])

  const update = async (id: string, patch: Partial<Booking>) => {
    setBusy(id)
    try {
      await cloudBookingsDB.update(id, patch)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Screen>
      <ScreenTitle eyebrow="Owner · Bookings" title="Requests">
        <p className="mt-1 text-sm text-forest-800/70">
          {items.length} total · {cloudBookingsDB.isCloud ? 'Firestore real-time' : 'local demo'}
        </p>
      </ScreenTitle>
      {items.length === 0 ? (
        <div className="rounded-[22px] bg-white border border-forest-900/5 p-6 text-center">
          <div className="font-serif text-xl text-forest-900">No requests yet</div>
          <p className="mt-2 text-sm text-forest-800/70">
            New inquiries from /book appear here. Full review on /admin website.
          </p>
          <Link to="/book" className="btn-ghost mt-4 h-10 px-5 text-sm inline-flex">
            Open booking form
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((b) => (
            <div key={b.id} className="rounded-[22px] bg-white border border-forest-900/5 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-forest-900">{b.guest_name}</div>
                  <div className="text-xs text-forest-700/70">
                    {b.check_in} → {b.check_out} · {b.guests} guests
                  </div>
                  <div className="mt-1 text-[11px]">
                    <span className="rounded-full bg-cream-100 px-2 py-0.5 text-forest-800">{b.status}</span>
                    {hasPickup(b) && (
                      <span className="ml-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-emerald-800">
                        📍 pickup {pickupAge(b)}
                      </span>
                    )}
                  </div>
                </div>
                <Link to="/app/tracking" className="text-xs underline text-forest-700 shrink-0">
                  Track →
                </Link>
              </div>
              <div className="mt-3 flex gap-2">
                {b.status === 'Pending' && (
                  <button
                    disabled={busy === b.id}
                    onClick={() => update(b.id, { status: 'Confirmed' })}
                    className="px-3 py-1.5 rounded-lg text-xs bg-forest-700 text-cream-50 disabled:opacity-50"
                  >
                    Confirm
                  </button>
                )}
                {b.status !== 'Cancelled' && b.status !== 'Completed' && (
                  <button
                    disabled={busy === b.id}
                    onClick={() => update(b.id, { status: 'Cancelled' })}
                    className="px-3 py-1.5 rounded-lg text-xs bg-white border border-forest-900/10 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                )}
                <Link to="/admin" className="px-3 py-1.5 rounded-lg text-xs bg-cream-100 text-forest-800">
                  Full view
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </Screen>
  )
}
