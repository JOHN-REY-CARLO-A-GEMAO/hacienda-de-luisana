// Ticket #14: the Guest uploads payment proof from the website. The contract
// lives under /payments — never in the KYC slot, so an ID review and a money
// review can never read each other's documents — under the same limits
// storage.rules enforces (5MB, image/*, own-uid write, Admin read).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PROOF_MAX_BYTES,
  nextProofAttempt,
  proofContentType,
  proofObjectPath,
  uploadPaymentProof,
  validateProofFile,
} from '../../src/lib/payments'

describe('proofObjectPath', () => {
  it('writes under /payments, one folder per booking reference', () => {
    expect(
      proofObjectPath({ uid: 'anon-123', bookingRefId: 'HDL-4821', filename: 'gcash.png', attempt: 1 }),
    ).toBe('payments/anon-123/HDL-4821/proof-1.png')
  })

  it('uppercases the reference and strips everything outside [A-Za-z0-9-]', () => {
    expect(
      proofObjectPath({ uid: 'u1', bookingRefId: 'hdl_48a2/1 x', filename: 'proof.jpg', attempt: 1 }),
    ).toBe('payments/u1/HDL48A21X/proof-1.jpg')
  })

  it('never lands in the KYC slot', () => {
    expect(
      proofObjectPath({ uid: 'u1', bookingRefId: 'R1', filename: 'a.jpg', attempt: 1 }),
    ).not.toContain('kyc/')
  })

  it('falls back to jpg for an extension nobody whitelisted', () => {
    expect(
      proofObjectPath({ uid: 'u1', bookingRefId: 'R1', filename: 'receipt.pdf', attempt: 1 }),
    ).toBe('payments/u1/R1/proof-1.jpg')
    expect(
      proofObjectPath({ uid: 'u1', bookingRefId: 'R1', filename: 'photo.HEIC', attempt: 2 }),
    ).toBe('payments/u1/R1/proof-2.heic')
  })

  it('gives every attempt its own object, so a re-send never overwrites', () => {
    const first = proofObjectPath({ uid: 'u1', bookingRefId: 'R1', filename: 'a.png', attempt: 1 })
    const second = proofObjectPath({ uid: 'u1', bookingRefId: 'R1', filename: 'b.png', attempt: 2 })
    expect(first).not.toBe(second)
  })
})

/**
 * The attempt counter exists because a re-send is a second object rather than a
 * replacement, and that is forced from two directions at once.
 */
describe('nextProofAttempt', () => {
  it('starts at 1 for a Booking with no proof yet', () => {
    expect(nextProofAttempt(null)).toBe(1)
    expect(nextProofAttempt(undefined)).toBe(1)
    expect(nextProofAttempt('')).toBe(1)
  })

  it('counts on from the path already recorded on the Booking', () => {
    expect(nextProofAttempt('payments/u1/R1/proof-1.png')).toBe(2)
    expect(nextProofAttempt('payments/u1/R1/proof-2.jpg')).toBe(3)
    expect(nextProofAttempt('payments/u1/R1/proof-12.webp')).toBe(13)
  })

  it('moves off a legacy un-numbered path, so the rules see a changed proof', () => {
    // firestore.rules only lets a Guest clear a payment_reject_reason when
    // payment_proof_url changes in the same write, so attempt 1 has to differ
    // from whatever is already stored.
    expect(nextProofAttempt('payments/u1/R1/proof.png')).toBe(1)
    expect(nextProofAttempt('payments/u1/R1/proof.png')).not.toBe(
      'payments/u1/R1/proof.png',
    )
  })

  it('never returns a path equal to the one it was given', () => {
    for (const previous of [
      'payments/u1/R1/proof-1.png',
      'payments/u1/R1/proof-7.jpg',
      'payments/u1/R1/proof.png',
    ]) {
      const next = proofObjectPath({
        uid: 'u1',
        bookingRefId: 'R1',
        filename: 'again.png',
        attempt: nextProofAttempt(previous),
      })
      expect(next).not.toBe(previous)
    }
  })
})

/**
 * Regression: `upsert: true` is refused by Supabase on this bucket.
 *
 * It sends `Prefer: resolution=merge-duplicates`, which evaluates the *update*
 * policy alongside the insert one, and the `anon` role has no read grant on
 * `payment-proofs` — so every upsert came back as
 * `42501 new row violates row-level security policy`, on a first upload as much
 * as a re-send. No Guest could complete a booking at all.
 *
 * The only way to allow it would be an `anon` select policy, which publishes
 * every Guest's receipt (the anon key is inside the public Vite bundle). So the
 * upload must stay a plain insert, and the test that stops it coming back is
 * the absence of the option.
 */
describe('the Supabase upload never upserts', () => {
  const source = readFileSync(join(__dirname, '../../src/lib/storage.ts'), 'utf8')
  // Whole-line comments only, which is how this file writes them. The point is
  // to assert on code, not on the comment explaining why the option is absent.
  const code = source
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n')

  it('does not pass upsert, which Supabase refuses on this bucket', () => {
    expect(code).not.toMatch(/upsert:\s*true/)
  })

  it('declares the bucket private-only, so no anon read can creep in', () => {
    // An anon read policy on this bucket is the one change that would publish
    // every Guest's GCash receipt; supabase-storage.test.ts reads the SQL file
    // and fails on it. This guards the client half of the same promise.
    expect(code).not.toMatch(/\.download\(/)
    expect(code).not.toMatch(/createSignedUrl/)
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

// ADR-0011: with no Supabase keys the upload falls back to this browser —
// the same demo-mode posture the site takes for Firebase itself.
describe('uploadPaymentProof in demo mode (no Supabase keys)', () => {
  beforeEach(() => localStorage.clear())

  it('keeps the screenshot in this browser and returns the storage path', async () => {
    const file = new File(['fake-png-bytes'], 'gcash.png', { type: 'image/png' })
    const out = await uploadPaymentProof({ file, bookingRefId: 'HDL-9' })

    expect(out.ok).toBe(true)
    if (!out.ok) return
    // The Booking records this path (paymentProofUrl / payment_proof_url).
    expect(out.url).toMatch(/^payments\//)
    expect(out.url).toContain('HDL-9')
    expect(out.url).toBe('payments/demo/HDL-9/proof-1.png')

    const stored = JSON.parse(localStorage.getItem('hdl:payment-proofs') ?? '{}')
    expect(stored[out.url]).toMatch(/^data:image\/png;base64,/)
  })

  it('keeps both attempts when a proof is re-sent', async () => {
    const file = new File(['first'], 'gcash.png', { type: 'image/png' })
    const first = await uploadPaymentProof({ file, bookingRefId: 'HDL-9' })
    const second = await uploadPaymentProof({ file, bookingRefId: 'HDL-9', attempt: 2 })
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return

    const stored = JSON.parse(localStorage.getItem('hdl:payment-proofs') ?? '{}')
    expect(Object.keys(stored).sort()).toEqual([first.url, second.url].sort())
  })

  it('refuses an oversized or non-image file before anything is stored', async () => {
    const pdf = new File(['x'], 'receipt.pdf', { type: 'application/pdf' })
    const out = await uploadPaymentProof({ file: pdf, bookingRefId: 'HDL-9' })

    expect(out.ok).toBe(false)
    expect(localStorage.getItem('hdl:payment-proofs')).toBeNull()
  })
})
