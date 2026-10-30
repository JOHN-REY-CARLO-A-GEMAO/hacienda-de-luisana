/**
 * `storage.rules`, executed.
 *
 * The upload paths the applications actually use — `/payments/{uid}/…` legacy
 * proofs (`src/lib/payments/upload.ts`) and Admin-published site images — with
 * the size and content-type limits the rules declare. The `/kyc` slot was
 * removed with Government ID KYC (2026-09-27): what is left of it is asserted
 * gone below.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { evaluate, type RuleRequest, type Store } from './engine'
import {
  ADMIN_UID,
  BOOKING_ID,
  CONVO_ID,
  GUEST_UID,
  OTHER_GUEST_UID,
  allowlistedAdmin,
  anonymousGuest,
  conversationDoc,
  emailGuest,
  promotedAdmin,
} from './context'

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

describe('avatars: the /avatars slot closed because nothing writes it', () => {
  const path = `avatars/${GUEST_UID}/me.jpg`

  it('refuses every operation on the retired path — nobody reads or writes avatars', () => {
    // Same shape as the /kyc retirement: a path nobody uses falls through to
    // the default deny. Public-read + anonymous arbitrary-content writes is
    // not a grant this bucket should carry for a dead prefix.
    expect(storage({ path, method: 'create', auth: anonymousGuest(), requestData: { ...IMAGE, size: 1_000_000 } })).toBe(false)
    expect(storage({ path, method: 'create', auth: anonymousGuest(), requestData: { size: 1000, contentType: 'text/html' } })).toBe(false)
    expect(storage({ path, method: 'create', auth: allowlistedAdmin(), requestData: { ...IMAGE } })).toBe(false)
    expect(storage({ path, method: 'get', auth: null, resourceData: {}, ...IMAGE })).toBe(false)
    expect(storage({ path, method: 'get', auth: anonymousGuest(), resourceData: {}, ...IMAGE })).toBe(false)
    expect(storage({ path, method: 'delete', auth: allowlistedAdmin() })).toBe(false)
    expect(storage({ path: `avatars/${OTHER_GUEST_UID}/me.jpg`, method: 'create', auth: anonymousGuest(), requestData: { ...IMAGE } })).toBe(false)
  })
})

describe('government IDs: the /kyc slot removed with KYC (2026-09-27)', () => {
  const path = `kyc/${GUEST_UID}/${BOOKING_ID}/id.jpg`

  it('refuses every operation on the retired path — nobody reads or writes IDs', () => {
    // The default deny below the named paths owns /kyc again: no Guest upload,
    // no Admin review read, no purge delete. The bucket rule cannot tell an
    // ID from any other refused path, which is exactly the point.
    expect(storage({ path, method: 'create', auth: anonymousGuest(), requestData: { ...IMAGE } })).toBe(false)
    expect(storage({ path, method: 'create', auth: allowlistedAdmin(), requestData: { ...IMAGE } })).toBe(false)
    expect(storage({ path, method: 'get', auth: anonymousGuest(), resourceData: {}, ...IMAGE })).toBe(false)
    expect(storage({ path, method: 'get', auth: allowlistedAdmin(), resourceData: {}, ...IMAGE })).toBe(false)
    expect(storage({ path, method: 'delete', auth: allowlistedAdmin() })).toBe(false)
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

describe('private message images: the conversation, not a public bucket', () => {
  const path = `messageAttachments/${CONVO_ID}/message-1`
  const store: Store = {
    [`conversations/${CONVO_ID}`]: conversationDoc(),
    'profiles/promoted-admin-1': { role: 'admin' },
  }
  const messageStorage = (
    partial: Partial<RuleRequest> & { path: string; method: RuleRequest['method'] },
    documents: Store = store,
  ) =>
    evaluate({ auth: null, resourceData: null, requestData: null, ...partial }, rules, {
      service: 'firebase.storage',
      bucket: BUCKET,
      store: documents,
    }).allow

  it('lets the owning Guest create and read JPEG, PNG and WebP up to exactly 5 MB', () => {
    for (const contentType of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(messageStorage({ path, method: 'create', auth: anonymousGuest(), requestData: { size: 5 * 1024 * 1024, contentType } })).toBe(true)
      expect(messageStorage({ path, method: 'get', auth: anonymousGuest(), resourceData: {}, size: 1000, contentType })).toBe(true)
    }
  })

  it('refuses empty, oversized, and non-image uploads at the Storage boundary', () => {
    for (const requestData of [
      { size: 0, contentType: 'image/png' },
      { size: 5 * 1024 * 1024 + 1, contentType: 'image/png' },
      { size: 1000, contentType: 'image/gif' },
      { size: 1000, contentType: 'application/pdf' },
      { size: 1000, contentType: 'text/plain' },
    ]) {
      expect(messageStorage({ path, method: 'create', auth: anonymousGuest(), requestData })).toBe(false)
    }
  })

  it('keeps another Guest and the signed-out public out even when they know the path', () => {
    for (const auth of [anonymousGuest(OTHER_GUEST_UID), emailGuest(OTHER_GUEST_UID), null]) {
      expect(messageStorage({ path, method: 'get', auth, resourceData: {}, ...IMAGE })).toBe(false)
      expect(messageStorage({ path, method: 'create', auth, requestData: { ...IMAGE } })).toBe(false)
    }
  })

  it('admits both bootstrap and Profile-promoted Admins, but requires a real conversation', () => {
    for (const auth of [allowlistedAdmin(), promotedAdmin()]) {
      expect(messageStorage({ path, method: 'get', auth, resourceData: {}, ...IMAGE })).toBe(true)
      expect(messageStorage({ path, method: 'create', auth, requestData: { ...IMAGE } })).toBe(true)
    }
    for (const auth of [allowlistedAdmin(), promotedAdmin()]) {
      expect(messageStorage(
        { path: 'messageAttachments/missing-convo/message-1', method: 'create', auth, requestData: { ...IMAGE } },
        {},
      )).toBe(false)
    }
  })

  it('makes objects immutable to writers and does not let a Guest delete one', () => {
    expect(messageStorage({ path, method: 'update', auth: anonymousGuest(), resourceData: { ...IMAGE }, requestData: { ...IMAGE } })).toBe(false)
    expect(messageStorage({ path, method: 'update', auth: allowlistedAdmin(), resourceData: { ...IMAGE }, requestData: { ...IMAGE } })).toBe(false)
    expect(messageStorage({ path, method: 'delete', auth: anonymousGuest(), resourceData: { ...IMAGE } })).toBe(false)
    expect(messageStorage({ path, method: 'delete', auth: allowlistedAdmin(), resourceData: { ...IMAGE } })).toBe(true)
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
