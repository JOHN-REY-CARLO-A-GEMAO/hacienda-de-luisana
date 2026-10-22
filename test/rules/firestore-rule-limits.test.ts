/**
 * Compile-time and evaluation-cost limits.
 *
 * The first half of this file reads the rules text (Firestore's documented
 * ten-`let`-binding-per-function limit). The second half *executes* it against the
 * offline evaluator and asserts on what the run cost, because the failure this
 * repository has actually been burned by is a clause that is legal but too
 * expensive: `firestore.rules` reported a budget error as an ordinary
 * `permission-denied` while the suite stayed green (ADR-0018).
 *
 * Read the numbers for what they are. `expressions` counts operations and operands
 * visited by this evaluator, not by Firestore's compiler, and the two are not on the
 * same scale — the unmodified Guest booking path already measures ~1,180 here while
 * the same file deploys. So the absolute ceiling below is a **canary, not a
 * certificate**: it exists so that adding another descent trips a test and forces an
 * emulator run, rather than so that a green suite can be read as "deployable". What
 * *is* directly comparable to a documented limit is the read count (Firestore allows
 * 20 document reads for a single-document request), and what is directly comparable
 * to *nothing* is the delta between enforced and un-enforced, which is why the
 * attestation's cost is asserted as a delta.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const rules = readFileSync(join(__dirname, '../../firestore.rules'), 'utf8')

/** Strip comments without treating comment-like text inside a string as a comment. */
function withoutComments(source: string): string {
  let result = ''
  let quote: "'" | '"' | null = null
  let escaped = false
  let lineComment = false
  let blockComment = false

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index]
    const next = source[index + 1]

    if (lineComment) {
      if (current === '\n') {
        lineComment = false
        result += current
      }
      continue
    }
    if (blockComment) {
      if (current === '*' && next === '/') {
        blockComment = false
        index += 1
      } else if (current === '\n') {
        result += current
      }
      continue
    }
    if (quote) {
      result += current
      if (escaped) escaped = false
      else if (current === '\\') escaped = true
      else if (current === quote) quote = null
      continue
    }
    if (current === "'" || current === '"') {
      quote = current
      result += current
    } else if (current === '/' && next === '/') {
      lineComment = true
      index += 1
    } else if (current === '/' && next === '*') {
      blockComment = true
      index += 1
    } else {
      result += current
    }
  }

  return result
}

