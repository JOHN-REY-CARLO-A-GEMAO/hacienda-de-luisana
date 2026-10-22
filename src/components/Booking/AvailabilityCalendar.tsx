import { Alert } from '../ui'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CalendarAvailabilityState } from '../../lib/booking'
import { cloudBookingsDB } from '../../lib/firestoreBookings'

const DAY_MS = 86_400_000
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const

type LoadState = 'loading' | 'ready' | 'error'

type Props = {
  accommodation: string
  accommodationName: string
  earliestCheckIn: string
  checkIn: string
  checkOut: string
  onChange: (checkIn: string, checkOut: string) => void
  onInvalidated?: (message: string) => void
  onLoadStateChange?: (state: LoadState) => void
}

function parseDate(date: string): number {
  return Date.parse(`${date}T00:00:00Z`)
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function addDays(date: string, days: number): string {
  return isoDate(parseDate(date) + days * DAY_MS)
}

function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`
}

function moveMonth(month: string, delta: number): string {
  const [year, value] = month.split('-').map(Number)
  return new Date(Date.UTC(year, value - 1 + delta, 1)).toISOString().slice(0, 7)
}

/** Six complete Sunday–Saturday rows, including adjacent-month dates. */
export function calendarGridRange(month: string): { from: string; to: string; dates: string[] } {
  const first = `${month}-01`
  const start = parseDate(first) - new Date(`${first}T00:00:00Z`).getUTCDay() * DAY_MS
  const dates = Array.from({ length: 42 }, (_, index) => isoDate(start + index * DAY_MS))
  return { from: dates[0], to: addDays(dates.at(-1)!, 1), dates }
}

function monthLabel(month: string): string {
  return new Intl.DateTimeFormat('en-PH', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`))
}

