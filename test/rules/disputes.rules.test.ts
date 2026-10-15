/** Supplemental rule-text verification; emulator tests are canonical. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compileRules, evaluate } from './engine'
import { request, storeWith, GUEST_UID, OTHER_GUEST_UID } from './context'
const rules = compileRules(readFileSync('firestore.rules', 'utf8'))
const storage = readFileSync('storage.rules', 'utf8')
const account = (uid = GUEST_UID) => ({ uid, token: { email: 'guest@example.com', firebase: { sign_in_provider: 'password' } } })
const admin = { uid: 'operator', token: { email: 'admin@example.com', firebase: { sign_in_provider: 'google.com' } } }
const doc = { visibility: 'guest', guest_id: GUEST_UID, status: 'submitted', description: 'Guest concern' }
const store = storeWith({ operator: { uid: 'operator', role: 'admin' } }, { 'cases/case-one': doc })
function can(path: string, method: 'get' | 'create' | 'update' | 'delete', auth: ReturnType<typeof account> | null = account(), data = doc) {
  return rules(request({ path, method, auth, resourceData: data, requestData: data }), { store }).allow
}
describe('server-owned case boundaries', () => {
  it('allows only the verified participant and Admin to read a Guest case', () => {
    expect(can('cases/case-one', 'get')).toBe(true)
    expect(can('cases/case-one', 'get', account(OTHER_GUEST_UID))).toBe(false)
    expect(can('cases/case-one', 'get', admin)).toBe(true)
    expect(can('cases/case-one', 'get', null)).toBe(false)
  })
  it('does not accept anonymous identities as case accounts', () => {
    const anonymous = { uid: GUEST_UID, token: { firebase: { sign_in_provider: 'anonymous' } } }
    expect(rules(request({ path: 'cases/case-one', method: 'get', auth: anonymous, resourceData: doc }), { store }).allow).toBe(false)
  })
  it('refuses direct writes, even from an Admin', () => {
    for (const auth of [account(), admin]) for (const method of ['create', 'update', 'delete'] as const) expect(can('cases/case-one', method, auth)).toBe(false)
  })
  it('isolates internal reports and private notes', () => {
    expect(can('cases/case-one', 'get', account(), { ...doc, visibility: 'internal' })).toBe(false)
    expect(can('casePrivate/case-one', 'get')).toBe(false)
    expect(can('casePrivate/case-one/notes/note-one', 'get')).toBe(false)
    expect(can('casePrivate/case-one/notes/note-one', 'get', admin)).toBe(true)
  })
  it('scopes public activity and evidence metadata to the parent case', () => {
    for (const suffix of ['activity/event-one', 'evidence/file-one']) {
      expect(can(`cases/case-one/${suffix}`, 'get')).toBe(true)
      expect(can(`cases/case-one/${suffix}`, 'get', account(OTHER_GUEST_UID))).toBe(false)
      expect(can(`cases/case-one/${suffix}`, 'create', admin)).toBe(false)
    }
  })
  it('freezes legacy writes and closes the legacy internal-note exposure', () => {
    expect(can('disputes/legacy-one', 'get')).toBe(false)
    expect(can('disputes/legacy-one', 'get', admin)).toBe(true)
    expect(can('disputes/legacy-one', 'update', admin)).toBe(false)
  })
  it('keeps server receipts, upload manifests, policy and inbox documents inaccessible directly', () => {
    for (const collection of ['caseOperations', 'caseUploads', 'casePolicy', 'caseNotifications', 'caseRateLimits', 'caseCounters']) for (const auth of [account(), admin]) {
      expect(can(`${collection}/record-one`, 'get', auth)).toBe(false)
      expect(can(`${collection}/record-one`, 'create', auth)).toBe(false)
    }
  })
  it('rejects unverified bootstrap-email Admin access to new case collections', () => {
    const spoof = { uid: GUEST_UID, token: { email: 'haciendadeluisiana@gmail.com', email_verified: false, firebase: { sign_in_provider: 'password' } } }
    expect(can('cases/case-one', 'get', spoof, { ...doc, guest_id: OTHER_GUEST_UID })).toBe(false)
  })
  it('denies all raw case Storage operations, including Admin reads', () => {
    for (const method of ['get', 'create', 'update', 'delete'] as const) for (const auth of [account(), admin, null]) {
      expect(evaluate({ path: 'caseEvidence/case-one/file-one/validated', method, auth, resourceData: {}, requestData: { size: 100, contentType: 'image/png' } }, storage, { service: 'firebase.storage', bucket: 'test-bucket' }).allow).toBe(false)
    }
  })
})