function functionLetBindings(source: string): Array<{ name: string; count: number }> {
  const code = withoutComments(source)
  const declaration = /\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*\{/g
  const functions: Array<{ name: string; count: number }> = []
  let match: RegExpExecArray | null

  while ((match = declaration.exec(code)) !== null) {
    const name = match[1]
    const bodyStart = declaration.lastIndex
    let depth = 1
    let quote: "'" | '"' | null = null
    let escaped = false
    let bodyEnd = bodyStart

    for (; bodyEnd < code.length && depth > 0; bodyEnd += 1) {
      const current = code[bodyEnd]
      if (quote) {
        if (escaped) escaped = false
        else if (current === '\\') escaped = true
        else if (current === quote) quote = null
      } else if (current === "'" || current === '"') {
        quote = current
      } else if (current === '{') {
        depth += 1
      } else if (current === '}') {
        depth -= 1
      }
    }

    const body = code.slice(bodyStart, bodyEnd - 1)
    const count = (body.match(/^\s*let\s+[A-Za-z_][A-Za-z0-9_]*\s*=/gm) ?? []).length
    functions.push({ name, count })
    declaration.lastIndex = bodyEnd
  }

  return functions
}

describe('Firestore Rules compile-time limits', () => {
  it('keeps every function within Firestore’s ten-let-binding limit', () => {
    const overLimit = functionLetBindings(rules).filter(({ count }) => count > 10)
    expect(overLimit, `Rules functions exceed the ten-binding limit: ${JSON.stringify(overLimit)}`).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Measured cost, on the real rules text, executed.
// ---------------------------------------------------------------------------
import { compileRules, ruleTimestamp, type DocData, type Store } from './engine'
import { allowlistedAdmin, anonymousGuest, bookingDoc, GUEST_UID, request } from './context'

const decide = compileRules(rules)
const AT = '2026-10-01T04:00:00Z'
const TOTAL = 5000
const DUE = 2500

const card: DocData = {
  version: 'official-v9', effective_date: '2026-10-01', holiday_dates: [],
  accommodations: {
    'main-house': {
      rate_unit: 'standard_stay', active: true, security_deposit: 500, down_payment_percent: 50,
      available_units: 1,
      guest_pricing: {
        units_per_booking: 1,
        weekday: { min_guests: 1, base_max_guests: 10, base_rate: TOTAL, excess_per_guest: 500 },
        weekend_holiday: { min_guests: 1, base_max_guests: 10, base_rate: TOTAL, excess_per_guest: 500 },
      },
    },
  },
}

const attestation: DocData = {
  accommodation: 'main-house', check_in: '2026-10-31', check_out: '2026-11-01', guests: 10,
  pet_count: 0, late_checkout_hours: 0, rate_unit: 'standard_stay', rate_amount: TOTAL,
  rate_classification: 'weekday', nights: 1, stay_total: TOTAL, amount_due: DUE, balance_due: DUE,
  security_deposit: 500, payment_plan: 'down-payment', policy_version: 'official-v9',
  policy_effective_date: '2026-10-01', rates_version: 'official-v9', refund_policy_snapshot: null,
  bound_uid: GUEST_UID, created_at: ruleTimestamp(AT), expires_at: ruleTimestamp('2026-10-01T05:00:00.000Z'),
}

const booking: DocData = bookingDoc({
  accommodation: 'main-house', check_in: '2026-10-31', check_out: '2026-11-01', guests: 10, nights: 1,
  status: 'Pending', payment_status: 'pending', payment_plan: 'down-payment',
  payment_proof_url: 'payments/guest-uid-1/HDL/proof-1.png', rate_unit: 'standard_stay',
  rate_amount: TOTAL, rate_classification: 'weekday', stay_total: TOTAL, amount_due: DUE,
  balance_due: DUE, security_deposit: 500, amount_claimed: DUE, policy_version: 'official-v9',
  policy_effective_date: '2026-10-01', quote_id: 'quote-1',
})

// The attestation document is present in *both* stores. That is the production
// shape — the callable mints quotes whether or not the estate is enforcing them — and
// it is also what makes the measurement meaningful, because a missing document is
// *cheaper* (the comparison chain short-circuits on its first `null`), so a store
// without quotes would flatter the enforced path by ~370 nodes.
const storeWith = (quotesRequired: boolean, extra: DocData = {}): Store => ({
  'site_config/rates': card,
  'site_config/booking': { quotes_required: quotesRequired },
  'booking_quotes/quote-1': attestation,
  [`profiles/${GUEST_UID}`]: { uid: GUEST_UID, role: 'guest' },
  ...extra,
})

const guestCreate = (enforce: boolean, data: DocData = booking) => decide(
  request({ method: 'create', path: 'bookings/cost-probe', auth: anonymousGuest(), requestData: data, time: AT }),
  { store: storeWith(enforce) },
)

describe('what the callable-only create boundary costs', () => {
  const off = guestCreate(false)
  const on = guestCreate(true)

  it('refuses direct Guest creation before reading rate or quote documents', () => {
    expect(off.allow).toBe(false)
    expect(on.allow).toBe(false)
    // `isAdmin` checks the bootstrap allowlist and stored Profile role. Neither
    // read is a rates, quote, or Booking inventory read.
    expect(off.reads).toBeLessThanOrEqual(2)
    expect(on.reads).toBeLessThanOrEqual(2)
  })

  it('does not let obsolete quote-enforcement configuration change that decision', () => {
    expect(on.allow).toBe(off.allow)
    expect(on.reads).toBe(off.reads)
    expect(Math.abs(on.expressions - off.expressions)).toBeLessThanOrEqual(10)
  })

  it('keeps the closed direct path comfortably below the evaluator canary', () => {
    expect(on.expressions, `closed Guest create measured ${on.expressions} nodes`).toBeLessThan(500)
  })

  it('preserves Admin manual creation without consulting an attestation', () => {
    const admin = decide(request({
      method: 'create', path: 'bookings/cost-probe-admin', auth: allowlistedAdmin(),
      requestData: { ...booking, quote_id: null }, time: AT,
    }), { store: storeWith(true) })
    expect(admin.allow).toBe(true)
    expect(admin.reads).toBeLessThanOrEqual(1)
    expect(admin.expressions).toBeLessThan(500)
  })
})
