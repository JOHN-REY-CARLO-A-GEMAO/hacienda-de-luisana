import { describe, expect, it } from 'vitest'
import { dateToISOString, formatDate, formatDateTime, parseDate } from '../../src/lib/formatDate'

const INSTANT = new Date('2026-09-20T01:00:00.250Z')
const SECONDS = Math.floor(INSTANT.getTime() / 1000)
const NANOS = (INSTANT.getTime() % 1000) * 1_000_000

// A Firestore Timestamp is recognized by its public conversion method; this
// structural stand-in keeps this unit test independent of Firebase app setup.
const timestampInstance = { toDate: () => new Date(INSTANT) }
const timestampWireShape = { seconds: SECONDS, nanoseconds: NANOS }

describe('safe date formatting', () => {
  it('formats Firestore Timestamp instances and their plain wire shape', () => {
    expect(dateToISOString(timestampInstance)).toBe(INSTANT.toISOString())
    expect(dateToISOString(timestampWireShape)).toBe(INSTANT.toISOString())
    expect(formatDate(timestampWireShape, 'missing', 'en-US')).toBe(INSTANT.toLocaleDateString('en-US'))
    expect(formatDateTime(timestampInstance)).toBe(formatDateTime(INSTANT))
  })

  it('accepts Date objects, ISO strings, millisecond numbers, and Unix-second numbers', () => {
    expect(parseDate(INSTANT)?.toISOString()).toBe(INSTANT.toISOString())
    expect(dateToISOString(INSTANT.toISOString())).toBe(INSTANT.toISOString())
    expect(dateToISOString(INSTANT.getTime())).toBe(INSTANT.toISOString())
    expect(dateToISOString(SECONDS)).toBe(new Date(SECONDS * 1000).toISOString())
    expect(dateToISOString(String(SECONDS))).toBe(new Date(SECONDS * 1000).toISOString())
  })

  it('handles epoch zero instead of treating it as a missing value', () => {
    expect(dateToISOString(0)).toBe(new Date(0).toISOString())
    expect(dateToISOString({ seconds: 0, nanoseconds: 0 })).toBe(new Date(0).toISOString())
    expect(formatDate({ seconds: 0 }, 'missing', 'en-US')).not.toBe('missing')
  })

  it('returns the provided fallback for missing, invalid, or throwing values', () => {
    const fallback = 'date unavailable'
    expect(formatDate(null, fallback)).toBe(fallback)
    expect(formatDate(undefined, fallback)).toBe(fallback)
    expect(formatDate('', fallback)).toBe(fallback)
    expect(formatDate('not-a-date', fallback)).toBe(fallback)
    expect(formatDate(new Date(Number.NaN), fallback)).toBe(fallback)
    expect(formatDate({ toDate: () => { throw new Error('bad timestamp') } }, fallback)).toBe(fallback)
    expect(dateToISOString({ seconds: Number.POSITIVE_INFINITY }, fallback)).toBe(fallback)
  })
})
