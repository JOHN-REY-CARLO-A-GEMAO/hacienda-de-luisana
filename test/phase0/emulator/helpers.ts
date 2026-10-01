// Canonical Firebase SDK/rules harness. Never defaults to a cloud project.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { initializeTestEnvironment, type RulesTestEnvironment, type RulesTestContext } from '@firebase/rules-unit-testing'
import { doc, setDoc, Timestamp, type DocumentData } from 'firebase/firestore'
import { assertEmulatorEnvironment } from '../../../scripts/phase0/boundary.mjs'
import { scenarios, booking, approved, NOW } from '../fixtures'
import { BOOTSTRAP_ROLES } from '../../../src/lib/auth/profile'

export const PROJECT = 'demo-hacienda'
export async function environment(): Promise<RulesTestEnvironment> {
  assertEmulatorEnvironment()
  return initializeTestEnvironment({ projectId: PROJECT,
    firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync(resolve('firestore.rules'), 'utf8') },
    database: { host: '127.0.0.1', port: 9000, rules: readFileSync(resolve('database.rules.json'), 'utf8') },
    storage: { host: '127.0.0.1', port: 9199, rules: readFileSync(resolve('storage.rules'), 'utf8') },
  })
}
export function canonicalBooking(overrides: DocumentData = {}): DocumentData {
  const { id: _id, ...data } = booking()
  // Real rules use emulator request.time. A fixed far-future create is valid
  // independently of wall-clock time; no fake clock claims to change the server.
  return { ...data, check_in: '2099-12-01', check_out: '2099-12-03',
    hold_expires_at: '2099-10-02T04:00:00.000Z', created_at: Timestamp.fromDate(new Date(NOW)), ...overrides }
}
export function canonicalPaid(overrides: DocumentData = {}): DocumentData {
  const { id: _id, ...paid } = approved()
  return canonicalBooking({ ...paid, check_in: '2099-12-01', check_out: '2099-12-03', ...overrides })
}
export function context(env: RulesTestEnvironment, who: keyof typeof scenarios.identities): RulesTestContext {
  const person = scenarios.identities[who]
  const email = who === 'unverifiedAllowlisted' ? BOOTSTRAP_ROLES[0].email : 'email' in person ? person.email : undefined
  const token: Record<string, unknown> = { email_verified: 'emailVerified' in person && person.emailVerified,
    firebase: { sign_in_provider: 'provider' in person ? person.provider : 'password' } }
  if (email) token.email = email
  return env.authenticatedContext(person.uid, token)
}
export async function reset(env: RulesTestEnvironment) {
  assertEmulatorEnvironment()
  await env.clearFirestore(); await env.clearDatabase(); await env.clearStorage()
  await env.withSecurityRulesDisabled(async owner => {
    for (const who of [scenarios.identities.adminA, scenarios.identities.adminB]) await setDoc(doc(owner.firestore(), 'profiles', who.uid), { uid: who.uid, role: 'admin', email: who.email })
  })
}
export async function seed(env: RulesTestEnvironment, work: (owner: RulesTestContext) => Promise<unknown>) {
  assertEmulatorEnvironment()
  return env.withSecurityRulesDisabled(async owner => { await work(owner) })
}
// Denial must be from rules, not bad SDK input, network outage or a timeout.
export async function denied(work: () => Promise<unknown>) {
  let error: unknown
  try { await work() } catch (caught) { error = caught }
  if (!error) throw new Error('Expected a canonical permission denial, but operation succeeded')
  const code = String((error as { code?: string }).code ?? '').toLowerCase().replace(/_/g, '-')
  if (!['permission-denied', 'storage/unauthorized'].includes(code)) throw new Error(`Expected a rules denial; got ${code || 'no code'}`)
}
export const conversation = () => ({ guest_uid: scenarios.identities.anonymousGuest.uid, category: 'booking-inquiry',
  created_at: Timestamp.now(), updated_at: Timestamp.now(), last_message: '', unread_admin: 0, unread_guest: 0 })
export const locationSession = (overrides: DocumentData = {}) => ({ guest_uid: scenarios.location.guestUid,
  conversation_id: scenarios.location.conversationId, active: true, started_at: Timestamp.now(),
  expires_at: Timestamp.fromMillis(Date.now() + 30 * 60_000), duration_minutes: 30, stream_secret: scenarios.location.streamSecret, ...overrides })
export const fix = (overrides: DocumentData = {}) => ({ lat: scenarios.location.lat, lng: scenarios.location.lng,
  accuracy_m: scenarios.location.accuracy, at_ms: Date.now(), seq: 1, guest_uid: scenarios.location.guestUid,
  conversation_id: scenarios.location.conversationId, session_secret: scenarios.location.streamSecret,
  expires_at_ms: Date.now() + 60_000, ...overrides })
