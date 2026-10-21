/**
 * The two callables that make a Booking's money server-attested.
 *
 * `quoteBooking` — the website asks for a price before it writes anything. The
 * request carries no money: which unit, which dates, how many people, which
 * extras. The figures come back from this process, computed by the canonical
 * pricing module against the document the Admin published, and are stored in
 * `booking_quotes/{id}` — a collection no client can write (the catch-all
 * `match /{document=**}` in `firestore.rules` denies it, and the Admin SDK below
 * is the only writer). `firestore.rules` then requires a Guest's Booking to name
 * one of those documents and to match it field for field. That is the whole of the
 * fix: the number a console used to be able to invent is now a number a console
 * can only *reference*.
 *
 * `verifyBookingMoney` — the approval-side check, for the Admin. It re-derives the
 * price from the live published document, compares it with what the Booking
 * carries and with the quote it names, and returns a verdict field by field. It
 * does not "correct" a Booking: silently rewriting money a Guest may already have
 * paid against is how a system loses the ability to explain itself. The Admin
 * decides, and the decision is recorded on the Booking as `money_checked`.
 *
 * Deployment status: this code is not deployed, and both callables are gated off
 * by default (`BOOKING_QUOTES_ENABLED`). Nothing in the live estate changes until
 * the rollout in docs/quotes/IMPLEMENTATION.md is run.
 */

import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https'
import { createHash } from 'node:crypto'
import { deriveQuote, moneyMismatches, parseQuoteRequest, quotePayload, ratesVersionDrift, type AuthoritativeMoney, type QuoteCause, type QuoteRequest } from './pricing'

const options = { region: 'asia-southeast1', maxInstances: 5, memory: '512MiB' as const, timeoutSeconds: 60 }

/**
 * Lazily resolved, because `index.ts` — the deployed entry point — calls
 * `initializeApp()` *after* its imports. A module-level `getFirestore()` here
 * would run first and throw in a way that looks like a broken deploy.
 */
let firestore: ReturnType<typeof getFirestore> | null = null
const db = () => (firestore ??= getFirestore())

/** Minutes a quote is honoured by the rules. Short on purpose: prices are re-published. */
const ttlMinutes = () => {
  const raw = Number(process.env.QUOTE_TTL_MINUTES ?? 30)
  return Number.isInteger(raw) && raw >= 1 && raw <= 240 ? raw : 30
}
const bootstrapAdminEmails = ['haciendadeluisiana@gmail.com', 'gemaojohnreyarguilles@gmail.com']

function enabled(): void {
  if (process.env.BOOKING_QUOTES_ENABLED !== 'true' && process.env.FUNCTIONS_EMULATOR !== 'true') {
    throw new HttpsError('unavailable', 'Price confirmation is not enabled on this deployment.')
  }
}

// A quote mints a document, so a caller who can call this 10,000 times can fill
// Firestore. In-memory, per instance: it is a brake, not a boundary — the
// boundary is that an unbounded number of quotes buys an attacker nothing, since
// each one prices the stay correctly.
const budget = new Map<string, { window: number; count: number }>()
function spend(key: string): void {
  const window = Math.floor(Date.now() / 60_000)
  const row = budget.get(key)
  const limit = Number(process.env.QUOTE_RATE_LIMIT_PER_MINUTE ?? 12)
  if (row && row.window === window && row.count >= limit) {
    throw new HttpsError('resource-exhausted', 'Too many price requests from here. Wait a minute, then try again.')
  }
  budget.set(key, { window, count: row && row.window === window ? row.count + 1 : 1 })
}

/**
 * A quote's document id, derived from what it prices.
 *
 * Deterministic on purpose: a Guest who taps "Next" twice, retries through a flaky
 * connection, or reloads the page and starts again gets the *same* quote back while
 * it is live, instead of a trail of documents that all say ₱16,000. The id is also
 * the idempotency key — there is no separate "create or find" step to race.
 */
function quoteIdFor(boundUid: string, request: QuoteRequest, ratesVersion: string): string {
  return createHash('sha256').update(`${boundUid}|${quotePayload(request, ratesVersion)}`).digest('hex').slice(0, 32)
}

function causeToError(cause: QuoteCause, detail: string, guestMessage: string, status: string): HttpsError {
  // The Admin-facing detail goes to the log, never to the browser: several causes
  // describe the estate's own configuration.
  console.error(`[quotes] ${cause}: ${detail}`)
  return new HttpsError(status as never, guestMessage)
}

