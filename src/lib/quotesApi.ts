/**
 * The price, asked of the server (ADR-0019).
 *
 * Before this file, the website computed what a stay cost and wrote that number
 * onto the Booking; `firestore.rules` checked that the number was *internally*
 * coherent, never that the published rate card produced it (ADR-0018). This client
 * is the other half of that fix: it asks `quoteBooking` to price the stay from
 * `site_config/rates`, and the only thing it puts on the Booking is the id of the
 * answer it was given — `quote_id`. The money on the record is still the page's
 * money, and the rules now refuse a Booking whose figures do not match the
 * attestation the estate holds.
 *
 * Two switches, deliberately separate:
 *   • `BOOKING_QUOTES_ENABLED` (deploy-time, this codebase's convention) turns the
 *     functions on at all, the way `DISPUTES_ENABLED` does for cases.
 *   • `site_config/booking.quotes_required` is what the *rules* read. It is Admin
 *     data, so enforcement can be switched on without a web redeploy.
 * This client reads the second so a Guest is never stranded by the first: with
 * enforcement off, a failed quote is a warning and the Booking proceeds on the
 * old path; with it on, no quote means no Booking, and the Guest is told why.
 */
import { doc, getDocFromServer } from 'firebase/firestore'
import { httpsCallable, type Functions } from 'firebase/functions'
import type { AuthoritativeMoney, QuoteRequest } from '../../functions/src/pricing'
import { app, auth, db, isFirebaseConfigured } from './firebase'
import { functionsClient } from './functionsClient'

/** What the page may show and the write may carry: the id, the figures, and how long they hold. */
export type AttestedQuote = {
  quoteId: string
  money: AuthoritativeMoney
  bracket: string
  /** Epoch milliseconds. Firestore holds the Timestamp twin the rules compare. */
  expiresAt: number
  /** True when the estate returned a live quote for an identical earlier request. */
  reused: boolean
}

/**
 * A quote the estate could not or would not attest. `cause` is the server's named
 * reason (`GUEST_COUNT_UNPRICED`, `PUBLISHED_RATES_MALFORMED`, …); `message` is the
 * Guest-facing sentence that came back with it, so the page does not invent its own.
 */
export class QuoteRefusedError extends Error {
  readonly cause_code: string
  readonly retryable: boolean

  constructor(cause: string, message: string, options: { retryable?: boolean } = {}) {
    super(message)
    this.name = 'QuoteRefusedError'
    this.cause_code = cause
    this.retryable = options.retryable ?? false
  }
}

function backend(): Functions {
  if (!app) throw new QuoteRefusedError('BACKEND_UNAVAILABLE', 'Prices cannot be confirmed in demo mode. Use a connected Firebase project to book.', { retryable: false })
  // The attestation is bound to an identity, and `firestore.rules` now refuses one
  // that is not bound to the writer — so asking without a signed-in user would only
  // trade a named refusal for a slower one. The Guest flow signs in anonymously
  // before the form submits (`src/lib/guestAuth.ts`); this is the guard, not the fix.
  if (!auth?.currentUser) {
    throw new QuoteRefusedError('AUTH_REQUIRED', 'We need to reconnect you before we can confirm a price. Please try again in a moment.', { retryable: true })
  }
  return functionsClient()
}

type CallableError = { code?: string; message?: string; details?: unknown }

/** A callable that is not deployed at all, versus one that refused this request. */
const isMissingFunction = (error: CallableError) => error.code === 'not-found' || error.code === 'unimplemented'

/**
 * Whether the estate is enforcing attestation. Read from the server rather than a
 * `VITE_*` build-time constant: the Admin's switch has to be flippable without a
 * redeploy, which is the whole reason enforcement lives in data.
 */
export async function quotesRequired(): Promise<boolean> {
  if (!isFirebaseConfigured || !db) return false
  try {
    const snap = await getDocFromServer(doc(db, 'site_config', 'booking'))
    return snap.exists() && snap.data().quotes_required === true
  } catch {
    // Unknown means "not proven on", which is the same default `firestore.rules`
    // uses for a missing `site_config/booking`. Guessing the other way would
    // refuse bookings the estate has not asked to refuse.
    return false
  }
}

type QuoteReply = {
  quote_id?: string
  money?: AuthoritativeMoney
  bracket?: string
  expires_at?: string
  reused?: boolean
}

