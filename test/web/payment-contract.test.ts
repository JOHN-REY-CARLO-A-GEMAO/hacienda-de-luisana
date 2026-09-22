// Ticket #14: the Guest uploads payment proof from the website. The contract
// lives under /payments — never in the KYC slot, so an ID review and a money
// review can never read each other's documents — under the same limits
// storage.rules enforces (5MB, image/*, own-uid write, Host read).
import { proofContentType, proofObjectPath, validateProofFile, PROOF_MAX_BYTES } from '../../src/lib/payments'

describe('proofObjectPath', () => {
  it('writes under /payments, one proof per booking reference', () => {
    expect(proofObjectPath({ uid: 'anon-123', bookingRefId: 'HDL-4821', filename: 'gcash.png' })).toBe(
      'payments/anon-123/HDL-4821/proof.png',
    )
  })

  it('uppercases the reference and strips everything outside [A-Za-z0-9-]', () => {
    expect(proofObjectPath({ uid: 'u1', bookingRefId: 'hdl_48a2/1 x', filename: 'proof.jpg' })).toBe(
      'payments/u1/HDL48A21X/proof.jpg',
    )
  })

  it('never lands in the KYC slot', () => {
    expect(proofObjectPath({ uid: 'u1', bookingRefId: 'R1', filename: 'a.jpg' })).not.toContain('kyc/')
  })

  it('falls back to jpg for an extension nobody whitelisted', () => {
    expect(proofObjectPath({ uid: 'u1', bookingRefId: 'R1', filename: 'receipt.pdf' })).toBe(
      'payments/u1/R1/proof.jpg',
    )
    expect(proofObjectPath({ uid: 'u1', bookingRefId: 'R1', filename: 'photo.HEIC' })).toBe(
      'payments/u1/R1/proof.heic',
    )
  })
})

describe('proofContentType', () => {
  it('declares an image content type', () => {
    expect(proofContentType('proof.jpg')).toBe('image/jpeg')
    expect(proofContentType('proof.png')).toBe('image/png')
    expect(proofContentType('proof.webp')).toBe('image/webp')
    expect(proofContentType('proof.heic')).toBe('image/heic')
  })
})

describe('validateProofFile', () => {
  const file = (over: Partial<{ name: string; size: number; type: string }> = {}) => ({
    name: 'gcash.png',
    size: 2 * 1024 * 1024,
    type: 'image/png',
    ...over,
  })

  it('accepts an image inside the limit', () => {
    expect(validateProofFile(file())).toEqual({ ok: true })
    expect(validateProofFile(file({ type: '' }))).toEqual({ ok: true })
  })

  it('refuses anything over 5MB before the bytes leave the device', () => {
    expect(PROOF_MAX_BYTES).toBe(5 * 1024 * 1024)
    expect(validateProofFile(file({ size: PROOF_MAX_BYTES + 1 }))).toMatchObject({
      ok: false,
      reason: 'too-large',
    })
  })

  it('refuses exactly 5MB, because storage.rules says "less than" and the rule is the authority', () => {
    expect(validateProofFile(file({ size: PROOF_MAX_BYTES }))).toMatchObject({ ok: false, reason: 'too-large' })
    expect(validateProofFile(file({ size: PROOF_MAX_BYTES - 1 }))).toEqual({ ok: true })
  })

  it('refuses a file that is not an image', () => {
    expect(validateProofFile(file({ type: 'application/pdf', name: 'receipt.pdf' }))).toMatchObject({
      ok: false,
      reason: 'wrong-type',
    })
  })
})
