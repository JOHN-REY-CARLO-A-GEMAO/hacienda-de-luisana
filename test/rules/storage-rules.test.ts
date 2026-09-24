/**
 * `storage.rules`, executed.
 *
 * The upload paths the applications actually use — `/kyc/{uid}/{bookingRef}/…`
 * (`src/lib/kyc/upload.ts`) and `/payments/{uid}/{bookingRef}/…`
 * (`src/lib/payments/upload.ts`), plus Admin-published site images — with the
 * size and content-type limits the rules declare.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { evaluate, type RuleRequest } from './engine'
import { ADMIN_UID, BOOKING_ID, GUEST_UID, OTHER_GUEST_UID, allowlistedAdmin, anonymousGuest, emailGuest } from './context'

const rules = readFileSync(join(__dirname, '../../storage.rules'), 'utf8')

const BUCKET = 'hacienda-de-luisana.appspot.com'
const IMAGE = { size: 512_000, contentType: 'image/jpeg' }

const storage = (partial: Partial<RuleRequest> & { path: string; method: RuleRequest['method'] }) =>
  evaluate({ auth: null, resourceData: null, requestData: null, ...partial }, rules, {
    service: 'firebase.storage',
    bucket: BUCKET,
  }).allow

describe('site images: gallery and accommodations', () => {
  it('lets anybody read a published image', () => {
    expect(storage({ path: 'gallery/hero.jpg', method: 'get', resourceData: {}, ...IMAGE })).toBe(true)
    expect(storage({ path: 'accommodations/main-house/1.jpg', method: 'get', resourceData: {}, ...IMAGE })).toBe(true)
  })

  it('lets only the Admin publish one', () => {
    expect(storage({ path: 'gallery/new.jpg', method: 'create', auth: allowlistedAdmin(), requestData: { ...IMAGE } })).toBe(true)
    expect(storage({ path: 'gallery/new.jpg', method: 'create', auth: anonymousGuest(), requestData: { ...IMAGE } })).toBe(false)
    expect(storage({ path: 'accommodations/main-house/2.jpg', method: 'create', auth: emailGuest(), requestData: { ...IMAGE } })).toBe(false)
  })

  it('refuses a publication over 10 MB or that is not an image', () => {
    expect(storage({ path: 'gallery/huge.jpg', method: 'create', auth: allowlistedAdmin(), requestData: { size: 11 * 1024 * 1024, contentType: 'image/jpeg' } })).toBe(false)
    expect(storage({ path: 'gallery/doc.pdf', method: 'create', auth: allowlistedAdmin(), requestData: { size: 1000, contentType: 'application/pdf' } })).toBe(false)
  })
})

describe('avatars', () => {
  it('lets a person write their own avatar, under 2 MB, and anybody read it', () => {
    expect(storage({ path: `avatars/${GUEST_UID}/me.jpg`, method: 'create', auth: anonymousGuest(), requestData: { ...IMAGE, size: 1_000_000 } })).toBe(true)
    expect(storage({ path: `avatars/${GUEST_UID}/me.jpg`, method: 'create', auth: anonymousGuest(), requestData: { ...IMAGE, size: 3 * 1024 * 1024 } })).toBe(false)
    expect(storage({ path: `avatars/${GUEST_UID}/me.jpg`, method: 'get', auth: null, resourceData: {}, ...IMAGE })).toBe(true)
  })

  it('refuses writing somebody else\'s avatar', () => {
    expect(storage({ path: `avatars/${OTHER_GUEST_UID}/me.jpg`, method: 'create', auth: anonymousGuest(), requestData: { ...IMAGE } })).toBe(false)
  })
})

describe('KYC documents: the government ID a Guest uploads', () => {
  const path = `kyc/${GUEST_UID}/${BOOKING_ID}/id.jpg`

  it('lets the Guest upload their own ID, as an image under 5 MB', () => {
    expect(storage({ path, method: 'create', auth: anonymousGuest(), requestData: { ...IMAGE } })).toBe(true)
    expect(storage({ path, method: 'create', auth: anonymousGuest(), requestData: { size: 6 * 1024 * 1024, contentType: 'image/jpeg' } })).toBe(false)
    expect(storage({ path, method: 'create', auth: anonymousGuest(), requestData: { size: 1000, contentType: 'application/pdf' } })).toBe(false)
  })

  it('refuses a Guest uploading into another Guest\'s folder', () => {
    expect(storage({ path: `kyc/${GUEST_UID}/${BOOKING_ID}/id.jpg`, method: 'create', auth: anonymousGuest(OTHER_GUEST_UID), requestData: { ...IMAGE } })).toBe(false)
  })

  it('refuses a signed-out uploader', () => {
    expect(storage({ path, method: 'create', auth: null, requestData: { ...IMAGE } })).toBe(false)
  })

  it('lets the Guest read their own ID and the Admin read it for review, and nobody else', () => {
    expect(storage({ path, method: 'get', auth: anonymousGuest(), resourceData: {}, ...IMAGE })).toBe(true)
    expect(storage({ path, method: 'get', auth: allowlistedAdmin(), resourceData: {}, ...IMAGE })).toBe(true)
    expect(storage({ path, method: 'get', auth: emailGuest(OTHER_GUEST_UID), resourceData: {}, ...IMAGE })).toBe(false)
    expect(storage({ path, method: 'get', auth: null, resourceData: {}, ...IMAGE })).toBe(false)
  })

  it('refuses a Guest deleting or overwriting their ID once uploaded', () => {
    // Only the Admin's delete carries no resource; a Guest's write always has one.
    expect(storage({ path, method: 'delete', auth: anonymousGuest(), resourceData: {}, ...IMAGE })).toBe(false)
  })

  it('lets the Admin delete the ID the Admin may purge after the stay', () => {
    expect(storage({ path, method: 'delete', auth: allowlistedAdmin() })).toBe(true)
  })

  it('refuses the Admin overwriting an uploaded ID with new bytes', () => {
    expect(storage({ path, method: 'create', auth: allowlistedAdmin(), requestData: { ...IMAGE } })).toBe(false)
  })
})

describe('payment proofs: what the Guest sends for verification', () => {
  const path = `payments/${GUEST_UID}/${BOOKING_ID}/proof.jpg`

  it('lets the Guest upload their own proof, as an image under 5 MB', () => {
    expect(storage({ path, method: 'create', auth: anonymousGuest(), requestData: { ...IMAGE } })).toBe(true)
    expect(storage({ path, method: 'create', auth: anonymousGuest(), requestData: { size: 6 * 1024 * 1024, contentType: 'image/jpeg' } })).toBe(false)
    expect(storage({ path, method: 'create', auth: anonymousGuest(), requestData: { size: 1000, contentType: 'image/png' } })).toBe(true)
    expect(storage({ path, method: 'create', auth: anonymousGuest(), requestData: { size: 1000, contentType: 'text/plain' } })).toBe(false)
  })

  it('refuses a Guest uploading into another Guest\'s folder', () => {
    expect(storage({ path: `payments/${GUEST_UID}/${BOOKING_ID}/proof.jpg`, method: 'create', auth: anonymousGuest(OTHER_GUEST_UID), requestData: { ...IMAGE } })).toBe(false)
  })

  it('keeps a proof unreadable to other Guests and to the public', () => {
    expect(storage({ path, method: 'get', auth: emailGuest(OTHER_GUEST_UID), resourceData: {}, ...IMAGE })).toBe(false)
    expect(storage({ path, method: 'get', auth: null, resourceData: {}, ...IMAGE })).toBe(false)
  })

  it('lets the Guest and the Admin read it for verification', () => {
    expect(storage({ path, method: 'get', auth: anonymousGuest(), resourceData: {}, ...IMAGE })).toBe(true)
    expect(storage({ path, method: 'get', auth: allowlistedAdmin(), resourceData: {}, ...IMAGE })).toBe(true)
  })

  it('lets only the Admin delete a proof', () => {
    expect(storage({ path, method: 'delete', auth: allowlistedAdmin() })).toBe(true)
    expect(storage({ path, method: 'delete', auth: anonymousGuest(), resourceData: {}, ...IMAGE })).toBe(false)
  })
})

describe('everything else', () => {
  it('refuses a path with no rule', () => {
    expect(storage({ path: 'backups/dump.sql', method: 'get', auth: allowlistedAdmin(), resourceData: {}, size: 10, contentType: 'text/plain' })).toBe(false)
    expect(storage({ path: 'backups/dump.sql', method: 'create', auth: allowlistedAdmin(), requestData: { size: 10, contentType: 'text/plain' } })).toBe(false)
  })

  it('refuses a Guest reading the Admin side of another bucket path that has no rule', () => {
    expect(storage({ path: 'kyc-drafts/x.jpg', method: 'get', auth: anonymousGuest(), resourceData: {}, ...IMAGE })).toBe(false)
  })

  it('names the Admin on a folder that is not the Guest\'s own uid, even with a matching prefix', () => {
    // `/kyc/{userId}` is one segment: a nested folder cannot widen the grant.
    expect(storage({ path: `kyc/${GUEST_UID}-suffix/${BOOKING_ID}/id.jpg`, method: 'get', auth: anonymousGuest(), resourceData: {}, ...IMAGE })).toBe(false)
  })

  it('keeps ADMIN_UID unused here deliberately: Storage grants read by allowlist only', () => {
    // A promoted Admin (a Profile role, not an allowlisted address) can read
    // Firestore but not Storage — recorded in storage.rules' own comment.
    expect(storage({ path: `payments/${GUEST_UID}/${BOOKING_ID}/proof.jpg`, method: 'get', auth: { uid: ADMIN_UID, token: { email: 'staff@example.com' } }, resourceData: {}, ...IMAGE })).toBe(false)
  })
})
