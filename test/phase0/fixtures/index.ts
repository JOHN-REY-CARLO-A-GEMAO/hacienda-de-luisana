import raw from './scenarios.json'
import type { Actor } from '../../../src/lib/booking'
import type { Booking } from '../../../src/lib/storage'

export const scenarios = raw
export const NOW = raw.meta.now
export function booking(overrides: Partial<Booking> = {}): Booking {
  return structuredClone({ ...raw.booking, ...overrides }) as Booking
}
export function actor(who: 'adminA' | 'adminB' | 'anonymousGuest' | 'authenticatedGuest' = 'adminA'): Actor {
  const identity = raw.identities[who]
  return { actor: identity.role as Actor['actor'], actor_id: identity.uid, actor_name: `Synthetic ${who}`, now: NOW }
}
export function approved(overrides: Partial<Booking> = {}): Booking {
  return booking({ status: 'Approved', payment_status: 'verified', amount_verified: 12000,
    payment_verified_by: raw.identities.adminA.uid, payment_verified_at: NOW,
    hold_expires_at: null, ...overrides })
}
export function request(overrides: Partial<Booking> = {}): Omit<Booking, 'id' | 'status' | 'created_at'> {
  const { id: _id, status: _status, created_at: _created, ...rest } = booking(overrides)
  return rest
}