async function isWriterAdmin(uid: string): Promise<boolean> {
  try {
    const user = await getAuth().getUser(uid)
    const profile = (await db().doc(`profiles/${uid}`).get()).data()
    return !user.disabled
      && ((user.emailVerified && bootstrapAdminEmails.includes((user.email || '').toLowerCase())) || profile?.role === 'admin')
  } catch {
    return false
  }
}

export const quoteBooking = onCall(options, async (request: CallableRequest) => {
  enabled()
  const parsed = parseQuoteRequest(request.data)
  if (!parsed.ok) throw causeToError(parsed.cause, parsed.detail, parsed.guestMessage, parsed.status)

  spend(request.auth?.uid ?? (request.rawRequest.ip ?? 'anonymous'))

  const [ratesDoc, configDoc] = await Promise.all([
    db().doc('site_config/rates').get(),
    db().doc('site_config/booking').get(),
  ])
  const derived = deriveQuote(ratesDoc.exists ? ratesDoc.data() : null, parsed.value, {
    now: Date.now(),
    bookingConfig: configDoc.data() ?? null,
  })
  if (!derived.ok) throw causeToError(derived.cause, derived.detail, derived.guestMessage, derived.status)

  const boundUid = request.auth?.uid ?? ''
  const id = quoteIdFor(boundUid, parsed.value, derived.quote.rates_version)
  const ref = db().doc(`booking_quotes/${id}`)
  const existing = await ref.get()
  const existingData = existing.data()
  const now = Date.now()
  if (existingData && typeof existingData.expires_at_ms === 'number' && existingData.expires_at_ms > now) {
    // Same party, same payload, same published version, still live: hand back the
    // quote that exists. Re-writing it would slide its expiry forward for free.
    return { quote_id: id, money: moneyOf(existingData), bracket: existingData.bracket, expires_at: new Date(existingData.expires_at_ms).toISOString(), reused: true }
  }

  const expiresAtMs = now + ttlMinutes() * 60_000
  // Flat, deliberately: `firestore.rules` compares this document with the
  // Booking field for field, and every extra level of nesting in that clause is
  // expressions spent reading keys instead of checking money.
  const document = {
    ...parsed.value,
    ...derived.quote.money,
    rates_version: derived.quote.rates_version,
    bracket: derived.quote.bracket,
    bound_uid: boundUid,
    created_at: FieldValue.serverTimestamp(),
    // A Firestore `Timestamp` is what `firestore.rules` compares against
    // `request.time`; the millisecond twin is what this process and any client
    // can compare against without a read back.
    expires_at: new Date(expiresAtMs),
    expires_at_ms: expiresAtMs,
  }
  await ref.set(document)
  return { quote_id: id, money: derived.quote.money, bracket: derived.quote.bracket, expires_at: new Date(expiresAtMs).toISOString(), reused: false }
})

/** The attested figures, read back out of the flat stored document. */
function moneyOf(stored: Record<string, unknown>): AuthoritativeMoney {
  return {
    rate_unit: 'standard_stay',
    rate_amount: Number(stored.rate_amount),
    rate_classification: String(stored.rate_classification) as AuthoritativeMoney['rate_classification'],
    nights: 1,
    stay_total: Number(stored.stay_total),
    amount_due: Number(stored.amount_due),
    balance_due: Number(stored.balance_due),
    security_deposit: Number(stored.security_deposit),
    payment_plan: 'down-payment',
    policy_version: String(stored.policy_version ?? ''),
    policy_effective_date: String(stored.policy_effective_date ?? ''),
    refund_policy_snapshot: (stored.refund_policy_snapshot ?? null) as AuthoritativeMoney['refund_policy_snapshot'],
  }
}

/**
 * The Admin's independent check of one Booking's money.
 *
 * Returns a verdict rather than throwing for a mismatch: an Admin looking at a
 * Booking needs to see *which* figure moved, and a callable that reports a
 * disagreement as an error code loses that.
 */