/** Ask the estate to price one stay. Throws `QuoteRefusedError` when it will not. */
export async function requestQuote(stay: QuoteableStay): Promise<AttestedQuote> {
  let data: QuoteReply
  try {
    data = (await httpsCallable<QuoteRequest, QuoteReply>(backend(), 'quoteBooking')(quoteRequestFor(stay))).data
  } catch (error) {
    const failure = error as CallableError
    if (isMissingFunction(failure)) {
      throw new QuoteRefusedError('QUOTE_SERVICE_UNAVAILABLE', 'Prices are not being confirmed right now, so we cannot take this booking online. Please try again shortly, or contact the Hacienda.', { retryable: true })
    }
    const details = (failure.details ?? {}) as { cause?: string; message?: string }
    const message = typeof details.message === 'string' && details.message.trim() !== ''
      ? details.message
      : (failure.message ?? 'The price could not be confirmed. Please try again.')
    throw new QuoteRefusedError(details.cause ?? failure.code ?? 'QUOTE_FAILED', message, { retryable: failure.code === 'unavailable' || failure.code === 'internal' })
  }
  if (typeof data.quote_id !== 'string' || !data.money) {
    throw new QuoteRefusedError('QUOTE_MALFORMED_REPLY', 'The price could not be confirmed. Please try again.', { retryable: true })
  }
  const expiresAt = Date.parse(data.expires_at ?? '')
  return {
    quoteId: data.quote_id,
    money: data.money,
    bracket: data.bracket ?? '',
    // An unreadable expiry is treated as already expired: the write would be
    // refused by the rules anyway, and re-quoting is cheaper than a mystery.
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
    reused: data.reused === true,
  }
}

/**
 * The stay a quote is for: the fields `quoteBooking` accepts, and no others.
 *
 * `pet_count` and `late_checkout_hours` are not on `BookingState` — they ride on the
 * Booking as stay-request answers (`src/lib/booking/requests.ts`) — hence optional
 * here, with "absent means none" matching the server's own default.
 */
export type QuoteableStay = Pick<QuoteRequest, 'accommodation' | 'check_in' | 'check_out'>
  & Partial<Omit<QuoteRequest, 'accommodation' | 'check_in' | 'check_out'>>

/** A missing party size is one guest, which is also what the rules price a legacy record at. */
function quoteRequestFor(stay: QuoteableStay): QuoteRequest {
  return {
    accommodation: stay.accommodation,
    check_in: stay.check_in,
    check_out: stay.check_out,
    guests: stay.guests ?? 1,
    pet_count: stay.pet_count ?? 0,
    late_checkout_hours: stay.late_checkout_hours ?? 0,
  }
}

/**
 * The attestation a Guest's submit should carry, or `null` when the estate has not
 * asked for one.
 *
 * A Booking whose money the estate has not priced is exactly what ADR-0018
 * accepted; this returns `null` in that state rather than failing, so the switch
 * can be turned on without the website breaking first. When the switch *is* on, a
 * refusal here is final: writing anyway would only trade a clear sentence for a
 * `permission-denied` from the rules.
 */
export async function attestationForStay(stay: QuoteableStay, enforce: boolean): Promise<AttestedQuote | null> {
  try {
    const quote = await requestQuote(stay)
    // The quote expiring between the price check and the write is the ordinary race
    // in a flow that uploads a screenshot first. Re-asking once when the expiry is
    // close costs one call; getting it wrong costs the Guest their draft and a
    // `permission-denied` they cannot act on.
    if (quote.expiresAt - Date.now() < 30_000) return await requestQuote(stay)
    return quote
  } catch (error) {
    if (!enforce) return null
    if (error instanceof QuoteRefusedError) throw error
    throw new QuoteRefusedError('QUOTE_FAILED', 'The price could not be confirmed. Please try again.', { retryable: true })
  }
}

/**
 * The Admin's independent check (Flutter `payment_screen.dart`, and any Admin
 * surface on the web). A verdict, not an exception, for a mismatch — an Admin
 * needs to see *which* figure moved.
 */
export async function verifyBookingMoney(bookingId: string): Promise<unknown> {
  return (await httpsCallable<unknown, unknown>(backend(), 'verifyBookingMoney')({ bookingId })).data
}
