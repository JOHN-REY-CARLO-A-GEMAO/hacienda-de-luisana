import { describe, expect, it } from 'vitest'
import {
  ADDITIONAL_NOTES_MAX,
  EVENT_DETAIL_MAX,
  INQUIRY_MESSAGE_MIN,
  MESSAGE_MAX,
  MIN_GUEST_AGE,
  NAME_MAX,
  REF_MAX,
  ageOn,
  guestCountValid,
  sanitizeAmountInput,
  sanitizeDigitsOnly,
  sanitizeNameInput,
  sanitizePhoneInput,
  sanitizeReferenceInput,
  validateAdditionalNotes,
  validateAddress,
  validateAmount,
  validateBirthdate,
  validateEmail,
  validateEventDetail,
  validateInquiryMessage,
  validateMessage,
  validateName,
  validatePhMobile,
  validateProofFile,
  validateSearch,
  validateStarRating,
  validateStayDates,
  validateSubject,
} from '../../src/lib/validation'
import { paginate, sortBy } from '../../src/lib/pagination'
import {
  extractReceiptFields,
  extractReferenceNumber,
  canAutoVerifyFromOcr,
  matchPaymentReference,
} from '../../src/lib/payments/ocr'
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

describe('validateProofFile', () => {
  it('refuses null or missing file', () => {
    expect(validateProofFile(null).ok).toBe(false)
    expect(validateProofFile(undefined).ok).toBe(false)
  })

  it('accepts valid JPG/PNG/WEBP files within size limit', () => {
    const validFile = new File(['dummy content'], 'proof.jpg', { type: 'image/jpeg' })
    expect(validateProofFile(validFile).ok).toBe(true)
  })

  it('refuses non-image file formats or oversized files', () => {
    const pdfFile = new File(['pdf content'], 'receipt.pdf', { type: 'application/pdf' })
    expect(validateProofFile(pdfFile).ok).toBe(false)

    const largeFile = new File([new ArrayBuffer(6 * 1024 * 1024)], 'large.png', { type: 'image/png' })
    expect(validateProofFile(largeFile).ok).toBe(false)
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
  it('extracts the 10–13 digit reference GCash, Maya and bank receipts carry', () => {
    // Labelled first — including references printed with spacing — then a
    // bare run; anything card-shaped (14–16 digits) or absent is ''.
    expect(extractReferenceNumber('GCash Ref No: 1234567890123 Amount: 1500')).toBe('1234567890123')
    expect(extractReferenceNumber('Maya transaction 987654321098')).toBe('987654321098')
    expect(extractReferenceNumber('Confirmation no. 1234 567 890123')).toBe('1234567890123')
    // A bank reference keeps only its 10–13 digit heart; a shorter run is nothing.
    expect(extractReferenceNumber('Bank ref: TRX-004455667788')).toBe('004455667788')
    expect(extractReferenceNumber('Bank ref: TRX-4455')).toBe('')
    expect(extractReferenceNumber('no digits at all')).toBe('')
    expect(extractReferenceNumber('1234567890123456')).toBe('')
  })

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
  it('locks after too many attempts and clears all buckets when resetRateLimit() is called with no key', () => {
    resetRateLimit('t')
    for (let i = 0; i < LIMITS.login.max; i++) expect(checkRateLimit('t', LIMITS.login).ok).toBe(true)
    expect(checkRateLimit('t', LIMITS.login).ok).toBe(false)

    for (let i = 0; i < LIMITS.register.max; i++) expect(checkRateLimit('reg', LIMITS.register).ok).toBe(true)
    expect(checkRateLimit('reg', LIMITS.register).ok).toBe(false)

    for (let i = 0; i < LIMITS.inquiry.max; i++) expect(checkRateLimit('inq', LIMITS.inquiry).ok).toBe(true)
    expect(checkRateLimit('inq', LIMITS.inquiry).ok).toBe(false)

    resetRateLimit()
    expect(checkRateLimit('t', LIMITS.login).ok).toBe(true)
    expect(checkRateLimit('reg', LIMITS.register).ok).toBe(true)
    expect(checkRateLimit('inq', LIMITS.inquiry).ok).toBe(true)
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

describe('strict name validation and sanitization', () => {
  it('validates names rejecting numbers and symbols', () => {
    expect(validateName('Juan Dela Cruz').ok).toBe(true)
    expect(validateName("Mary-Jane O'Connor").ok).toBe(true)
    expect(validateName('José Niña').ok).toBe(true)
    expect(validateName('Dr. Jose Rizal').ok).toBe(true)
    // Rejects numbers
    const numRes = validateName('Juan123')
    expect(numRes.ok).toBe(false)
    if (!numRes.ok) expect(numRes.message).toBe('Name cannot contain numbers')
    // Rejects symbols
    expect(validateName('Juan @ Dela Cruz').ok).toBe(false)
    // Rejects empty or too short
    expect(validateName('').ok).toBe(false)
    expect(validateName('J').ok).toBe(false)
    // Rejects too long
    expect(validateName('A'.repeat(NAME_MAX + 1)).ok).toBe(false)
  })

  it('sanitizeNameInput strips numbers and disallowed symbols while keeping legitimate characters', () => {
    expect(sanitizeNameInput('Juan123 Dela Cruz456')).toBe('Juan Dela Cruz')
    expect(sanitizeNameInput("Maria-Clara O'Connor")).toBe("Maria-Clara O'Connor")
    expect(sanitizeNameInput('José Niña')).toBe('José Niña')
    expect(sanitizeNameInput('St. John')).toBe('St. John')
    expect(sanitizeNameInput('John@Doe#123!')).toBe('JohnDoe')
    expect(sanitizeNameInput('A'.repeat(100)).length).toBe(NAME_MAX)
  })
})

describe('strict phone sanitization', () => {
  it('sanitizePhoneInput strips letters and non-phone symbols', () => {
    expect(sanitizePhoneInput('0917-123-4567')).toBe('0917-123-4567')
    expect(sanitizePhoneInput('+63 (917) 123 4567')).toBe('+63 (917) 123 4567')
    expect(sanitizePhoneInput('0917abc1234def')).toBe('09171234')
    expect(sanitizePhoneInput('phone: 0917!@#123')).toBe('0917123')
  })
})

describe('strict amount & reference sanitization', () => {
  it('sanitizeAmountInput allows numbers and at most 2 decimal places, rejecting letters', () => {
    expect(sanitizeAmountInput('1500')).toBe('1500')
    expect(sanitizeAmountInput('1500.50')).toBe('1500.50')
    expect(sanitizeAmountInput('1500.555')).toBe('1500.55')
    expect(sanitizeAmountInput('abc1500def.75')).toBe('1500.75')
    expect(sanitizeAmountInput('10.20.30')).toBe('10.20')
  })

  it('sanitizeReferenceInput allows alphanumeric and hyphens in uppercase, up to REF_MAX', () => {
    expect(sanitizeReferenceInput('gcash-123-abc')).toBe('GCASH-123-ABC')
    expect(sanitizeReferenceInput('ref#@!123')).toBe('REF123')
    expect(sanitizeReferenceInput('a'.repeat(50)).length).toBe(REF_MAX)
  })
})

describe('additional notes & event detail limits', () => {
  it('validateAdditionalNotes enforces 500 character ceiling', () => {
    expect(validateAdditionalNotes('').ok).toBe(true)
    expect(validateAdditionalNotes('Arriving around 2 PM with family.').ok).toBe(true)
    expect(validateAdditionalNotes('A'.repeat(ADDITIONAL_NOTES_MAX)).ok).toBe(true)
    const over = validateAdditionalNotes('A'.repeat(ADDITIONAL_NOTES_MAX + 1))
    expect(over.ok).toBe(false)
    if (!over.ok) expect(over.message).toContain(String(ADDITIONAL_NOTES_MAX))
  })

  it('validateEventDetail enforces 160 character ceiling', () => {
    expect(validateEventDetail('').ok).toBe(true)
    expect(validateEventDetail('Golden Wedding Anniversary').ok).toBe(true)
    expect(validateEventDetail('A'.repeat(EVENT_DETAIL_MAX)).ok).toBe(true)
    const over = validateEventDetail('A'.repeat(EVENT_DETAIL_MAX + 1))
    expect(over.ok).toBe(false)
    if (!over.ok) expect(over.message).toContain(String(EVENT_DETAIL_MAX))
  })
})

describe('address & subject validation', () => {
  it('validateAddress accepts legitimate addresses with numbers, letters, and punctuation', () => {
    expect(validateAddress('Block 4 Lot 12, Sample St., Brgy. San Isidro, Luisiana, Laguna').ok).toBe(true)
    expect(validateAddress('#123/B Apt. 4-A').ok).toBe(true)
    expect(validateAddress('').ok).toBe(false)
    expect(validateAddress('Bad address <script>').ok).toBe(false)
  })

  it('validateSubject enforces character limits', () => {
    expect(validateSubject('Booking Inquiry').ok).toBe(true)
    expect(validateSubject('Hi').ok).toBe(false) // too short
    expect(validateSubject('A'.repeat(121)).ok).toBe(false) // too long
  })
})

describe('message & feedback validation', () => {
  it('validateMessage accepts short chat replies within character limits and rejects empty or over-limit', () => {
    expect(validateMessage('OK').ok).toBe(true)
    expect(validateMessage('Thanks!').ok).toBe(true)
    expect(validateMessage('Hello, I would like to inquire about booking availability.').ok).toBe(true)
    expect(validateMessage('').ok).toBe(false)
    expect(validateMessage('   ').ok).toBe(false)
    expect(validateMessage('A'.repeat(MESSAGE_MAX)).ok).toBe(true)
    const over = validateMessage('A'.repeat(MESSAGE_MAX + 1))
    expect(over.ok).toBe(false)
    if (!over.ok) expect(over.message).toContain(String(MESSAGE_MAX))
  })

  it('validateInquiryMessage enforces 10-character minimum, MESSAGE_MAX ceiling, and markup rejection while allowing newlines', () => {
    expect(validateInquiryMessage('').ok).toBe(false)
    const empty = validateInquiryMessage('   ')
    expect(empty).toEqual({ ok: false, message: 'Message cannot be empty' })

    const short = validateInquiryMessage('Too short')
    expect(short.ok).toBe(false)
    if (!short.ok) expect(short.message).toContain(String(INQUIRY_MESSAGE_MIN))

    expect(validateInquiryMessage('A'.repeat(INQUIRY_MESSAGE_MIN)).ok).toBe(true)
    expect(
      validateInquiryMessage('Hello Hacienda,\nWe would like to ask about availability for December 15.').ok,
    ).toBe(true)

    const markup = validateInquiryMessage('Valid length <script>alert(1)</script> inquiry')
    expect(markup.ok).toBe(false)
    if (!markup.ok) expect(markup.message).toContain('< or >')

    expect(validateInquiryMessage('Valid length\u0000with null byte').ok).toBe(false)
    expect(validateInquiryMessage('A'.repeat(MESSAGE_MAX)).ok).toBe(true)
    expect(validateInquiryMessage('A'.repeat(MESSAGE_MAX + 1)).ok).toBe(false)
  })
})

describe('numeric guest count validation', () => {
  it('guestCountValid enforces minimum and maximum capacity', () => {
    expect(guestCountValid(2, 35, 'Main Villa').ok).toBe(true)
    expect(guestCountValid(0, 35, 'Main Villa').ok).toBe(false)
    expect(guestCountValid(-1, 35, 'Main Villa').ok).toBe(false)
    expect(guestCountValid(1.5 as any, 35, 'Main Villa').ok).toBe(false)
    expect(guestCountValid(36, 35, 'Main Villa').ok).toBe(false)
    const capExceeded = guestCountValid(40, 35, 'Main Villa')
    expect(capExceeded.ok).toBe(false)
    if (!capExceeded.ok) expect(capExceeded.message).toContain('35 guests')
  })

  it('sanitizeDigitsOnly extracts only numeric digits', () => {
    expect(sanitizeDigitsOnly('abc123def456')).toBe('123456')
    expect(sanitizeDigitsOnly('guests: 15!')).toBe('15')
    expect(sanitizeDigitsOnly('123456789', 5)).toBe('12345')
  })
})


