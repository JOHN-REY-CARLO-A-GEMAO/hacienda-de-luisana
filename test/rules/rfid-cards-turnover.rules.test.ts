/**
 * `rfid_cards` and `room_turnover`: the check-out hold collections.
 *
 * `rfid_cards/{cardUid}` is the desk reader's register of what a physical
 * card currently opens (room key at check-in, website link after the
 * check-out rewrite). `room_turnover/{recordId}` holds the damage-inspection
 * and cleaning records filed between check-out and completion. Both are
 * Admin-only with closed shapes; the app writes the shapes below.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compileRules, type DocData, type Store } from './engine'
import {
  ADMIN_UID,
  GUEST_UID,
  allowlistedAdmin,
  anonymousGuest,
  request,
  storeWith,
} from './context'

const rules = readFileSync(join(__dirname, '../../firestore.rules'), 'utf8')
const decideRules = compileRules(rules)

const profiles: Store = storeWith(
  {
    [GUEST_UID]: { uid: GUEST_UID, role: 'guest' },
    [ADMIN_UID]: { uid: ADMIN_UID, role: 'admin' },
  },
  {},
)

const allow = (partial: Parameters<typeof request>[0], store: Store = profiles) =>
  decideRules(request(partial), { store }).allow
const deny = (partial: Parameters<typeof request>[0], store: Store = profiles) =>
  decideRules(request(partial), { store }).allow === false

const CARD = 'RFID-A3-89-CF-12'

/** An `rfid_cards` document as `FirestoreService.issueRoomKey` writes it. */
const cardDoc = (overrides: DocData = {}): DocData => ({
  cardUid: CARD,
  payloadKind: 'room_key',
  payload: 'KEY:main-house:booking-1',
  status: 'active',
  issuedAt: '2026-10-09T10:00:00.000Z',
  issuedBy: ADMIN_UID,
  bookingRefId: 'booking-1',
  accommodationId: 'main-house',
  ...overrides,
})

/** The check-out rewrite: revoked, payload now the website link. */
const rewrittenCardDoc = (overrides: DocData = {}): DocData =>
  cardDoc({
    status: 'revoked',
    payloadKind: 'landing_link',
    payload: 'https://haciendadeluisana.com',
    revokedAt: '2026-10-09T12:00:00.000Z',
    rewrittenAt: '2026-10-09T12:00:00.000Z',
    ...overrides,
  })

/** A `room_turnover` document as `fileTurnoverRecord` writes it. */
const turnoverDoc = (overrides: DocData = {}): DocData => ({
  bookingId: 'booking-1',
  kind: 'cleaning',
  accommodationId: 'main-house',
  items: [],
  inspectedBy: 'Admin',
  guestContacted: false,
  notes: 'Check-out recorded; room on cleaning hold.',
  at: '2026-10-09T12:00:00.000Z',
  createdBy: ADMIN_UID,
  ...overrides,
})

describe('rfid_cards: the desk reader register', () => {
  it('lets the Admin write a card at check-in and rewrite it at check-out', () => {
    expect(allow({ path: `rfid_cards/${CARD}`, method: 'create', auth: allowlistedAdmin(), requestData: cardDoc() })).toBe(true)
    expect(allow({ path: `rfid_cards/${CARD}`, method: 'update', auth: allowlistedAdmin(), resourceData: cardDoc(), requestData: rewrittenCardDoc() })).toBe(true)
  })

  it('refuses a Guest or a signed-out writer', () => {
    expect(deny({ path: `rfid_cards/${CARD}`, method: 'create', auth: anonymousGuest(), requestData: cardDoc({ issuedBy: GUEST_UID }) })).toBe(true)
    expect(deny({ path: `rfid_cards/${CARD}`, method: 'create', auth: null, requestData: cardDoc() })).toBe(true)
  })

  it('binds the document to the card uid in its path', () => {
    expect(deny({ path: `rfid_cards/${CARD}`, method: 'create', auth: allowlistedAdmin(), requestData: cardDoc({ cardUid: 'RFID-OTHER' }) })).toBe(true)
  })

  it('refuses unknown statuses, payload kinds, or Accommodations', () => {
    expect(deny({ path: `rfid_cards/${CARD}`, method: 'create', auth: allowlistedAdmin(), requestData: cardDoc({ status: 'hacked' }) })).toBe(true)
    expect(deny({ path: `rfid_cards/${CARD}`, method: 'create', auth: allowlistedAdmin(), requestData: cardDoc({ payloadKind: 'master' }) })).toBe(true)
    expect(deny({ path: `rfid_cards/${CARD}`, method: 'create', auth: allowlistedAdmin(), requestData: cardDoc({ accommodationId: 'villa-luisana' }) })).toBe(true)
  })

  it('lets only the Admin read, and never deletes a card', () => {
    expect(allow({ path: `rfid_cards/${CARD}`, method: 'get', auth: allowlistedAdmin(), resourceData: cardDoc() })).toBe(true)
    expect(deny({ path: `rfid_cards/${CARD}`, method: 'get', auth: anonymousGuest(), resourceData: cardDoc() })).toBe(true)
    expect(deny({ path: `rfid_cards/${CARD}`, method: 'delete', auth: allowlistedAdmin(), resourceData: cardDoc() })).toBe(true)
  })
})

describe('room_turnover: the check-out hold records', () => {
  it('lets the Admin file a cleaning or damage record naming themselves', () => {
    expect(allow({ path: 'room_turnover/rec-1', method: 'create', auth: allowlistedAdmin(), requestData: turnoverDoc() })).toBe(true)
    expect(allow({ path: 'room_turnover/rec-2', method: 'create', auth: allowlistedAdmin(), requestData: turnoverDoc({ kind: 'damage', items: ['missing towel'], guestContacted: true }) })).toBe(true)
  })

  it('refuses a Guest, a signed-out writer, or a record filed in somebody else\'s name', () => {
    expect(deny({ path: 'room_turnover/rec-1', method: 'create', auth: anonymousGuest(), requestData: turnoverDoc({ createdBy: GUEST_UID }) })).toBe(true)
    expect(deny({ path: 'room_turnover/rec-1', method: 'create', auth: null, requestData: turnoverDoc() })).toBe(true)
    expect(deny({ path: 'room_turnover/rec-1', method: 'create', auth: allowlistedAdmin(), requestData: turnoverDoc({ createdBy: GUEST_UID }) })).toBe(true)
  })

  it('refuses unknown kinds or non-canonical Accommodations', () => {
    expect(deny({ path: 'room_turnover/rec-1', method: 'create', auth: allowlistedAdmin(), requestData: turnoverDoc({ kind: 'hack' }) })).toBe(true)
    expect(deny({ path: 'room_turnover/rec-1', method: 'create', auth: allowlistedAdmin(), requestData: turnoverDoc({ accommodationId: 'pool' }) })).toBe(true)
  })

  it('lets only the Admin read, and never deletes a record', () => {
    expect(allow({ path: 'room_turnover/rec-1', method: 'get', auth: allowlistedAdmin(), resourceData: turnoverDoc() })).toBe(true)
    expect(deny({ path: 'room_turnover/rec-1', method: 'get', auth: anonymousGuest(), resourceData: turnoverDoc() })).toBe(true)
    expect(deny({ path: 'room_turnover/rec-1', method: 'delete', auth: allowlistedAdmin(), resourceData: turnoverDoc() })).toBe(true)
  })
})
