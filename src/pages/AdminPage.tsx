import { useEffect, useMemo, useState } from 'react'
import { Booking, BookingStatus, bookingsDB } from '../lib/storage'
import { ACCOMMODATIONS } from '../config/site'
import { Calendar, Users, Sparkle, Close } from '../lib/icons'
import { Link } from 'react-router-dom'

const STATUSES: BookingStatus[] = ['Pending', 'Confirmed', 'Cancelled', 'Completed']

function fmtDate(iso: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
}

function accName(id: string) {
  return ACCOMMODATIONS.find((a) => a.id === id)?.name || (id === 'other' ? 'Other / Ask Us' : id)
}

export function AdminPage() {
  const [items, setItems] = useState<Booking[]>([])
  const [filter, setFilter] = useState<'All' | BookingStatus>('All')
  const [viewing, setViewing] = useState<Booking | null>(null)

  useEffect(() => {
    const load = () => setItems(bookingsDB.list())
    load()
    window.addEventListener('hdl:bookings-updated', load)
    return () => window.removeEventListener('hdl:bookings-updated', load)
  }, [])

  const today = new Date().toISOString().slice(0, 10)

  const stats = useMemo(() => {
    return {
      pending: items.filter((b) => b.status === 'Pending').length,
      confirmed: items.filter((b) => b.status === 'Confirmed').length,
      todayIn: items.filter((b) => b.status !== 'Cancelled' && b.check_in === today).length,
      todayOut: items.filter((b) => b.status !== 'Cancelled' && b.check_out === today).length,
    }
  }, [items, today])

  const filtered = useMemo(() => {
    if (filter === 'All') return items
    return items.filter((b) => b.status === filter)
  }, [items, filter])

  // Simple month calendar highlighting booked ranges (non-cancelled)
  const [monthDate, setMonthDate] = useState(() => new Date())
  const monthGrid = useMemo(() => buildMonth(monthDate), [monthDate])
  const isBooked = (day: Date) => {
    const iso = day.toISOString().slice(0, 10)
    return items.some(
      (b) => b.status !== 'Cancelled' && b.check_in <= iso && iso < b.check_out,
    )
  }

  const seedDemo = () => {
    const demo = [
      { name: 'Maria Reyes', in: offset(7), out: offset(9), guests: 6, acc: 'main-house' },
      { name: 'JP Santos', in: offset(2), out: offset(3), guests: 2, acc: 'house-a-camping' },
    ]
    demo.forEach((d) =>
      bookingsDB.add({
        guest_name: d.name,
        phone: '09XX XXX XXXX',
        email: 'sample@example.com',
        check_in: d.in,
        check_out: d.out,
        guests: d.guests,
        accommodation: d.acc,
        special_requests: 'Sample booking added from admin.',
      }),
    )
  }

  return (
    <div className="pt-24 pb-24 min-h-screen bg-cream-50">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div>
            <div className="eyebrow">Owner Dashboard</div>
            <h1 className="display text-4xl lg:text-5xl mt-3 text-forest-900">Today's Overview</h1>
            <p className="mt-2 text-forest-700/70 text-sm">
              Simple, focused view of guest requests. Data is stored locally in this browser for the
              demo — swap for Supabase later without changing this UI.
            </p>
          </div>
          <div className="flex gap-2">
            <Link to="/" className="btn-ghost">View Site</Link>
            {items.length === 0 && (
              <button onClick={seedDemo} className="btn-solid">Add sample data</button>
            )}
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Pending Requests" value={stats.pending} tone="olive" />
          <StatCard label="Confirmed Bookings" value={stats.confirmed} tone="forest" />
          <StatCard label="Upcoming Check-ins" value={stats.todayIn} tone="earth" hint="today" />
          <StatCard label="Upcoming Check-outs" value={stats.todayOut} tone="earth" hint="today" />
        </div>

        <div className="mt-10 grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white rounded-3xl border border-forest-900/5 shadow-card overflow-hidden">
            <div className="p-5 border-b border-forest-900/5 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-serif text-xl text-forest-900">Booking Requests</h2>
              <div className="flex gap-1 bg-cream-100/70 rounded-full p-1">
                {(['All', ...STATUSES] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setFilter(s)}
                    className={`px-3 py-1.5 rounded-full text-xs ${
                      filter === s ? 'bg-forest-800 text-cream-50' : 'text-forest-800 hover:bg-white'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {filtered.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[720px]">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-eyebrow text-forest-600">
                      <th className="px-5 py-3">Guest</th>
                      <th className="px-5 py-3">Dates</th>
                      <th className="px-5 py-3">Guests</th>
                      <th className="px-5 py-3">Accommodation</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-forest-900/5">
                    {filtered.map((b) => (
                      <tr key={b.id} className="hover:bg-cream-50/60">
                        <td className="px-5 py-4">
                          <div className="font-medium text-forest-900">{b.guest_name}</div>
                          <div className="text-xs text-forest-700/70">{b.phone} · {b.email}</div>
                        </td>
                        <td className="px-5 py-4 text-forest-800">
                          {fmtDate(b.check_in)} → {fmtDate(b.check_out)}
                        </td>
                        <td className="px-5 py-4 text-forest-800">{b.guests}</td>
                        <td className="px-5 py-4 text-forest-800">{accName(b.accommodation)}</td>
                        <td className="px-5 py-4"><StatusPill status={b.status} /></td>
                        <td className="px-5 py-4 text-right">
                          <div className="inline-flex gap-1">
                            <button onClick={() => setViewing(b)} className="px-2.5 py-1.5 rounded-lg text-xs bg-cream-100 hover:bg-cream-200 text-forest-800">View</button>
                            {b.status === 'Pending' && (
                              <button onClick={() => bookingsDB.update(b.id, { status: 'Confirmed' })} className="px-2.5 py-1.5 rounded-lg text-xs bg-forest-700 text-cream-50 hover:bg-forest-800">Confirm</button>
                            )}
                            {b.status !== 'Cancelled' && b.status !== 'Completed' && (
                              <button onClick={() => bookingsDB.update(b.id, { status: 'Cancelled' })} className="px-2.5 py-1.5 rounded-lg text-xs bg-white border border-forest-900/10 text-forest-800 hover:bg-cream-100">Cancel</button>
                            )}
                            {b.status === 'Confirmed' && (
                              <button onClick={() => bookingsDB.update(b.id, { status: 'Completed' })} className="px-2.5 py-1.5 rounded-lg text-xs bg-olive-600 text-cream-50 hover:bg-olive-700">Complete</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="bg-white rounded-3xl border border-forest-900/5 shadow-card p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-xl text-forest-900">Calendar</h2>
              <div className="flex gap-1">
                <button onClick={() => setMonthDate(shiftMonth(monthDate, -1))} className="px-2 py-1 rounded-lg text-xs bg-cream-100 hover:bg-cream-200">‹</button>
                <button onClick={() => setMonthDate(new Date())} className="px-2 py-1 rounded-lg text-xs bg-cream-100 hover:bg-cream-200">Today</button>
                <button onClick={() => setMonthDate(shiftMonth(monthDate, 1))} className="px-2 py-1 rounded-lg text-xs bg-cream-100 hover:bg-cream-200">›</button>
              </div>
            </div>
            <div className="mt-3 text-xs uppercase tracking-eyebrow text-forest-600">
              {monthDate.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}
            </div>
            <div className="mt-3 grid grid-cols-7 text-[11px] text-forest-700/70 text-center">
              {['S','M','T','W','T','F','S'].map((d, i) => <div key={i} className="py-1">{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {monthGrid.map((day, i) => {
                if (!day) return <div key={i} />
                const iso = day.toISOString().slice(0, 10)
                const booked = isBooked(day)
                const isToday = iso === today
                return (
                  <div
                    key={i}
                    className={`aspect-square rounded-lg text-xs flex items-center justify-center border
                      ${booked ? 'bg-forest-800 text-cream-50 border-forest-800' : 'bg-white border-forest-900/5 text-forest-800'}
                      ${isToday ? 'ring-2 ring-forest-600' : ''}`}
                    title={booked ? 'Booked' : 'Available'}
                  >
                    {day.getDate()}
                  </div>
                )
              })}
            </div>
            <div className="mt-4 text-[11px] text-forest-700/70 flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded bg-forest-800" /> Booked</span>
              <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded border border-forest-900/20 bg-white" /> Available</span>
            </div>
          </div>
        </div>
      </div>

      {viewing && <ViewModal booking={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

function StatCard({ label, value, tone, hint }: { label: string; value: number; tone: 'olive' | 'forest' | 'earth'; hint?: string }) {
  const tones = {
    forest: 'bg-forest-900 text-cream-100',
    olive: 'bg-olive-600 text-cream-50',
    earth: 'bg-earth-600 text-cream-50',
  } as const
  return (
    <div className={`rounded-3xl p-5 ${tones[tone]}`}>
      <div className="text-[11px] uppercase tracking-eyebrow opacity-80">{label}{hint ? ` · ${hint}` : ''}</div>
      <div className="mt-2 font-serif text-4xl">{value}</div>
    </div>
  )
}

function StatusPill({ status }: { status: BookingStatus }) {
  const map: Record<BookingStatus, string> = {
    Pending: 'bg-olive-100 text-olive-700 border-olive-200',
    Confirmed: 'bg-forest-100 text-forest-700 border-forest-200',
    Cancelled: 'bg-red-50 text-red-700 border-red-100',
    Completed: 'bg-earth-100 text-earth-700 border-earth-200',
  }
  return (
    <span className={`text-[11px] uppercase tracking-eyebrow px-2.5 py-1 rounded-full border ${map[status]}`}>{status}</span>
  )
}

function EmptyState() {
  return (
    <div className="p-14 text-center">
      <div className="mx-auto w-14 h-14 rounded-2xl bg-forest-50 text-forest-700 flex items-center justify-center mb-4">
        <Sparkle size={22} />
      </div>
      <div className="font-serif text-2xl text-forest-900">No booking requests yet</div>
      <p className="mt-2 text-sm text-forest-800/70 max-w-md mx-auto">
        New guest requests submitted through the site will appear here in real time.
      </p>
    </div>
  )
}

function ViewModal({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])
  return (
    <div className="fixed inset-0 z-50 bg-forest-950/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white max-w-lg w-full rounded-3xl p-6 lg:p-8 relative" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-full hover:bg-cream-100 text-forest-800" aria-label="Close">
          <Close size={18} />
        </button>
        <div className="eyebrow">Request</div>
        <h3 className="font-serif text-3xl text-forest-900 mt-2">{booking.guest_name}</h3>
        <div className="mt-1 text-sm text-forest-700/80">{booking.phone} · {booking.email}</div>

        <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
          <Item icon={Calendar} label="Check-in" value={fmtDate(booking.check_in)} />
          <Item icon={Calendar} label="Check-out" value={fmtDate(booking.check_out)} />
          <Item icon={Users} label="Guests" value={String(booking.guests)} />
          <Item icon={Sparkle} label="Accommodation" value={accName(booking.accommodation)} />
        </div>

        {booking.special_requests && (
          <div className="mt-6">
            <div className="eyebrow">Special Requests</div>
            <p className="mt-2 text-sm text-forest-800/85 leading-relaxed whitespace-pre-line">
              {booking.special_requests}
            </p>
          </div>
        )}

        <div className="mt-8 flex items-center justify-between">
          <StatusPill status={booking.status} />
          <div className="text-[11px] text-forest-700/60">
            Received {new Date(booking.created_at).toLocaleString('en-PH')}
          </div>
        </div>
      </div>
    </div>
  )
}

function Item({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="bg-cream-50 rounded-xl p-4">
      <div className="text-[11px] uppercase tracking-eyebrow text-forest-600 inline-flex items-center gap-1.5">
        <Icon size={13} /> {label}
      </div>
      <div className="mt-1 text-forest-900 font-medium">{value}</div>
    </div>
  )
}

// Utils
function offset(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
function shiftMonth(d: Date, delta: number) {
  const n = new Date(d)
  n.setMonth(n.getMonth() + delta)
  return n
}
function buildMonth(d: Date): (Date | null)[] {
  const y = d.getFullYear()
  const m = d.getMonth()
  const first = new Date(y, m, 1)
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const startDay = first.getDay() // Sunday-first
  const cells: (Date | null)[] = []
  for (let i = 0; i < startDay; i++) cells.push(null)
  for (let i = 1; i <= daysInMonth; i++) cells.push(new Date(y, m, i))
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}
