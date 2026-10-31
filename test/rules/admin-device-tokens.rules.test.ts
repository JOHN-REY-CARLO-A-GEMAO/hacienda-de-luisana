/**
 * Firestore Security Rules suite for `admin_device_tokens/{tokenId}` and
 * server-only `notification_dispatches/{dispatchId}` (`firestore.rules`).
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  compileRules,
  DEFAULT_REQUEST_TIME,
  ruleTimestamp,
  type DocData,
  type Store,
} from './engine'
import {
  ADMIN_UID,
  allowlistedAdmin,
  anonymousGuest,
  emailGuest,
  GUEST_UID,
  promotedAdmin,
  request,
  storeWith,
} from './context'

const rules = readFileSync(join(__dirname, '../../firestore.rules'), 'utf8')
const decideRules = compileRules(rules)

const PROMOTED_ADMIN_UID = 'promoted-admin-1'
const TOKEN_A = 'fcm_android_token_primary_device_0123456789abcdef'
const TOKEN_B = 'fcm_ios_token_secondary_device_fedcba987654321099'

const tokenDocId = (uid: string, token: string) =>
  `${uid}:${createHash('sha256').update(`${uid}:${token}`).digest('hex').slice(0, 32)}`

const baseStore: Store = storeWith({
  [GUEST_UID]: { uid: GUEST_UID, role: 'guest' },
  [PROMOTED_ADMIN_UID]: { uid: PROMOTED_ADMIN_UID, role: 'admin' },
})

const validTokenDoc = (
  uid = ADMIN_UID,
  token = TOKEN_A,
  overrides: DocData = {},
  createdAt = DEFAULT_REQUEST_TIME,
  now = DEFAULT_REQUEST_TIME,
): DocData => ({
  uid,
  token,
  platform: 'android',
  enabled: true,
  created_at: ruleTimestamp(createdAt),
  updated_at: ruleTimestamp(now),
  last_seen_at: ruleTimestamp(now),
  ...overrides,
})

const allow = (
  partial: Parameters<typeof request>[0],
  store: Store = baseStore,
) => decideRules(request(partial), { store }).allow

describe('admin_device_tokens/{tokenId}: strict Admin-only own-account isolation', () => {
  const adminTokenPath = `admin_device_tokens/${tokenDocId(ADMIN_UID, TOKEN_A)}`
  const promotedTokenPath = `admin_device_tokens/${tokenDocId(PROMOTED_ADMIN_UID, TOKEN_B)}`

  it('denies signed-out, anonymous Guest, and email Guest callers on all operations', () => {
    for (const caller of [null, anonymousGuest(), emailGuest()]) {
      const targetUid = caller?.uid ?? GUEST_UID
      const forgedPath = `admin_device_tokens/${tokenDocId(targetUid, TOKEN_A)}`
      expect(
        allow({
          auth: caller,
          method: 'get',
          path: forgedPath,
          resourceData: validTokenDoc(targetUid),
        }),
      ).toBe(false)
      expect(
        allow({
          auth: caller,
          method: 'list',
          path: forgedPath,
          resourceData: validTokenDoc(targetUid),
        }),
      ).toBe(false)
      expect(
        allow({
          auth: caller,
          method: 'create',
          path: forgedPath,
          requestData: validTokenDoc(targetUid),
        }),
      ).toBe(false)
      expect(
        allow({
          auth: caller,
          method: 'update',
          path: forgedPath,
          resourceData: validTokenDoc(targetUid),
          requestData: validTokenDoc(targetUid, TOKEN_A, { enabled: false }),
        }),
      ).toBe(false)
      expect(
        allow({
          auth: caller,
          method: 'delete',
          path: forgedPath,
          resourceData: validTokenDoc(targetUid),
        }),
      ).toBe(false)
    }
  })

  it('permits both bootstrap and profile-promoted Admins to create, read, update, and delete their own token', () => {
    // Non-existent doc check inside client upsert transaction
    expect(
      allow({
        auth: allowlistedAdmin(),
        method: 'get',
        path: adminTokenPath,
        resourceData: null,
      }),
    ).toBe(true)

    // Create own token
    expect(
      allow({
        auth: allowlistedAdmin(),
        method: 'create',
        path: adminTokenPath,
        requestData: validTokenDoc(ADMIN_UID, TOKEN_A, {
          app_version: '1.0.0+1',
        }),
      }),
    ).toBe(true)

    // Promoted Admin creates iOS token
    expect(
      allow({
        auth: promotedAdmin(PROMOTED_ADMIN_UID),
        method: 'create',
        path: promotedTokenPath,
        requestData: validTokenDoc(PROMOTED_ADMIN_UID, TOKEN_B, {
          platform: 'ios',
        }),
      }),
    ).toBe(true)

    // Update own token preserving immutable uid, token, and created_at
    const earlier = DEFAULT_REQUEST_TIME - 86_400_000
    expect(
      allow({
        auth: allowlistedAdmin(),
        method: 'update',
        path: adminTokenPath,
        resourceData: validTokenDoc(ADMIN_UID, TOKEN_A, {}, earlier, earlier),
        requestData: validTokenDoc(
          ADMIN_UID,
          TOKEN_A,
          { enabled: false },
          earlier,
          DEFAULT_REQUEST_TIME,
        ),
      }),
    ).toBe(true)

    // Delete own token on logout
    expect(
      allow({
        auth: allowlistedAdmin(),
        method: 'delete',
        path: adminTokenPath,
        resourceData: validTokenDoc(ADMIN_UID, TOKEN_A),
      }),
    ).toBe(true)
  })

  it('prevents cross-account token registration, inspection, mutation, or deletion even between two Admins', () => {
    // Admin A cannot register a token claiming Admin B's uid
    expect(
      allow({
        auth: allowlistedAdmin(),
        method: 'create',
        path: promotedTokenPath,
        requestData: validTokenDoc(PROMOTED_ADMIN_UID, TOKEN_B),
      }),
    ).toBe(false)

    // Admin A cannot read Admin B's existing token document
    expect(
      allow({
        auth: allowlistedAdmin(),
        method: 'get',
        path: promotedTokenPath,
        resourceData: validTokenDoc(PROMOTED_ADMIN_UID, TOKEN_B),
      }),
    ).toBe(false)
    expect(
      allow({
        auth: allowlistedAdmin(),
        method: 'list',
        path: promotedTokenPath,
        resourceData: validTokenDoc(PROMOTED_ADMIN_UID, TOKEN_B),
      }),
    ).toBe(false)

    // Admin A cannot overwrite or delete Admin B's token document
    expect(
      allow({
        auth: allowlistedAdmin(),
        method: 'update',
        path: promotedTokenPath,
        resourceData: validTokenDoc(PROMOTED_ADMIN_UID, TOKEN_B),
        requestData: validTokenDoc(ADMIN_UID, TOKEN_B),
      }),
    ).toBe(false)
    expect(
      allow({
        auth: allowlistedAdmin(),
        method: 'delete',
        path: promotedTokenPath,
        resourceData: validTokenDoc(PROMOTED_ADMIN_UID, TOKEN_B),
      }),
    ).toBe(false)
  })

  it('rejects malformed token payloads, extra fields, forged timestamps, and mutating immutable fields', () => {
    // Short doc ID rejected
    expect(
      allow({
        auth: allowlistedAdmin(),
        method: 'create',
        path: 'admin_device_tokens/short',
        requestData: validTokenDoc(),
      }),
    ).toBe(false)

    // Invalid platform rejected
    expect(
      allow({
        auth: allowlistedAdmin(),
        method: 'create',
        path: adminTokenPath,
        requestData: validTokenDoc(ADMIN_UID, TOKEN_A, { platform: 'web' }),
      }),
    ).toBe(false)

    // Oversized >1024-byte token rejected before Firestore 1500-byte single-field index ceiling
    const oversizedToken = 't'.repeat(1100)
    expect(
      allow({
        auth: allowlistedAdmin(),
        method: 'create',
        path: `admin_device_tokens/${tokenDocId(ADMIN_UID, oversizedToken)}`,
        requestData: validTokenDoc(ADMIN_UID, oversizedToken),
      }),
    ).toBe(false)

    // Unverified bootstrap allowlist email rejected
    expect(
      allow({
        auth: {
          uid: ADMIN_UID,
          token: {
            email: 'gemaojohnreyarguilles@gmail.com',
            email_verified: false,
            firebase: { sign_in_provider: 'password' },
          },
        },
        method: 'create',
        path: adminTokenPath,
        requestData: validTokenDoc(),
      }),
    ).toBe(false)

    // Unknown extra field rejected
    expect(
      allow({
        auth: allowlistedAdmin(),
        method: 'create',
        path: adminTokenPath,
        requestData: validTokenDoc(ADMIN_UID, TOKEN_A, { role: 'superadmin' }),
      }),
    ).toBe(false)

    // Forged backdated updated_at rejected
    expect(
      allow({
        auth: allowlistedAdmin(),
        method: 'create',
        path: adminTokenPath,
        requestData: validTokenDoc(
          ADMIN_UID,
          TOKEN_A,
          {},
          DEFAULT_REQUEST_TIME,
          DEFAULT_REQUEST_TIME - 5_000,
        ),
      }),
    ).toBe(false)

    // Mutating token or created_at on update rejected
    const earlier = DEFAULT_REQUEST_TIME - 60_000
    expect(
      allow({
        auth: allowlistedAdmin(),
        method: 'update',
        path: adminTokenPath,
        resourceData: validTokenDoc(ADMIN_UID, TOKEN_A, {}, earlier, earlier),
        requestData: validTokenDoc(
          ADMIN_UID,
          TOKEN_B,
          {},
          earlier,
          DEFAULT_REQUEST_TIME,
        ),
      }),
    ).toBe(false)
    expect(
      allow({
        auth: allowlistedAdmin(),
        method: 'update',
        path: adminTokenPath,
        resourceData: validTokenDoc(ADMIN_UID, TOKEN_A, {}, earlier, earlier),
        requestData: validTokenDoc(
          ADMIN_UID,
          TOKEN_A,
          {},
          DEFAULT_REQUEST_TIME,
          DEFAULT_REQUEST_TIME,
        ),
      }),
    ).toBe(false)
  })

  it('keeps notification_dispatches strictly server-only under default-deny even for Admins', () => {
    for (const method of ['get', 'list', 'create', 'update', 'delete'] as const) {
      expect(
        allow({
          auth: allowlistedAdmin(),
          method,
          path: 'notification_dispatches/booking_submitted_1001',
          resourceData: { event_id: 'booking_submitted:1001' },
          requestData: { event_id: 'booking_submitted:1001' },
        }),
      ).toBe(false)
    }
  })
})
