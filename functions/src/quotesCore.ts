/**
 * The two money-attestation callables, hosted without a runtime opinion.
 *
 * `quoteBooking` prices a stay from the Admin-published rates document and
 * stores the answer in server-only `booking_quotes/{id}`. `verifyBookingMoney`
 * gives the Admin a field-by-field verdict for a stored Booking. Firebase and
 * Cloudflare adapters supply Firestore/Auth transports; the authorization,
 * rate limits, quote identity, and price derivation remain identical.
 */

import { createHash } from 'node:crypto'
import { CallableError, type CallableContext } from './callable'
import { SERVER_TIMESTAMP, type DocumentData, type FirestoreLike } from './firestoreLike'
import {
  deriveQuote,
  MinuteBudget,
  moneyMismatches,
  parseQuoteRequest,
  quotePayload,
  ratesVersionDrift,
  unattestedVerdict,
  type AuthoritativeMoney,
  type MoneyVerdict,
  type QuoteCause,
  type QuoteRequest,
} from './pricing'
import { spendCallableQuota } from './rateLimitCore'

export interface AuthUserRecordLike {
  disabled?: boolean
  email?: string | null
  emailVerified?: boolean
}

export interface AuthUserLookup {
  getUser(uid: string): Promise<AuthUserRecordLike>
}

export interface QuotesCoreDependencies {
  db: FirestoreLike
  authUsers: AuthUserLookup
  quotesEnabled: boolean
  quoteTtlMinutes?: number
  quoteLimitPerMinute?: number
  verifyLimitPerMinute?: number
}

export interface QuoteBookingReply {
  quote_id: string
  money: AuthoritativeMoney
  bracket: unknown
  expires_at: string
  reused: boolean
}

export interface VerifyBookingMoneyReply {
  booking_id: string
  verdict: MoneyVerdict['verdict']
  mismatches: string[]
  detail: string
  money: AuthoritativeMoney | null
}

export interface QuotesCore {
  quoteBooking(context: CallableContext): Promise<QuoteBookingReply>
  verifyBookingMoney(context: CallableContext): Promise<VerifyBookingMoneyReply>
  resetRateLimits(): void
}

// Bootstrap Admin allowlist. Single source of truth is
// src/config/admin-roles.json (imported by src/lib/auth/profile.ts).
// This copy must be kept in sync manually with firestore.rules adminEmails(),
// storage.rules isAdminEmail(), database.rules.json, and
// lib/services/auth_store.dart kAdminEmails.
const bootstrapAdminEmails = ['gemaojohnreyarguilles@gmail.com']

function normalizedPositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && (value as number) >= 1 ? (value as number) : fallback
}

function quoteIdFor(boundUid: string, request: QuoteRequest, ratesVersion: string): string {
  return createHash('sha256').update(`${boundUid}|${quotePayload(request, ratesVersion)}`).digest('hex').slice(0, 32)
}

function causeToError(
  cause: QuoteCause,
  detail: string,
  guestMessage: string,
  status: string,
): CallableError {
  // The Admin-facing detail goes to the log, never to the browser: several
  // causes describe the estate's own configuration.
  console.error(`[quotes] ${cause}: ${detail}`)
  return new CallableError(status as CallableError['code'], guestMessage)
}

