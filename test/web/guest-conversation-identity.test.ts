// ----------------------------------------------------------------------------
// Conversation identity — the rule that ends the duplicates.
//
// A Conversation is identified by the Guest ACCOUNT, never by a Booking. These
// tests pin that formula, because both apps write it down independently and the
// Firestore rules enforce it: if the website and the Admin app ever disagree
// about where a Guest's thread lives, a Guest's words go somewhere the Admin is
// not looking.
//
// `src/lib/conversationIdentity.ts` is deliberately free of Firebase imports, so
// these assertions run in the ordinary web suite with no project configured.
// ----------------------------------------------------------------------------
import { describe, expect, it } from 'vitest'

import {
  bookingContextOf,
  bookingIdOfLegacyConversationId,
  classifyConversationId,
  guestConversationId,
  isGuestConversationId,
  isLocalConversationId,
  isValidBookingContext,
  legacyBookingConversationId,
  localConversationId,
  uidOfGuestConversationId,
  withoutLocalPrefix,
} from '../../src/lib/conversationIdentity'

const UID = 'guest-uid-1'
const OTHER = 'guest-uid-2'

describe('the one conversation a Guest account has', () => {
  it('derives the id from the account, identically for both apps', () => {
    // The same formula `lib/core/constants/app_constants.dart` mirrors.
    expect(guestConversationId(UID)).toBe(`guest-${UID}`)
    expect(guestConversationId(UID)).toBe('guest-guest-uid-1')
    expect(localConversationId(guestConversationId(UID))).toBe('local:guest-guest-uid-1')
  })

  it('is stable: the same account always names the same document', () => {
    const first = guestConversationId(UID)
    const second = guestConversationId(UID)
    expect(first).toBe(second)
    // …and a different account names a different one.
    expect(guestConversationId(OTHER)).not.toBe(first)
  })

  it('recognises its own id, and refuses to be confused by a neighbour', () => {
    expect(isGuestConversationId('guest-guest-uid-1')).toBe(true)
    expect(isGuestConversationId('local:guest-guest-uid-1')).toBe(true)
    expect(isGuestConversationId('guest-guest-uid-1', UID)).toBe(true)
    expect(isGuestConversationId('guest-guest-uid-1', OTHER)).toBe(false)
    // A uid that is a prefix of another is not the same account.
    expect(isGuestConversationId('guest-guest-uid-11', UID)).toBe(false)
  })

  it('reads the owner back out of an id, and nothing out of any other shape', () => {
    expect(uidOfGuestConversationId('guest-guest-uid-1')).toBe(UID)
    expect(uidOfGuestConversationId('local:guest-guest-uid-1')).toBe(UID)
    expect(uidOfGuestConversationId('booking-bk_1')).toBeNull()
    expect(uidOfGuestConversationId('inquiry-guest-uid-1-payment')).toBeNull()
    expect(uidOfGuestConversationId('guest-')).toBeNull()
  })

  it('classifies every shape it can be handed, including the demo prefix', () => {
    expect(classifyConversationId('guest-guest-uid-1')).toBe('guest')
    expect(classifyConversationId('booking-bk_1')).toBe('booking')
    expect(classifyConversationId('inquiry-guest-uid-1-payment')).toBe('inquiry')
    expect(classifyConversationId('local:guest-guest-uid-1')).toBe('local')
    expect(classifyConversationId('local:booking-bk_1')).toBe('local')
    expect(withoutLocalPrefix('local:booking-bk_1')).toBe('booking-bk_1')
    expect(withoutLocalPrefix('booking-bk_1')).toBe('booking-bk_1')
    expect(isLocalConversationId('local:guest-guest-uid-1')).toBe(true)
    expect(isLocalConversationId('guest-guest-uid-1')).toBe(false)
  })
})

describe('the superseded shapes are read, never written', () => {
  it('still parses the Booking out of a legacy booking thread', () => {
    expect(legacyBookingConversationId('bk_1')).toBe('booking-bk_1')
    expect(bookingIdOfLegacyConversationId('booking-bk_1')).toBe('bk_1')
    expect(bookingIdOfLegacyConversationId('local:booking-bk_1')).toBe('bk_1')
    expect(bookingIdOfLegacyConversationId('guest-guest-uid-1')).toBeNull()
    expect(bookingIdOfLegacyConversationId('booking-')).toBeNull()
  })
})

describe('a Booking is message context, not identity', () => {
  it('accepts a plain booking id and rejects anything that is not one', () => {
    expect(isValidBookingContext('bk_internal_doc_88291')).toBe(true)
    expect(isValidBookingContext('HDL-7821')).toBe(true)
    // No path traversal, no whitespace games, no control characters, no empties.
    expect(isValidBookingContext('bookings/../../escape')).toBe(false)
    expect(isValidBookingContext(' bk_1')).toBe(false)
    expect(isValidBookingContext('bk_1 ')).toBe(false)
    expect(isValidBookingContext('')).toBe(false)
    expect(isValidBookingContext('..')).toBe(false)
    expect(isValidBookingContext('.')).toBe(false)
    expect(isValidBookingContext('a'.repeat(129))).toBe(false)
    expect(isValidBookingContext('bk\u0000hidden')).toBe(false)
    expect(isValidBookingContext(null)).toBe(false)
    expect(isValidBookingContext(42)).toBe(false)
  })

  it('treats "no booking" as a general message, not as a missing field', () => {
    // Absent, null and undefined all mean the same thing: a general inquiry.
    expect(bookingContextOf(null)).toBeNull()
    expect(bookingContextOf(undefined)).toBeNull()
    expect(bookingContextOf('')).toBeNull()
    // An unusable value is dropped rather than stored.
    expect(bookingContextOf('bookings/../../escape')).toBeNull()
    expect(bookingContextOf('bk_1')).toBe('bk_1')
  })
})