function fullDate(date: string): string {
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`))
}

function stateLabel(state: CalendarAvailabilityState): string {
  if (state === 'available') return 'Available for check-in'
  if (state === 'pending') return 'Temporarily unavailable — another Booking has an active Date hold'
  if (state === 'booked') return 'Booked for this overnight stay'
  return 'Availability not confirmed'
}

function unavailableReason(state: CalendarAvailabilityState): string {
  if (state === 'pending') return 'temporarily unavailable while another Booking is being reviewed'
  if (state === 'booked') return 'already booked'
  return 'not confirmed as available'
}

function cellClass(input: {
  state: CalendarAvailabilityState
  invalid: boolean
  selectedStart: boolean
  selectedEnd: boolean
  inRange: boolean
  outsideMonth: boolean
}): string {
  const base = 'relative flex min-h-10 w-full items-center justify-center rounded-xl border text-sm font-medium transition focus-visible:z-10 disabled:cursor-not-allowed'
  if (input.selectedStart || input.selectedEnd) {
    return `${base} border-forest-900 bg-forest-800 text-white shadow-sm ring-2 ring-forest-800/20`
  }
  if (input.invalid || input.state === 'unknown') {
    return `${base} border-slate-200 bg-slate-100 text-slate-400 ${input.outsideMonth ? 'opacity-45' : ''}`
  }
  if (input.state === 'booked') {
    return `${base} border-red-200 bg-red-50 text-red-800 ${input.outsideMonth ? 'opacity-55' : ''}`
  }
  if (input.state === 'pending') {
    return `${base} border-amber-300 bg-amber-50 text-amber-900 ${input.outsideMonth ? 'opacity-55' : ''}`
  }
  return `${base} border-emerald-200 ${input.inRange ? 'bg-emerald-200 text-forest-950' : 'bg-emerald-50 text-emerald-900 hover:border-emerald-500 hover:bg-emerald-100'} ${input.outsideMonth ? 'opacity-60' : ''}`
}

export function AvailabilityCalendar({
  accommodation,
  accommodationName,
  earliestCheckIn,
  checkIn,
  checkOut,
  onChange,
  onInvalidated,
  onLoadStateChange,
}: Props) {
  const initialMonth = (checkIn || earliestCheckIn).slice(0, 7)
  const [month, setMonth] = useState(initialMonth)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [days, setDays] = useState<Map<string, CalendarAvailabilityState>>(new Map())
  const [error, setError] = useState('')
  const requestNumber = useRef(0)
  const currentRef = useRef({ checkIn, onChange, onInvalidated, onLoadStateChange })
  currentRef.current = { checkIn, onChange, onInvalidated, onLoadStateChange }
  const grid = useMemo(() => calendarGridRange(month), [month])

  useEffect(() => {
    if (checkIn) setMonth(checkIn.slice(0, 7))
  }, [accommodation, checkIn]) // property/native-date changes must re-show and revalidate the selected stay

  useEffect(() => {
    const earliestMonth = earliestCheckIn.slice(0, 7)
    if (!checkIn && month < earliestMonth) setMonth(earliestMonth)
  }, [checkIn, earliestCheckIn, month])

  const load = useCallback(async (force = false) => {
    const thisRequest = ++requestNumber.current
    setLoadState('loading')
    currentRef.current.onLoadStateChange?.('loading')
    setError('')
    setDays(new Map()) // no stale green dates while another property/range is loading
    try {
      const result = await cloudBookingsDB.getAvailabilityCalendar(
        { accommodation, from: grid.from, to: grid.to },
        { force },
      )
      if (thisRequest !== requestNumber.current) return
      const next = new Map(result.days.map((day) => [day.date, day.state]))
      setDays(next)
      setLoadState('ready')
      currentRef.current.onLoadStateChange?.('ready')

      const selectedCheckIn = currentRef.current.checkIn
      if (selectedCheckIn && selectedCheckIn >= grid.from && selectedCheckIn < grid.to) {
        const selectedState = next.get(selectedCheckIn) ?? 'unknown'
        if (selectedCheckIn < earliestCheckIn || selectedState !== 'available') {
          currentRef.current.onChange('', '')
          const reason = selectedCheckIn < earliestCheckIn
            ? `does not meet the ${earliestCheckIn} earliest check-in date`
            : `is ${unavailableReason(selectedState)}`
          currentRef.current.onInvalidated?.(`${fullDate(selectedCheckIn)} ${reason} for ${accommodationName}. Please choose another available date.`)
        }
      }
    } catch (caught) {
      if (thisRequest !== requestNumber.current) return
      const message = caught instanceof Error
        ? caught.message
        : 'Availability could not be confirmed right now. Please try again.'
      setError(message)
      setLoadState('error')
      currentRef.current.onLoadStateChange?.('error')
    }
  }, [accommodation, accommodationName, earliestCheckIn, grid.from, grid.to])

  useEffect(() => {
    void load()
    return () => { requestNumber.current += 1 }
  }, [load])

  // A cached month is refreshed after a suspended tab returns. The old dates
  // disappear while refreshing so an uncertain night is never shown green.
  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== 'hidden') void load(true) }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('hdl:bookings-updated', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('hdl:bookings-updated', refresh)
    }
  }, [load])

  const choose = (date: string, state: CalendarAvailabilityState) => {
    if (loadState !== 'ready' || date < earliestCheckIn || state !== 'available') return
    // Published online rates support one 22-hour standard stay. The selected
    // checkout is the next date boundary; its own overnight state does not
    // matter, so another Guest may check in on this Guest's checkout date.
    onChange(date, addDays(date, 1))
    onInvalidated?.('')
  }

  const selectedStart = checkIn ? parseDate(checkIn) : Number.NaN
  const selectedEnd = checkOut ? parseDate(checkOut) : Number.NaN
  const minimumMonth = startOfMonth(earliestCheckIn).slice(0, 7)

  return (
    <section
      className="mt-6 rounded-2xl border border-forest-900/10 bg-cream-50/70 p-4 sm:p-5"
      aria-labelledby="availability-calendar-heading"
      data-testid="availability-calendar"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="availability-calendar-heading" className="font-serif text-xl text-forest-900">
            Choose an available check-in
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-forest-700">
            Live availability for <strong>{accommodationName}</strong>. Selecting a night sets checkout to noon the next day.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loadState === 'loading'}
          className="rounded-full border border-forest-900/15 bg-white px-3 py-1.5 text-xs font-medium text-forest-800 hover:border-forest-600 disabled:opacity-50"
          aria-label="Refresh availability"
        >
          ↻ Refresh
        </button>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <button
          type="button"
          aria-label="Previous month"
          disabled={month <= minimumMonth || loadState === 'loading'}
          onClick={() => setMonth((current) => moveMonth(current, -1))}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-forest-900/15 bg-white text-lg text-forest-800 hover:border-forest-600 disabled:cursor-not-allowed disabled:opacity-35"
        >
          ‹
        </button>
        <div className="text-center">
          <div className="font-serif text-lg text-forest-900" aria-live="polite">{monthLabel(month)}</div>
          <div className="text-[10px] uppercase tracking-eyebrow text-forest-600">Philippine time</div>
        </div>
        <button
          type="button"
          aria-label="Next month"
          disabled={loadState === 'loading'}
          onClick={() => setMonth((current) => moveMonth(current, 1))}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-forest-900/15 bg-white text-lg text-forest-800 hover:border-forest-600 disabled:cursor-not-allowed disabled:opacity-35"
        >
          ›
        </button>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-1" role="grid" aria-label={`${monthLabel(month)} availability`} aria-busy={loadState === 'loading'}>
        {WEEKDAYS.map((weekday) => (
          <div key={weekday} role="columnheader" className="pb-1 text-center text-[10px] font-semibold uppercase tracking-wide text-forest-600">
            {weekday}
          </div>
        ))}
        {grid.dates.map((date) => {
          const serverState = days.get(date) ?? 'unknown'
          const invalid = date < earliestCheckIn
          const isStart = date === checkIn
          const isEnd = date === checkOut
          const time = parseDate(date)
          const inRange = Number.isFinite(selectedStart) && Number.isFinite(selectedEnd)
            && time > selectedStart && time < selectedEnd
          const outsideMonth = date.slice(0, 7) !== month
          const label = invalid
            ? `${fullDate(date)} — Past or does not meet the booking lead time`
            : `${fullDate(date)} — ${stateLabel(serverState)}${isEnd && serverState !== 'available' ? '; allowed as this stay’s checkout boundary' : ''}`
          const disabled = loadState !== 'ready' || invalid || serverState !== 'available'
          return (
            <div key={date} role="gridcell">
              <button
                type="button"
                data-date={date}
                data-availability={invalid ? 'invalid' : serverState}
                disabled={disabled}
                aria-label={label}
                aria-pressed={isStart || isEnd}
                title={label}
                onClick={() => choose(date, serverState)}
                className={cellClass({ state: serverState, invalid, selectedStart: isStart, selectedEnd: isEnd, inRange, outsideMonth })}
                style={serverState === 'booked' && !isStart && !isEnd ? {
                  backgroundImage: 'repeating-linear-gradient(135deg, rgba(220,38,38,.07) 0, rgba(220,38,38,.07) 3px, transparent 3px, transparent 7px)',
                } : undefined}
              >
                <span>{Number(date.slice(-2))}</span>
                {!invalid && serverState === 'pending' && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />}
                {!invalid && serverState === 'booked' && <span className="absolute right-1 top-1 text-[9px] font-bold" aria-hidden="true">×</span>}
                {!invalid && serverState === 'available' && <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-emerald-600" aria-hidden="true" />}
              </button>
            </div>
          )
        })}
      </div>

      <div className="min-h-10" aria-live="polite">
        {loadState === 'loading' && (
          <p className="mt-3 rounded-xl border border-forest-900/10 bg-white px-3 py-2 text-xs text-forest-700">
            Checking {accommodationName} availability… Dates stay disabled until the Hacienda confirms them.
          </p>
        )}
        {loadState === 'error' && (
          <Alert
            tone="danger"
            className="mt-3 text-xs"
            title="Availability unknown."
            actions={
              <button type="button" onClick={() => void load(true)} className="text-xs font-semibold underline underline-offset-2">
                Try again
              </button>
            }
          >
            {error}
          </Alert>
        )}
        {loadState === 'ready' && checkIn && checkOut && (
          <Alert tone="success" className="mt-3 text-xs" title="Selected stay:">
            {fullDate(checkIn)} check-in → {fullDate(checkOut)} checkout. Checkout is a boundary, so another
            Guest may check in on {fullDate(checkOut)}.
          </Alert>
        )}
      </div>

      <div className="mt-3 border-t border-forest-900/10 pt-3">
        <div className="text-[10px] font-semibold uppercase tracking-eyebrow text-forest-600">Calendar key</div>
        <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px] text-forest-800 sm:grid-cols-4">
          <Legend swatch="border-emerald-300 bg-emerald-50" symbol="●" label="Available" />
          <Legend swatch="border-red-300 bg-red-50" symbol="×" label="Booked" />
          <Legend swatch="border-amber-300 bg-amber-50" symbol="•" label="Pending hold" />
          <Legend swatch="border-slate-200 bg-slate-100" symbol="—" label="Past / invalid / unknown" />
        </ul>
        <p className="mt-3 text-[11px] leading-relaxed text-forest-700/75">
          Colors mark overnight stays, not checkout occupancy. Pending dates are held for up to 24 hours under the current Booking policy.
        </p>
      </div>
    </section>
  )
}

function Legend({ swatch, symbol, label }: { swatch: string; symbol: string; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className={`flex h-5 w-5 items-center justify-center rounded-md border text-[10px] font-bold ${swatch}`} aria-hidden="true">{symbol}</span>
      <span>{label}</span>
    </li>
  )
}
