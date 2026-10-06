/** Values commonly returned for a date or instant by application APIs. */
type TimestampLike = {
  seconds?: unknown
  nanoseconds?: unknown
  toDate?: () => unknown
  toMillis?: () => unknown
}

const MIN_UNIX_SECONDS = 100_000_000
const MIN_UNIX_MILLISECONDS = 100_000_000_000

function validDate(milliseconds: number): Date | null {
  if (!Number.isFinite(milliseconds)) return null
  const date = new Date(milliseconds)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Convert epoch numbers whose unit is not explicit into milliseconds.
 *
 * JavaScript Date numbers are milliseconds; contemporary Unix timestamps are
 * seconds. Their magnitudes are distinct in real application data, so values
 * in the Unix-seconds range are scaled while normal millisecond values are
 * passed through. Small numeric values are treated as JavaScript milliseconds.
 */
function numericDate(value: number): Date | null {
  if (!Number.isFinite(value)) return null
  const absolute = Math.abs(value)
  const milliseconds = absolute >= MIN_UNIX_MILLISECONDS
    ? value
    : absolute >= MIN_UNIX_SECONDS
      ? value * 1000
      : value
  return validDate(milliseconds)
}

function numericStringDate(value: string): Date | null {
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(value)) return null

  // Four-digit strings such as "2026" are commonly used as years, not epochs.
  const digitCount = value.replace(/\D/g, '').length
  if (digitCount < 8) return null

  const numeric = Number(value)
  return Number.isFinite(numeric) ? numericDate(numeric) : null
}

/**
 * Parse a date value from Firestore or another external source.
 *
 * Supports Firestore Timestamp instances, their plain `{seconds, nanoseconds}`
 * wire shape, JavaScript Dates, ISO/date strings, and numeric Unix timestamps.
 * Invalid values return `null`; this function never lets a malformed timestamp
 * throw while a component is rendering.
 */
export function parseDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null

  if (value instanceof Date) {
    const milliseconds = value.getTime()
    return Number.isNaN(milliseconds) ? null : new Date(milliseconds)
  }

  if (typeof value === 'number') return numericDate(value)

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null

    const numeric = numericStringDate(trimmed)
    if (numeric) return numeric

    const milliseconds = Date.parse(trimmed)
    return validDate(milliseconds)
  }

  if (typeof value !== 'object') return null

  const timestamp = value as TimestampLike

  // Use the SDK's canonical conversion first. The seconds fallback also covers
  // Timestamp-shaped values that have been serialized across a process boundary.
  if (typeof timestamp.toDate === 'function') {
    try {
      const converted = timestamp.toDate()
      if (converted instanceof Date && !Number.isNaN(converted.getTime())) {
        return new Date(converted.getTime())
      }
    } catch {
      // Try the plain Timestamp fields below; malformed external data is blank.
    }
  }

  if (typeof timestamp.toMillis === 'function') {
    try {
      const milliseconds = timestamp.toMillis()
      if (typeof milliseconds === 'number') {
        const converted = validDate(milliseconds)
        if (converted) return converted
      }
    } catch {
      // Try the plain Timestamp fields below.
    }
  }

  if (typeof timestamp.seconds === 'number' && Number.isFinite(timestamp.seconds)) {
    const nanoseconds = typeof timestamp.nanoseconds === 'number' && Number.isFinite(timestamp.nanoseconds)
      ? timestamp.nanoseconds
      : 0
    return validDate(timestamp.seconds * 1000 + nanoseconds / 1_000_000)
  }

  return null
}

/** Format a date for display, returning `fallback` for missing or invalid input. */
export function formatDate(value: unknown, fallback = '', locale?: string): string {
  const date = parseDate(value)
  if (!date) return fallback

  try {
    return locale ? date.toLocaleDateString(locale) : date.toLocaleDateString()
  } catch {
    return fallback
  }
}

/** Format a date and time for display, returning `fallback` for invalid input. */
export function formatDateTime(value: unknown, fallback = '', locale = 'en-PH'): string {
  const date = parseDate(value)
  if (!date) return fallback

  try {
    return date.toLocaleString(locale, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return fallback
  }
}

/** Convert a supported date value to ISO-8601 without inventing a timestamp. */
export function dateToISOString(value: unknown, fallback = ''): string {
  const date = parseDate(value)
  if (!date) return fallback

  try {
    return date.toISOString()
  } catch {
    return fallback
  }
}
