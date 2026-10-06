// Supplemental in-repo interpreter only. Canonical Firebase suites are separate.
// This file cannot prove deployed or emulator enforcement; its semantics may
// differ from the official runtime. Every report must retain that distinction.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileRules, ruleTimestamp, type RuleRequest, type Store } from '../rules/engine'
import { booking, approved, scenarios, NOW } from './fixtures'
import { BOOTSTRAP_ROLES } from '../../src/lib/auth/profile'
const identities = scenarios.identities
const guest = { uid: identities.anonymousGuest.uid, token: { firebase: { sign_in_provider: 'anonymous' } } }
const other = { uid: identities.secondGuest.uid, token: { email: identities.secondGuest.email, email_verified: true } }
const adminA = { uid: identities.adminA.uid, token: { email: identities.adminA.email, email_verified: true } }
const adminB = { uid: identities.adminB.uid, token: { email: identities.adminB.email, email_verified: true } }
const unverified = { uid: identities.unverifiedAllowlisted.uid, token: { email: BOOTSTRAP_ROLES[0].email, email_verified: false, firebase: { sign_in_provider: 'password' } } }
const state = booking()
const paid = approved()
const store: Store = {
  [`profiles/${adminA.uid}`]: { uid: adminA.uid, role: 'admin' },
  [`profiles/${adminB.uid}`]: { uid: adminB.uid, role: 'admin' },
  [`bookings/${state.id}`]: state,
}
const evaluateFirestore = compileRules(readFileSync(resolve('firestore.rules'), 'utf8'))
const evaluateStorage = compileRules(readFileSync(resolve('storage.rules'), 'utf8'), 'firebase.storage')
export type SecurityCase = { id: string; request: RuleRequest; current: boolean; desired: boolean; environment: 'Firestore supplemental' | 'Storage supplemental' }
const fsCase = (id: string, request: Partial<RuleRequest>, current: boolean, desired: boolean): SecurityCase => ({
  id, request: { path: `bookings/${state.id}`, method: 'update', auth: guest, resourceData: state, requestData: state, time: Date.parse(NOW), ...request }, current, desired, environment: 'Firestore supplemental',
})
export const securityCases: SecurityCase[] = [
  fsCase('F01-UNSIGNED-ARBITRARY-OWNER', { method: 'create', auth: null, resourceData: null }, true, false),
  fsCase('F01-AUTHENTICATED-FOREIGN-OWNER', { method: 'create', auth: other, resourceData: null }, true, false),
  fsCase('F01-MALFORMED-GUEST-COUNT', { method: 'create', resourceData: null, requestData: { ...state, guests: 'synthetic-malformed' } }, true, false),
  fsCase('F01-REVERSED-DATES', { method: 'create', resourceData: null, requestData: { ...state, check_out: '2026-11-01' } }, true, false),
  fsCase('F01-LEGITIMATE-ANONYMOUS-CONTROL', { method: 'create', resourceData: null }, true, true),
  fsCase('F01-FOREIGN-READ-CONTROL', { method: 'get', auth: other }, false, false),
  fsCase('F02-QUOTE-DEPOSIT-BALANCE-POLICY-HOLD', { requestData: { ...state, stay_total: 1, amount_due: 0, security_deposit: 0, balance_due: 0, policy_version: 'synthetic-forged-policy', hold_expires_at: '2099-01-01T00:00:00.000Z' } }, true, false),
  fsCase('F03-APPROVED-VERIFIED-DOWNGRADE', { resourceData: paid, requestData: { ...paid, payment_status: 'pending' } }, true, false),
  fsCase('F03-APPROVED-EVIDENCE-REPLACEMENT', { resourceData: paid, requestData: { ...paid, payment_proof_url: scenarios.evidence.foreignUid.path } }, true, false),
  fsCase('F03-GUEST-VERIFICATION-FORGERY-CONTROL', { requestData: { ...state, status: 'Approved', payment_status: 'verified', payment_verified_by: guest.uid, payment_verified_at: NOW, amount_verified: 12000 } }, false, false),
  fsCase('F04-UNVERIFIED-ALLOWLIST-CLAIM', { method: 'get', auth: unverified }, true, false),
  fsCase('F04-PROFILE-ADMIN-A-CONTROL', { method: 'get', auth: adminA }, true, true),
  fsCase('F04-PROFILE-ADMIN-B-CONTROL', { method: 'get', auth: adminB }, true, true),
  fsCase('F04-SELF-PROMOTION-CONTROL', { path: `profiles/${guest.uid}`, method: 'create', resourceData: null, requestData: { uid: guest.uid, role: 'admin' } }, false, false),
  fsCase('F15-ADMIN-B-PRESERVE-A-VERIFICATION', { auth: adminB, resourceData: paid, requestData: { ...paid, status: 'Checked-In' } }, false, true),
  fsCase('F16-NEW-AUTH-UID-CANNOT-TAKEOVER', { auth: other, requestData: { ...state, uid: other.uid } }, false, false),
  fsCase('F18-GUEST-FALSE-APPROVAL-EVENT', { path: `bookings/${state.id}/activity/phase0-event`, method: 'create', resourceData: null, requestData: { booking_id: state.id, action: 'Approve', from_status: 'Pending', to_status: 'Approved', actor: 'guest', actor_id: guest.uid, at: '1900-01-01T00:00:00.000Z' } }, true, false),
  fsCase('F20-CLIENT-FORGED-GRANTED-ACCESS', { path: 'access_logs/phase0-client-claim', method: 'create', resourceData: null, requestData: { uid: guest.uid, timestamp: ruleTimestamp(NOW), ref_id: state.ref_id!, result: 'granted', reason: 'Synthetic client claim; no hardware touched' } }, true, false),
  fsCase('F25-MISSING-REVIEW-GET', { path: `reviews/${state.id}`, method: 'get', resourceData: null, requestData: null }, true, true),
  ...[
    { id: 'F05-LEGACY-OWN-NAMESPACE', uid: guest.uid, auth: guest, current: true, desired: true, method: 'create' },
    { id: 'F05-LEGACY-FOREIGN-NAMESPACE-CONTROL', uid: other.uid, auth: guest, current: false, desired: false, method: 'create' },
    { id: 'F05-LEGACY-MISSING-BOOKING-ASSOCIATION', uid: guest.uid, auth: guest, current: true, desired: false, method: 'create' },
    { id: 'F05-LEGACY-GUEST-DELETE-CONTROL', uid: guest.uid, auth: guest, current: false, desired: false, method: 'delete' },
  ].map(c => ({ id: c.id, environment: 'Storage supplemental' as const, current: c.current, desired: c.desired,
    request: { path: `payments/${c.uid}/SYNTHETIC-NONEXISTENT-BOOKING/proof-1.png`, method: c.method as RuleRequest['method'], auth: c.auth,
      size: 32, contentType: 'image/png', time: Date.parse(NOW), requestData: c.method === 'delete' ? null : {}, resourceData: c.method === 'delete' ? {} : null } })),
]
export function supplementalDecision(c: SecurityCase) {
  return (c.environment === 'Firestore supplemental' ? evaluateFirestore : evaluateStorage)(c.request, { store })
}