export const verifyBookingMoney = onCall(options, async (request: CallableRequest) => {
  enabled()
  const auth = request.auth
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in as the Hacienda to verify a Booking’s money.')
  if (!(await isWriterAdmin(auth.uid))) throw new HttpsError('permission-denied', 'Only the Hacienda can verify a Booking’s money.')

  const bookingIdRaw = (request.data as { bookingId?: unknown })?.bookingId
  if (typeof bookingIdRaw !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(bookingIdRaw)) {
    throw new HttpsError('invalid-argument', 'A Booking id is required.')
  }
  const bookingRef = db().doc(`bookings/${bookingIdRaw}`)
  const bookingDoc = await bookingRef.get()
  if (!bookingDoc.exists) throw new HttpsError('not-found', 'No Booking with that id.')
  const booking = { id: bookingDoc.id, ...(bookingDoc.data() ?? {}) } as Record<string, unknown>

  const [ratesDoc, configDoc] = await Promise.all([
    db().doc('site_config/rates').get(),
    db().doc('site_config/booking').get(),
  ])
  const quoteId = typeof booking.quote_id === 'string' ? booking.quote_id : ''
  const quoteDoc = quoteId ? await db().doc(`booking_quotes/${quoteId}`).get() : null
  const quote = quoteDoc?.exists
    ? {
        request: {
          accommodation: String(quoteDoc.data()!.accommodation),
          check_in: String(quoteDoc.data()!.check_in),
          check_out: String(quoteDoc.data()!.check_out),
          guests: Number(quoteDoc.data()!.guests),
          pet_count: Number(quoteDoc.data()!.pet_count ?? 0),
          late_checkout_hours: Number(quoteDoc.data()!.late_checkout_hours ?? 0),
        },
        money: moneyOf(quoteDoc.data()! as Record<string, unknown>),
      }
    : null

  const parsed = parseQuoteRequest({
    accommodation: booking.accommodation,
    check_in: booking.check_in,
    check_out: booking.check_out,
    guests: booking.guests,
    pet_count: booking.pet_count ?? 0,
    late_checkout_hours: booking.late_checkout_hours ?? 0,
  })

  let verdict: 'MATCH' | 'MISMATCH' | 'NO_RATE' | 'UNPARSEABLE'
  let mismatches: string[] = []
  let detail = ''

  if (!parsed.ok) {
    verdict = 'UNPARSEABLE'
    detail = parsed.detail
  } else {
    const fresh = deriveQuote(ratesDoc.exists ? ratesDoc.data() : null, parsed.value, { now: Date.now(), bookingConfig: configDoc.data() ?? null })
    if (!fresh.ok) {
      // A stale rate publication can refuse a Booking that was priced correctly
      // when it was taken; the stored quote is what says which of the two it is.
      verdict = 'NO_RATE'
      detail = fresh.detail
    } else if (quote) {
      mismatches = moneyMismatches(booking, quote)
      verdict = mismatches.length === 0 ? 'MATCH' : 'MISMATCH'
      if (quoteDoc!.data()!.bound_uid !== '' && quoteDoc!.data()!.bound_uid !== booking.uid) {
        mismatches = [...mismatches, 'bound_uid']
        verdict = 'MISMATCH'
        detail = 'the quote belongs to a different identity than the Booking it is attached to'
      }
      if (Number(quoteDoc!.data()!.expires_at_ms ?? 0) < Date.now()) {
        detail = detail || 'the quote had already expired when the Booking was written'
      }
    } else {
      // No quote document: a Booking from before the flag, or one written by an
      // Admin. Compare what the record says with what the card says now.
      mismatches = moneyMismatches(booking, fresh.quote)
      verdict = mismatches.length === 0 ? 'MATCH' : 'MISMATCH'
      detail = quoteId ? `booking_quotes/${quoteId} does not exist (it may have aged out)` : 'this Booking carries no quote reference'
    }
    if (ratesDoc.exists && ratesVersionDrift(booking, String((ratesDoc.data() ?? {}).version ?? ''))) {
      detail = detail || 'the Booking was stamped with an earlier rate version than the one published now'
    }
  }

  const record = {
    at: FieldValue.serverTimestamp(),
    by: auth.uid,
    verdict,
    mismatches,
    quote_id: quoteId || null,
    rates_version: ratesDoc.exists ? String((ratesDoc.data() ?? {}).version ?? '') : null,
    ...(detail ? { detail } : {}),
  }
  if ((request.data as { record?: unknown })?.record !== false) {
    await bookingRef.update({ money_checked: record })
  }
  return { booking_id: bookingIdRaw, verdict, mismatches, detail, money: quote?.money ?? null }
})
