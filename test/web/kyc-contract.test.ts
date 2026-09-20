// Ticket #13: the Guest can upload ID and receipt from the website, not only
// from the mobile app. The contract is not invented here — it is the one
// lib/services/kyc_storage.dart and storage.rules already agree on, so the two
// apps write to the same place under the same limits.
import { kycContentType, kycObjectPath, validateKycFile, KYC_MAX_BYTES } from '../../src/lib/kyc'

describe('kycObjectPath', () => {
  it('writes to the same path the Flutter app writes to', () => {
    expect(
      kycObjectPath({ uid: 'anon-123', bookingRefId: 'HDL-4821', kind: 'id', filename: 'drivers-license.jpg' }),
    ).toBe('kyc/anon-123/HDL-4821/id.jpg')
  })

  it('uppercases the reference and strips everything the Flutter app strips', () => {
    // Dart keeps [A-Za-z0-9-] and uppercases; the web must land on the same
    // address or the two apps write two copies of the same document.
    expect(
      kycObjectPath({ uid: 'u1', bookingRefId: 'hdl_48a2/1 x', kind: 'receipt', filename: 'proof.png' }),
    ).toBe('kyc/u1/HDL48A21X/receipt.png')
  })

  it('keeps the two kinds apart, so a receipt can never sit where the ID belongs', () => {
    expect(kycObjectPath({ uid: 'u1', bookingRefId: 'R1', kind: 'id', filename: 'a.jpg' })).toBe('kyc/u1/R1/id.jpg')
    expect(kycObjectPath({ uid: 'u1', bookingRefId: 'R1', kind: 'receipt', filename: 'a.jpg' })).toBe(
      'kyc/u1/R1/receipt.jpg',
    )
  })

  it('falls back to jpg for an extension nobody whitelisted', () => {
    expect(kycObjectPath({ uid: 'u1', bookingRefId: 'R1', kind: 'id', filename: 'scan.pdf' })).toBe('kyc/u1/R1/id.jpg')
    expect(kycObjectPath({ uid: 'u1', bookingRefId: 'R1', kind: 'id', filename: 'no-extension' })).toBe(
      'kyc/u1/R1/id.jpg',
    )
    expect(kycObjectPath({ uid: 'u1', bookingRefId: 'R1', kind: 'id', filename: 'photo.HEIC' })).toBe(
      'kyc/u1/R1/id.heic',
    )
  })
})

describe('kycContentType', () => {
  it('declares the same content type the Dart app declares', () => {
    expect(kycContentType('id.jpg')).toBe('image/jpeg')
    expect(kycContentType('id.jpeg')).toBe('image/jpeg')
    expect(kycContentType('id.png')).toBe('image/png')
    expect(kycContentType('id.webp')).toBe('image/webp')
    expect(kycContentType('id.heic')).toBe('image/heic')
  })
})

describe('validateKycFile', () => {
  const file = (over: Partial<{ name: string; size: number; type: string }> = {}) => ({
    name: 'id.jpg',
    size: 2 * 1024 * 1024,
    type: 'image/jpeg',
    ...over,
  })

  it('accepts an image inside the limit', () => {
    expect(validateKycFile(file())).toEqual({ ok: true })
    expect(validateKycFile(file({ type: 'image/png', name: 'id.png' }))).toEqual({ ok: true })
    expect(validateKycFile(file({ type: 'image/webp', name: 'id.webp' }))).toEqual({ ok: true })
  })

  it('refuses anything over 5MB before the bytes leave the device', () => {
    expect(KYC_MAX_BYTES).toBe(5 * 1024 * 1024)
    expect(validateKycFile(file({ size: KYC_MAX_BYTES + 1 }))).toEqual({
      ok: false,
      reason: 'too-large',
      message: 'That file is too big — please send a photo under 5MB.',
    })
  })

  it('accepts an image the browser did not label, rather than refusing a real ID', () => {
    // Some browsers report an empty type; the extension still says it is a photo.
    expect(validateKycFile(file({ type: '' }))).toEqual({ ok: true })
  })

  it('refuses a file that is not an image', () => {
    expect(validateKycFile(file({ type: 'application/pdf', name: 'id.pdf' }))).toEqual({
      ok: false,
      reason: 'wrong-type',
      message: 'That is not an image. Please send a photo of your government ID.',
    })
  })

  it('refuses exactly 5MB, because storage.rules says "less than" and the rule is the authority', () => {
    // lib/services/kyc_storage.dart checks `bytes.length > maxBytes`, so the
    // mobile app would let a 5,242,880-byte photo through and have the upload
    // refused server-side. The web mirrors the rule instead, so a Guest is never
    // surprised by a failure the client could have predicted.
    expect(validateKycFile(file({ size: KYC_MAX_BYTES }))).toMatchObject({ ok: false, reason: 'too-large' })
    expect(validateKycFile(file({ size: KYC_MAX_BYTES - 1 }))).toEqual({ ok: true })
  })
})
