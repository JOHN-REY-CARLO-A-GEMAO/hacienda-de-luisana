// Storage is a convenience for a draft, never a Guest-facing error.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LAST_BOOKING_KEY,
  clearBookingDraft,
  loadBookingDraft,
  rememberBookingId,
  rememberedBookingId,
  saveBookingDraft,
  saveBookingProgress,
  type BookingDraft,
} from '../../src/lib/bookingDraft'

const draft: BookingDraft = {
  check_in: '2029-06-01',
  check_out: '2029-06-02',
  guests: 2,
  accommodation: 'main-house',
  name: 'Ana Reyes',
  phone: '09171234567',
  email: 'ana@example.com',
  special_requests: '',
}

const quota = () => new DOMException('The quota has been exceeded.', 'QuotaExceededError')
const blocked = () => new DOMException('blocked', 'SecurityError')

afterEach(() => {
  vi.restoreAllMocks()
  sessionStorage.clear()
  localStorage.clear()
})

describe('booking draft storage cannot throw at the Guest', () => {
  it('saveBookingDraft swallows a blocked sessionStorage write', () => {
    const original = Storage.prototype.setItem
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (this === sessionStorage) throw quota()
      return original.call(this, key, value)
    })
    expect(() => saveBookingDraft(draft)).not.toThrow()
    expect(spy).toHaveBeenCalled()
    expect(loadBookingDraft()).toBeNull()
  })

  it('saveBookingProgress swallows a blocked sessionStorage write', () => {
    const original = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (this === sessionStorage) throw quota()
      return original.call(this, key, value)
    })
    expect(() => saveBookingProgress(draft)).not.toThrow()
  })

  it('clearBookingDraft swallows a blocked remove', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw blocked()
    })
    expect(() => clearBookingDraft()).not.toThrow()
  })

  it('rememberBookingId swallows a blocked localStorage write', () => {
    const original = Storage.prototype.setItem
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (this === localStorage) throw quota()
      return original.call(this, key, value)
    })
    expect(() => rememberBookingId('booking-1')).not.toThrow()
    expect(spy).toHaveBeenCalled()
    expect(localStorage.getItem(LAST_BOOKING_KEY)).toBeNull()
  })

  it('rememberedBookingId returns null when localStorage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw blocked()
    })
    expect(rememberedBookingId()).toBeNull()
  })
})