/** The attested figures, read back out of the flat stored document. */
function moneyOf(stored: DocumentData): AuthoritativeMoney {
  return {
    rate_unit: 'standard_stay',
    rate_amount: Number(stored.rate_amount),
    rate_classification: String(stored.rate_classification) as AuthoritativeMoney['rate_classification'],
    nights: Number(stored.nights),
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

export function createQuotesCore(deps: QuotesCoreDependencies): QuotesCore {
  const quoteTtlMinutesRaw = deps.quoteTtlMinutes ?? 30
  const quoteTtlMinutes = Number.isInteger(quoteTtlMinutesRaw)
    && quoteTtlMinutesRaw >= 1
    && quoteTtlMinutesRaw <= 240
    ? quoteTtlMinutesRaw
    : 30
  const quoteLimit = normalizedPositiveInteger(deps.quoteLimitPerMinute, 12)
  const verifyLimit = normalizedPositiveInteger(deps.verifyLimitPerMinute, 30)
  const quoteBudget = new MinuteBudget(quoteLimit)
  const verifyBudget = new MinuteBudget(verifyLimit)

  function enabled(): void {
    if (!deps.quotesEnabled) {
      throw new CallableError('unavailable', 'Price confirmation is not enabled on this deployment.')
    }
  }

  async function isWriterAdmin(uid: string): Promise<boolean> {
    try {
      const user = await deps.authUsers.getUser(uid)
      const profile = (await deps.db.doc(`profiles/${uid}`).get()).data()
      return !user.disabled
        && ((user.emailVerified && bootstrapAdminEmails.includes((user.email || '').toLowerCase())) || profile?.role === 'admin')
    } catch {
      return false
    }
  }

  async function quoteBooking(context: CallableContext): Promise<QuoteBookingReply> {
    enabled()
    // The attestation is bound to an identity, so an identity is a
    // precondition. The Guest flow signs in anonymously before submitting.
    const callerUid = context.authUid ?? ''
    if (callerUid === '') {
      throw new CallableError('unauthenticated', 'We need to reconnect you before we can confirm a price. Please try again.')
    }
    const parsed = parseQuoteRequest(context.data)
    if (!parsed.ok) throw causeToError(parsed.cause, parsed.detail, parsed.guestMessage, parsed.status)

    await spendCallableQuota({
      firestore: deps.db,
      budget: quoteBudget,
      scope: 'quoteBooking',
      key: callerUid,
      limit: quoteLimit,
      formatMessage: (seconds) => `Too many price requests from here. Wait ${seconds}s, then try again.`,
    })

    const [ratesDoc, configDoc] = await Promise.all([
      deps.db.doc('site_config/rates').get(),
      deps.db.doc('site_config/booking').get(),
    ])
    const derived = deriveQuote(ratesDoc.exists ? ratesDoc.data() : null, parsed.value, {
      now: Date.now(),
      bookingConfig: configDoc.data() ?? null,
    })
    if (!derived.ok) throw causeToError(derived.cause, derived.detail, derived.guestMessage, derived.status)

    const boundUid = callerUid
    const id = quoteIdFor(boundUid, parsed.value, derived.quote.rates_version)
    const ref = deps.db.doc(`booking_quotes/${id}`)
    const existing = await ref.get()
    const existingData = existing.data()
    const now = Date.now()
    if (existingData && typeof existingData.expires_at_ms === 'number' && existingData.expires_at_ms > now) {
      // Same party, same payload, same published version, still live: hand
      // back the quote that exists instead of sliding its expiry forward.
      return {
        quote_id: id,
        money: moneyOf(existingData),
        bracket: existingData.bracket,
        expires_at: new Date(existingData.expires_at_ms).toISOString(),
        reused: true,
      }
    }

    const expiresAtMs = now + quoteTtlMinutes * 60_000
    // Flat deliberately: firestore.rules compares this document with the
    // Booking field for field.
    const document: DocumentData = {
      ...parsed.value,
      ...derived.quote.money,
      rates_version: derived.quote.rates_version,
      bracket: derived.quote.bracket,
      bound_uid: boundUid,
      created_at: SERVER_TIMESTAMP,
      expires_at: new Date(expiresAtMs),
      expires_at_ms: expiresAtMs,
    }
    await ref.set(document)
    return {
      quote_id: id,
      money: derived.quote.money,
      bracket: derived.quote.bracket,
      expires_at: new Date(expiresAtMs).toISOString(),
      reused: false,
    }
  }

  async function verifyBookingMoney(context: CallableContext): Promise<VerifyBookingMoneyReply> {
    enabled()
    const authUid = context.authUid ?? ''
    if (!authUid) throw new CallableError('unauthenticated', 'Sign in as the Hacienda to verify a Booking’s money.')
    if (!(await isWriterAdmin(authUid))) {
      throw new CallableError('permission-denied', 'Only the Hacienda can verify a Booking’s money.')
    }

    const requestData = (context.data ?? {}) as { bookingId?: unknown; record?: unknown }
    const bookingIdRaw = requestData.bookingId
    if (typeof bookingIdRaw !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(bookingIdRaw)) {
      throw new CallableError('invalid-argument', 'A Booking id is required.')
    }
    await spendCallableQuota({
      firestore: deps.db,
      budget: verifyBudget,
      scope: 'verifyBookingMoney',
      key: authUid,
      limit: verifyLimit,
      label: 'money verification',
    })

    const bookingRef = deps.db.doc(`bookings/${bookingIdRaw}`)
    const bookingDoc = await bookingRef.get()
    if (!bookingDoc.exists) throw new CallableError('not-found', 'No Booking with that id.')
    const booking = { id: bookingDoc.id, ...(bookingDoc.data() ?? {}) } as DocumentData

    const [ratesDoc, configDoc] = await Promise.all([
      deps.db.doc('site_config/rates').get(),
      deps.db.doc('site_config/booking').get(),
    ])
    const ratesData = ratesDoc.data() ?? {}
    const quoteId = typeof booking.quote_id === 'string' ? booking.quote_id : ''
    const quoteDoc = quoteId ? await deps.db.doc(`booking_quotes/${quoteId}`).get() : null
    const quoteData = quoteDoc?.exists ? (quoteDoc.data() ?? {}) : null
    const quote = quoteData
      ? {
          request: {
            accommodation: String(quoteData.accommodation),
            check_in: String(quoteData.check_in),
            check_out: String(quoteData.check_out),
            guests: Number(quoteData.guests),
            pet_count: Number(quoteData.pet_count ?? 0),
            late_checkout_hours: Number(quoteData.late_checkout_hours ?? 0),
          },
          money: moneyOf(quoteData),
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

    let verdict: MoneyVerdict['verdict']
    let mismatches: string[] = []
    let detail = ''

    if (!parsed.ok) {
      verdict = 'UNPARSEABLE'
      detail = parsed.detail
    } else {
      const fresh = deriveQuote(ratesDoc.exists ? ratesDoc.data() : null, parsed.value, {
        now: Date.now(),
        bookingConfig: configDoc.data() ?? null,
      })
      if (!fresh.ok) {
        verdict = 'NO_RATE'
        detail = fresh.detail
      } else if (quote && quoteData) {
        mismatches = moneyMismatches(booking, quote)
        verdict = mismatches.length === 0 ? 'MATCH' : 'MISMATCH'
        if (quoteData.bound_uid !== '' && quoteData.bound_uid !== booking.uid) {
          mismatches = [...mismatches, 'bound_uid']
          verdict = 'MISMATCH'
          detail = 'the quote belongs to a different identity than the Booking it is attached to'
        }
        if (Number(quoteData.expires_at_ms ?? 0) < Date.now()) {
          detail = detail || 'the quote had already expired when the Booking was written'
        }
      } else {
        const verdict0 = unattestedVerdict(fresh, booking, String(ratesData.version ?? ''), quoteId !== '')
        verdict = verdict0.verdict === 'MATCH'
          ? 'MATCH'
          : verdict0.verdict === 'MISMATCH'
            ? 'MISMATCH'
            : verdict0.verdict === 'NO_RATE'
              ? 'NO_RATE'
              : 'UNPARSEABLE'
        mismatches = verdict0.mismatches
        detail = verdict0.detail
      }
      if (ratesDoc.exists && ratesVersionDrift(booking, String(ratesData.version ?? ''))) {
        detail = detail || 'the Booking was stamped with an earlier rate version than the one published now'
      }
    }

    const record: DocumentData = {
      at: SERVER_TIMESTAMP,
      by: authUid,
      verdict,
      mismatches,
      quote_id: quoteId || null,
      rates_version: ratesDoc.exists ? String(ratesData.version ?? '') : null,
      ...(detail ? { detail } : {}),
    }
    if (requestData.record !== false) {
      await bookingRef.update({ money_checked: record })
    }
    return { booking_id: bookingIdRaw, verdict, mismatches, detail, money: quote?.money ?? null }
  }

  return {
    quoteBooking,
    verifyBookingMoney,
    resetRateLimits() {
      quoteBudget.reset()
      verifyBudget.reset()
    },
  }
}
