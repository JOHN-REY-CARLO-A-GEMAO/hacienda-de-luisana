import { describe, expect, it } from 'vitest'
import {
  MIN_GUEST_AGE,
  ageOn,
  validateAmount,
  validateBirthdate,
  validateEmail,
  validatePhMobile,
  validateSearch,
  validateStayDates,
  validateStarRating,
} from '../../src/lib/validation'
import { paginate, sortBy } from '../../src/lib/pagination'
import { extractReceiptFields, canAutoVerifyFromOcr, matchPaymentReference } from '../../src/lib/payments/ocr'
import { checkRateLimit, resetRateLimit, LIMITS } from '../../src/lib/rateLimit'
import { LEGAL_VERSION, isAcceptanceCurrent, recordAcceptance } from '../../src/lib/legal'
import { isActiveCategory } from '../../src/lib/categories'

describe('age / birthdate', () => {
  it('rejects under-10 using calendar age, not a hard-coded year', () => {
    expect(ageOn('2016-09-25', '2026-09-24')).toBe(9)
    const r = validateBirthdate('2016-09-25', new Date('2026-09-24T12:00:00Z'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain(String(MIN_GUEST_AGE))
  })

  it('accepts a guest who turned 10 today', () => {
    const r = validateBirthdate('2016-09-24', new Date('2026-09-24T12:00:00Z'))
    expect(r.ok).toBe(true)
  })

  it('rejects future birthdates and invalid leap days', () => {
    expect(validateBirthdate('2099-01-01', new Date('2026-09-24T12:00:00Z')).ok).toBe(false)
    expect(validateBirthdate('2015-02-29', new Date('2026-09-24T12:00:00Z')).ok).toBe(false)
    expect(validateBirthdate('2016-02-29', new Date('2026-09-24T12:00:00Z')).ok).toBe(true)
  })
})

describe('phone', () => {
  it('accepts 11-digit PH mobiles and refuses letters or truncation', () => {
    expect(validatePhMobile('09171234567').ok).toBe(true)
    expect(validatePhMobile('+63 917 123 4567').ok).toBe(true)
    expect(validatePhMobile('0917ABC4567').ok).toBe(false)
    expect(validatePhMobile('091712345678').ok).toBe(false)
    expect(validatePhMobile('9171234567').ok).toBe(false)
  })
})

describe('dates', () => {
  it('orders check-in before check-out and blocks past check-in', () => {
    const now = new Date('2026-09-24T00:00:00Z')
    expect(validateStayDates('2026-09-20', '2026-09-26', now).ok).toBe(false)
    expect(validateStayDates('2026-09-26', '2026-09-26', now).ok).toBe(false)
    expect(validateStayDates('2026-09-26', '2026-09-28', now).ok).toBe(true)
  })
})

describe('email / amount / search / rating', () => {
  it('validates formats', () => {
    expect(validateEmail('a@b.com').ok).toBe(true)
    expect(validateEmail('nope').ok).toBe(false)
    expect(validateAmount('1,250.50').ok).toBe(true)
    expect(validateAmount('-2').ok).toBe(false)
    expect(validateSearch('').ok).toBe(true)
    expect(validateSearch('x'.repeat(81)).ok).toBe(false)
    expect(validateStarRating(5).ok).toBe(true)
    expect(validateStarRating(0).ok).toBe(false)
  })
})

describe('pagination + sort', () => {
  it('pages after sorting', () => {
    const rows = [{ name: 'c' }, { name: 'a' }, { name: 'b' }]
    const sorted = sortBy(rows, 'name', 'asc')
    const page = paginate(sorted, { page: 2, pageSize: 2 })
    expect(page.items.map((r) => r.name)).toEqual(['c'])
    expect(page.hasPrev).toBe(true)
    expect(page.hasNext).toBe(false)
  })
})

describe('OCR is not verification', () => {
  it('extracts reference and amount from receipt text', () => {
    const e = extractReceiptFields('GCash Ref: 1234567890123 Amount: PHP 1500.00')
    expect(e.reference).toBe('1234567890123')
    expect(e.amount).toBe('1500.00')
    expect(canAutoVerifyFromOcr()).toBe(false)
  })

  it('flags unknown or duplicate catalog references', () => {
    const catalog = [{ reference: 'ABC-1', amount: 100, usedBy: 'b1' }]
    expect(matchPaymentReference({ reference: 'NOPE', amount: 100, catalog }).exists).toBe(false)
    const dup = matchPaymentReference({ reference: 'ABC-1', amount: 100, catalog, alreadyUsedBy: 'b2' })
    expect(dup.duplicate).toBe(true)
  })
})

describe('rate limit', () => {
  it('locks after too many attempts', () => {
    resetRateLimit('t')
    for (let i = 0; i < LIMITS.login.max; i++) expect(checkRateLimit('t', LIMITS.login).ok).toBe(true)
    expect(checkRateLimit('t', LIMITS.login).ok).toBe(false)
  })
})

describe('legal + categories', () => {
  it('does not silently accept terms', () => {
    expect(isAcceptanceCurrent(null)).toBe(false)
    const a = recordAcceptance(new Date('2026-09-24T00:00:00Z'))
    expect(a.accepted).toBe(true)
    expect(a.version).toBe(LEGAL_VERSION)
    expect(isAcceptanceCurrent(a)).toBe(true)
  })

  it('only lists active known categories', () => {
    expect(isActiveCategory('gcash', 'payment')).toBe(true)
    expect(isActiveCategory('made-up')).toBe(false)
  })
})
