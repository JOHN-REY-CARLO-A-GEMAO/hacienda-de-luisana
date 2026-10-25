import { Alert } from '../ui'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MAX_STAY_NIGHTS, maximumCheckoutDate, type CalendarAvailabilityState } from '../../lib/booking'
import { cloudBookingsDB } from '../../lib/firestoreBookings'
import { validateStayDates } from '../../lib/validation'

const DAY_MS = 86_400_000
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const
const RANGE_TINT = 'rgb(209 250 229)' // emerald-100

type LoadState = 'loading' | 'ready' | 'error'

/**
 * A checkout date is only offered when the Hacienda's current policy accepts
 * the stay. The page supplies the authoritative check (the same rules the
 * submission re-runs); standalone renders fall back to the shared date rules.
 */
export type StayRangeValidation = { ok: boolean; reason?: string }

type Props = {
  accommodation: string
  accommodationName: string
  earliestCheckIn: string
  checkIn: string
  checkOut: string
  onChange: (checkIn: string, checkOut: string) => void
  onInvalidated?: (message: string) => void
  onLoadStateChange?: (state: LoadState) => void
  /** Field-level errors from the booking form, shown under each date field. */
  checkInError?: string
  checkOutError?: string
  /** Existing booking policy applied to a candidate [check_in, check_out) range. */
  validateRange?: (checkIn: string, checkOut: string) => StayRangeValidation
  /** The form's own per-field validation, run when a date field loses focus. */
  onCheckInBlur?: () => void
  onCheckOutBlur?: () => void
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

/**
 * The exact range the two visible months need from the availability service.
 * Two consecutive months are at most 62 nights, which is the callable's bound.
 */
export function dualMonthRange(firstMonth: string): { months: [string, string]; from: string; to: string } {
  const second = moveMonth(firstMonth, 1)
  return {
    months: [firstMonth, second],
    from: `${firstMonth}-01`,
    to: `${moveMonth(firstMonth, 2)}-01`,
  }
}

/** A month's own dates, padded with blanks so every week is a full row. */
function monthCells(month: string): (string | null)[] {
  const [year, value] = month.split('-').map(Number)
  const lead = new Date(Date.UTC(year, value - 1, 1)).getUTCDay()
  const days = new Date(Date.UTC(year, value, 0)).getUTCDate()
  const cells: (string | null)[] = Array.from({ length: lead }, () => null)
  for (let day = 1; day <= days; day += 1) {
    cells.push(`${month}-${String(day).padStart(2, '0')}`)
  }
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
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

function shortDate(date: string): string {
  return new Intl.DateTimeFormat('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`))
}

function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.max(0, Math.round((parseDate(checkOut) - parseDate(checkIn)) / DAY_MS))
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

function defaultValidateRange(checkIn: string, checkOut: string): StayRangeValidation {
  if (!checkIn || !checkOut) return { ok: false, reason: 'Choose a checkout date.' }
  const stay = validateStayDates(checkIn, checkOut)
  return stay.ok ? { ok: true } : { ok: false, reason: stay.message }
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
  checkInError,
  checkOutError,
  validateRange,
  onCheckInBlur,
  onCheckOutBlur,
}: Props) {
  const earliestMonth = startOfMonth(earliestCheckIn).slice(0, 7)
  const [month, setMonth] = useState(() => {
    const preferred = (checkIn || earliestCheckIn).slice(0, 7)
    return preferred < earliestMonth ? earliestMonth : preferred
  })
  const [calendarOpen, setCalendarOpen] = useState(true)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [days, setDays] = useState<Map<string, CalendarAvailabilityState>>(new Map())
  const [error, setError] = useState('')
  const [hovered, setHovered] = useState('')
  const requestNumber = useRef(0)
  const currentRef = useRef({ checkIn, checkOut, validateRange, onChange, onInvalidated, onLoadStateChange })
  currentRef.current = { checkIn, checkOut, validateRange, onChange, onInvalidated, onLoadStateChange }

  const { months, from, to } = useMemo(() => dualMonthRange(month), [month])
  const validator = validateRange ?? defaultValidateRange

  // Keep the selected stay in view without yanking the Guest back every time
  // they page through months to compare dates.
  useEffect(() => {
    if (!checkIn) return
    const target = checkIn.slice(0, 7)
    if (target < earliestMonth) {
      setMonth((current) => (current < earliestMonth ? earliestMonth : current))
      return
    }
    setMonth((current) => {
      const visible = [current, moveMonth(current, 1)]
      return visible.includes(target) ? current : target
    })
  }, [checkIn, earliestMonth])

  useEffect(() => {
    setMonth((current) => (current < earliestMonth ? earliestMonth : current))
  }, [earliestMonth])

  const load = useCallback(async (force = false) => {
    const thisRequest = ++requestNumber.current
    setLoadState('loading')
    currentRef.current.onLoadStateChange?.('loading')
    setError('')
    setDays(new Map()) // no stale green dates while another property/range is loading
    try {
      const result = await cloudBookingsDB.getAvailabilityCalendar(
        { accommodation, from, to },
        { force },
      )
      if (thisRequest !== requestNumber.current) return
      const next = new Map(result.days.map((day) => [day.date, day.state]))
      setDays(next)
      setLoadState('ready')
      currentRef.current.onLoadStateChange?.('ready')

      const selectedCheckIn = currentRef.current.checkIn
      const selectedCheckOut = currentRef.current.checkOut
      if (!selectedCheckIn || selectedCheckIn < from || selectedCheckIn >= to) return
      const selectedState = next.get(selectedCheckIn) ?? 'unknown'
      let invalidation = ''
      if (selectedCheckIn < earliestCheckIn) {
        invalidation = `${fullDate(selectedCheckIn)} does not meet the ${earliestCheckIn} earliest check-in date.`
      } else if (selectedState !== 'available') {
        invalidation = `${fullDate(selectedCheckIn)} is ${unavailableReason(selectedState)}.`
      } else if (selectedCheckOut) {
        if (selectedCheckOut <= selectedCheckIn) {
          invalidation = 'The chosen checkout is not after the selected check-in.'
        } else {
          let blockedNight = ''
          for (let night = selectedCheckIn; night < selectedCheckOut; night = addDays(night, 1)) {
            const state = next.get(night) ?? 'unknown'
            if (state !== 'available') {
              blockedNight = night
              break
            }
          }
          const rangeCheck = (currentRef.current.validateRange ?? defaultValidateRange)(
            selectedCheckIn,
            selectedCheckOut,
          )
          if (blockedNight) {
            invalidation = `${fullDate(blockedNight)} in the selected stay is ${unavailableReason(next.get(blockedNight) ?? 'unknown')}.`
          } else if (!rangeCheck.ok) {
            invalidation = rangeCheck.reason
              ? `The selected stay no longer meets the booking policy: ${rangeCheck.reason}`
              : 'The selected stay no longer meets the booking policy.'
          }
        }
      }
      if (invalidation) {
        currentRef.current.onChange('', '')
        currentRef.current.onInvalidated?.(
          `${invalidation} Please choose another available date for ${accommodationName}.`,
        )
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
  }, [accommodation, accommodationName, earliestCheckIn, from, to])

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

  /**
   * Every checkout the Guest may pick for the current check-in.
   *
   * A stay owns the nights [check-in, check-out): each of those must be
   * available, while the checkout date itself is a handover boundary and may
   * already be booked by the previous Guest. The existing policy decides the
   * stay length — the picker invents no rule of its own.
   */
  const checkoutAllowed = useMemo(() => {
    const allowed = new Set<string>()
    if (!checkIn || loadState !== 'ready' || checkIn < earliestCheckIn) return allowed
    // The stay-length maximum is a hard bound on the range that can be offered,
    // whatever the published policy says: never walk past check-in + 20 nights.
    const lastNight = maximumCheckoutDate(checkIn) ?? to
    const limit = addDays(lastNight, 1) < to ? addDays(lastNight, 1) : to
    for (let date = addDays(checkIn, 1); date < limit; date = addDays(date, 1)) {
      if (!validator(checkIn, date).ok) continue
      let nightsAvailable = true
      for (let night = checkIn; night < date; night = addDays(night, 1)) {
        if (days.get(night) !== 'available') {
          nightsAvailable = false
          break
        }
      }
      if (nightsAvailable) allowed.add(date)
    }
    return allowed
  }, [checkIn, earliestCheckIn, loadState, days, validator, to])

  const canPick = (date: string, state: CalendarAvailabilityState, selected: boolean) => {
    if (selected) return true
    if (loadState !== 'ready' || date < earliestCheckIn) return false
    if (state === 'available') return true
    return checkoutAllowed.has(date)
  }

  const choose = (date: string, state: CalendarAvailabilityState) => {
    if (loadState !== 'ready' || date < earliestCheckIn) return
    const selected = date === checkIn || date === checkOut
    if (!canPick(date, state, selected)) return
    if (checkIn && date > checkIn && checkoutAllowed.has(date)) {
      onChange(checkIn, date)
      onInvalidated?.('')
      return
    }
    // An unavailable night can never become a check-in; only a handover boundary.
    if (state !== 'available') return
    onChange(date, '')
    onInvalidated?.('')
  }

  const clearDates = () => {
    onChange('', '')
    onInvalidated?.('')
    setHovered('')
  }

  const minimumMonth = earliestMonth
  const nights = checkIn && checkOut && checkOut > checkIn ? nightsBetween(checkIn, checkOut) : 0
  const checkoutState = checkOut ? days.get(checkOut) ?? 'unknown' : null
  const previewEnd = !checkOut && checkIn && hovered > checkIn && checkoutAllowed.has(hovered) ? hovered : ''
  const rangeEnd = checkOut || previewEnd

  const monthPanel = (value: string, index: number) => (
    <div
      key={value}
      data-month={value}
      data-month-label={monthLabel(value)}
      className={`overflow-x-auto ${index === 1 ? 'hidden md:block' : ''}`}
    >
      <div
        className="grid min-w-[308px] grid-cols-7"
        role="grid"
        aria-label={`${monthLabel(value)} availability`}
        aria-busy={loadState === 'loading'}
      >
        {WEEKDAYS.map((weekday) => (
          <div
            key={weekday}
            role="columnheader"
            className="pb-2 text-center text-sm font-semibold uppercase tracking-wide text-forest-600"
          >
            {weekday}
          </div>
        ))}
        {monthCells(value).map((date, cellIndex) => {
          if (!date) {
            return <div key={`blank-${value}-${cellIndex}`} role="presentation" className="h-11" aria-hidden="true" />
          }
          const serverState = days.get(date) ?? 'unknown'
          const invalid = date < earliestCheckIn
          const isStart = date === checkIn
          const isEnd = date === checkOut
          const inRange = Boolean(rangeEnd && checkIn && date > checkIn && date < rangeEnd)
          const isPreviewEnd = Boolean(previewEnd && date === previewEnd)
          const isBoundary = !isStart && !isEnd && checkoutAllowed.has(date)
          const state: CalendarAvailabilityState | 'invalid' = invalid ? 'invalid' : serverState
          const selectable = canPick(date, serverState, isStart || isEnd)
          const band = inRange
            ? RANGE_TINT
            : isStart && rangeEnd
              ? `linear-gradient(to right, transparent 50%, ${RANGE_TINT} 50%)`
              : (isEnd && checkIn) || isPreviewEnd
                ? `linear-gradient(to left, transparent 50%, ${RANGE_TINT} 50%)`
                : undefined
          const label = invalid
            ? `${fullDate(date)} — past or does not meet the booking lead time`
            : isStart
              ? `${fullDate(date)} — selected check-in`
              : isEnd
                ? `${fullDate(date)} — selected checkout`
                : isBoundary
                  ? `${fullDate(date)} — ${stateLabel(serverState)}; selectable as this stay’s checkout boundary`
                  : `${fullDate(date)} — ${stateLabel(serverState)}`
          return (
            <div
              key={date}
              role="gridcell"
              className="relative flex h-11 items-center justify-center"
              style={band ? { backgroundImage: band } : undefined}
              data-in-range={inRange ? 'true' : undefined}
            >
              <button
                type="button"
                data-date={date}
                data-availability={state}
                data-selected={isStart ? 'start' : isEnd ? 'end' : undefined}
                data-checkout-candidate={isBoundary ? 'true' : undefined}
                disabled={!selectable}
                aria-label={label}
                aria-pressed={isStart || isEnd}
                title={label}
                onMouseEnter={() => setHovered(date)}
                onMouseLeave={() => setHovered('')}
                onFocus={() => setHovered(date)}
                onClick={() => choose(date, serverState)}
                className={dayClass({ state: serverState, invalid, selected: isStart || isEnd, selectable })}
              >
                <span>{Number(date.slice(-2))}</span>
                {!invalid && !isStart && !isEnd && serverState === 'pending' && (
                  <span className="absolute bottom-1 h-1 w-1 rounded-full bg-amber-500" aria-hidden="true" />
                )}
                {!invalid && !isStart && !isEnd && serverState === 'booked' && (
                  <span className="absolute bottom-1 h-1 w-1 rounded-full bg-red-400" aria-hidden="true" />
                )}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )

  return (
    <section
      className="mt-6 overflow-hidden rounded-[28px] border border-forest-900/10 bg-white shadow-[0_16px_40px_-24px_rgba(15,28,17,0.35)]"
      aria-labelledby="availability-calendar-heading"
      data-testid="availability-calendar"
    >
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id="availability-calendar-heading" className="font-serif text-xl text-forest-900">
              Piliin ang Petsa ng Stay
            </h3>
            <p className="mt-1 text-base leading-relaxed text-forest-700">
              Live availability para sa <strong>{accommodationName}</strong> · Philippine time.
              Pumili muna ng available na check-in, pagkatapos ay checkout.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={clearDates}
              disabled={!checkIn && !checkOut}
              className="min-h-11 rounded-full px-3 py-2 text-sm font-semibold text-forest-800 underline decoration-forest-300 underline-offset-4 hover:decoration-forest-700 disabled:cursor-not-allowed disabled:text-forest-700/40 disabled:no-underline"
            >
              Clear dates
            </button>
            <button
              type="button"
              onClick={() => setCalendarOpen((open) => !open)}
              aria-expanded={calendarOpen}
              aria-controls="availability-calendar-body"
              className="flex min-h-11 items-center justify-center rounded-full border border-forest-900/15 bg-white px-4 py-2 text-sm font-semibold text-forest-900 hover:border-forest-600"
            >
              {calendarOpen ? 'Close' : 'Edit dates'}
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 overflow-hidden rounded-2xl border border-forest-900/15">
          <DateField
            label="Check-in"
            value={checkIn}
            min={earliestCheckIn}
            error={checkInError}
            tourField="check-in"
            describedBy="booking-lead-time"
            onChange={(value) => {
              const lastCheckout = value ? maximumCheckoutDate(value) : null
              const stillValid = Boolean(checkOut)
                && value !== ''
                && checkOut > value
                && (lastCheckout === null || checkOut <= lastCheckout)
              onChange(value, stillValid ? checkOut : '')
            }}
            onBlur={() => onCheckInBlur?.()}
          />
          <DateField
            label="Checkout"
            value={checkOut}
            min={checkIn >= earliestCheckIn ? checkIn : earliestCheckIn}
            max={maximumCheckoutDate(checkIn) ?? undefined}
            error={checkOutError}
            tourField="check-out"
            onChange={(value) => onChange(checkIn, value)}
            onBlur={() => onCheckOutBlur?.()}
            bordered
          />
        </div>
        <p className="mt-2 text-sm leading-relaxed text-forest-700/75">
          Stays are 1 to {MAX_STAY_NIGHTS} nights
          {checkIn ? ` — for a ${shortDate(checkIn)} check-in the latest checkout is ${shortDate(maximumCheckoutDate(checkIn) ?? checkIn)}` : ''}.
        </p>

        <div className="min-h-6 pt-2 text-sm" aria-live="polite">
          {checkIn && !checkOut && loadState === 'ready' && (
            <p className="text-forest-700">
              Check-in <strong>{shortDate(checkIn)}</strong> selected. Now choose a checkout date.
            </p>
          )}
          {!checkIn && loadState === 'ready' && (
            <p className="text-forest-700/80">Choose a check-in date to begin.</p>
          )}
        </div>

        {calendarOpen && (
          <div id="availability-calendar-body" data-calendar-body>
            <div className="mt-1 flex items-center justify-between gap-3">
              <button
                type="button"
                aria-label="Previous month"
                disabled={month <= minimumMonth || loadState === 'loading'}
                onClick={() => setMonth((current) => moveMonth(current, -1))}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-forest-900/10 bg-white text-lg text-forest-900 transition hover:border-forest-500 disabled:cursor-not-allowed disabled:opacity-30"
              >
                ‹
              </button>
              <div className="grid flex-1 grid-cols-1 gap-8 text-center md:grid-cols-2">
                {months.map((value, index) => (
                  <div
                    key={value}
                    className={`font-serif text-base text-forest-900 ${index === 1 ? 'hidden md:block' : ''}`}
                    aria-live="polite"
                  >
                    {monthLabel(value)}
                  </div>
                ))}
              </div>
              <button
                type="button"
                aria-label="Next month"
                disabled={loadState === 'loading'}
                onClick={() => setMonth((current) => moveMonth(current, 1))}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-forest-900/10 bg-white text-lg text-forest-900 transition hover:border-forest-500 disabled:cursor-not-allowed disabled:opacity-30"
              >
                ›
              </button>
            </div>

            <div className="mt-3 grid gap-8 md:grid-cols-2">
              {months.map((value, index) => monthPanel(value, index))}
            </div>

            <div className="min-h-10" aria-live="polite">
              {loadState === 'loading' && (
                <p className="mt-4 rounded-xl border border-forest-900/10 bg-cream-50 px-3 py-2 text-sm text-forest-700">
                  Checking {accommodationName} availability… Dates stay disabled until the Hacienda confirms them.
                </p>
              )}
              {loadState === 'error' && (
                <Alert
                  tone="danger"
                  className="mt-4 text-sm"
                  title="Availability unknown."
                  actions={
                    <button type="button" onClick={() => void load(true)} className="inline-flex min-h-11 items-center px-2 text-base font-semibold underline underline-offset-2">
                      Try again
                    </button>
                  }
                >
                  {error}
                </Alert>
              )}
              {loadState === 'ready' && checkIn && checkOut && (
                <Alert tone="success" className="mt-4 text-sm" title="Selected stay:">
                  {fullDate(checkIn)} check-in → {fullDate(checkOut)} checkout
                  {nights > 0 ? ` (${nights} ${nights === 1 ? 'night' : 'nights'})` : ''}.
                  Checkout is a boundary, so another Guest may check in on {fullDate(checkOut)}.
                  {checkoutState && checkoutState !== 'available'
                    ? ' That date is already booked for an overnight stay, which does not block a checkout.'
                    : ''}
                </Alert>
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-start justify-between gap-3 border-t border-forest-900/10 pt-3">
              <div>
                <div className="text-sm font-semibold uppercase tracking-eyebrow text-forest-600">Calendar key</div>
                <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm text-forest-800 sm:grid-cols-5">
                  <Legend swatch="bg-forest-900" symbol="✓" label="Selected" />
                  <Legend swatch="border-emerald-300 bg-emerald-50" symbol="" label="Available" />
                  <Legend swatch="border-red-300 bg-red-50 text-red-600" symbol="•" label="Booked" />
                  <Legend swatch="border-amber-300 bg-amber-50 text-amber-700" symbol="•" label="Pending hold" />
                  <Legend swatch="border-slate-200 bg-slate-100 text-slate-400" symbol="" label="Past / invalid / unknown" />
                </ul>
              </div>
              <button
                type="button"
                onClick={() => void load(true)}
                disabled={loadState === 'loading'}
                className="min-h-11 rounded-full border border-forest-900/15 bg-white px-4 py-2 text-sm font-medium text-forest-800 hover:border-forest-600 disabled:opacity-50"
                aria-label="Refresh availability"
              >
                ↻ Refresh
              </button>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-forest-700/75">
              Colors mark overnight stays, not checkout occupancy. Checkout dates are limited to the stay length the
              Hacienda currently publishes online. Pending dates are held for up to 24 hours under the current Booking policy.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

function dayClass(input: {
  state: CalendarAvailabilityState
  invalid: boolean
  selected: boolean
  selectable: boolean
}): string {
  const base = 'relative z-10 flex h-11 w-11 items-center justify-center rounded-full text-base font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-700'
  if (input.selected) {
    const unconfirmed = !input.invalid && input.state !== 'available'
    return `${base} bg-forest-900 text-white shadow-sm ring-2 ring-white${unconfirmed ? ' ring-offset-1 ring-offset-red-300' : ''}`
  }
  if (input.invalid) return `${base} cursor-not-allowed text-slate-300 line-through`
  if (input.state === 'booked') {
    return `${base} text-red-500 line-through ${input.selectable ? 'cursor-pointer hover:bg-red-50' : 'cursor-not-allowed'}`
  }
  if (input.state === 'pending') {
    return `${base} text-amber-700 line-through ${input.selectable ? 'cursor-pointer hover:bg-amber-50' : 'cursor-not-allowed'}`
  }
  if (input.state !== 'available') return `${base} cursor-not-allowed text-slate-300 line-through`
  return `${base} text-forest-900 hover:bg-forest-900/10`
}

function DateField({
  label,
  value,
  min,
  max,
  error,
  tourField,
  describedBy,
  onChange,
  onBlur,
  bordered = false,
}: {
  label: string
  value: string
  min: string
  max?: string
  error?: string
  tourField: 'check-in' | 'check-out'
  describedBy?: string
  onChange: (value: string) => void
  onBlur: () => void
  bordered?: boolean
}) {
  const id = `booking-${tourField}`
  return (
    <div
      className={`relative px-4 py-3 transition focus-within:bg-cream-50/70 focus-within:ring-2 focus-within:ring-inset focus-within:ring-forest-600 ${bordered ? 'border-l border-forest-900/15' : ''} ${error ? 'bg-red-50/40' : ''}`}
    >
      <label
        htmlFor={id}
        className="pointer-events-none block text-sm font-semibold uppercase tracking-eyebrow text-forest-600"
      >
        {label}
      </label>
      <span
        className={`pointer-events-none mt-0.5 block truncate text-base font-medium ${value ? 'text-forest-900' : 'text-forest-700/45'}`}
      >
        {value ? shortDate(value) : 'Add date'}
      </span>
      <input
        id={id}
        type="date"
        min={min}
        max={max}
        value={value}
        data-tour-field={tourField}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        required
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
      />
      {error && <p className="relative z-0 mt-0.5 text-sm text-red-600">{error}</p>}
    </div>
  )
}

function Legend({ swatch, symbol, label }: { swatch: string; symbol: string; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span
        className={`flex h-4 w-4 items-center justify-center rounded-full border border-transparent text-[9px] font-bold ${swatch}`}
        aria-hidden="true"
      >
        {symbol}
      </span>
      <span>{label}</span>
    </li>
  )
}
