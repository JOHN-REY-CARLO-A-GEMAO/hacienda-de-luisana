// Canonical two-store local rules. No claims about mobile parsing, real GPS,
// deployed role mirrors, TTL workers, or physical deletion after a device crash.
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc, deleteDoc, getDoc, Timestamp } from 'firebase/firestore'
import { environment, reset, seed, context, conversation, locationSession, fix, denied } from './helpers'
import { scenarios } from '../fixtures'
let env: RulesTestEnvironment
beforeAll(async () => { env = await environment() })
beforeEach(async () => reset(env))
afterAll(async () => { await env?.cleanup() })
const convoId = scenarios.location.conversationId
const leaf = `live_location/${convoId}/${scenarios.location.guestUid}`
const guest = () => context(env, 'anonymousGuest')
const bootstrap = () => context(env, 'unverifiedAllowlisted')
const prepareConversation = () => seed(env, owner => setDoc(doc(owner.firestore(), 'conversations', convoId), conversation()))

it('F21-CANONICAL-CONTROL: own Guest creates coordinate-free consent; second Guest cannot read/write it', async () => {
  await prepareConversation()
  await assertSucceeds(setDoc(doc(guest().firestore(), 'location_sessions', convoId), locationSession()))
  await assertSucceeds(getDoc(doc(guest().firestore(), 'location_sessions', convoId)))
  await denied(() => getDoc(doc(context(env, 'secondGuest').firestore(), 'location_sessions', convoId)))
  await denied(() => updateDoc(doc(context(env, 'secondGuest').firestore(), 'location_sessions', convoId), { active: false }))
})
it('F21-CANONICAL-CURRENT: actual first 30-minute publisher lease is rejected while short positive-control lease works', async () => {
  await denied(() => guest().database().ref(leaf).set(fix({ expires_at_ms: Date.now() + 30 * 60_000 })))
  await assertSucceeds(guest().database().ref(leaf).set(fix()))
})
it('F21-CANONICAL-CURRENT: stopping then recreating consent at the same ID is refused; explicit deletion is a separate operation', async () => {
  await prepareConversation()
  const session = doc(guest().firestore(), 'location_sessions', convoId)
  await assertSucceeds(setDoc(session, locationSession()))
  await assertSucceeds(updateDoc(session, { active: false, expires_at: Timestamp.now() }))
  await denied(() => setDoc(session, locationSession({ stream_secret: 'abcdef0123456789abcdef0123456789' })))
  await assertSucceeds(deleteDoc(session))
  await assertSucceeds(setDoc(session, locationSession()))
  // The current app does not perform this deletion on restart. No redesign.
})
it('F22-CANONICAL-CURRENT: UID owner can publish without any Firestore conversation/consent document; Admin leaf is readable', async () => {
  await assertSucceeds(guest().database().ref(leaf).set(fix()))
  expect((await bootstrap().database().ref(leaf).get()).exists()).toBe(true)
})
it('F22-CANONICAL-CURRENT: ended Firestore consent does not prevent fresh RTDB writes or Admin leaf read', async () => {
  await prepareConversation()
  await seed(env, owner => setDoc(doc(owner.firestore(), 'location_sessions', convoId), locationSession({ active: false, expires_at: Timestamp.now() })))
  await assertSucceeds(guest().database().ref(leaf).set(fix()))
  await assertSucceeds(bootstrap().database().ref(leaf).get())
})
it('F22-CANONICAL-CONTROL: signed-out/foreign Guest writes and Guest reads are refused', async () => {
  await assertSucceeds(guest().database().ref(leaf).set(fix()))
  await denied(() => context(env, 'secondGuest').database().ref(leaf).set(fix()))
  await denied(() => env.unauthenticatedContext().database().ref(leaf).set(fix()))
  await denied(() => guest().database().ref(leaf).get())
})
it('F22-CANONICAL-CURRENT: extras, stale timestamps and repeated sequence can be written inside short lease', async () => {
  await assertSucceeds(guest().database().ref(leaf).set(fix({ at_ms: Date.now() - 60_000, seq: 0, synthetic_extra: 'not-a-coordinate-trail' })))
  await assertSucceeds(guest().database().ref(leaf).set(fix({ at_ms: Date.now() - 60_000, seq: 0 })))
})
it('F22-CANONICAL-CURRENT: Guest consent expiry update can exceed the create-time one-hour cap', async () => {
  await prepareConversation()
  const session = doc(guest().firestore(), 'location_sessions', convoId)
  await assertSucceeds(setDoc(session, locationSession()))
  await assertSucceeds(updateDoc(session, { expires_at: Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60_000) }))
})
it('F22-CANONICAL-CURRENT: expired position is unreadable but still physically present until removed', async () => {
  await seed(env, owner => owner.database().ref(leaf).set(fix({ expires_at_ms: Date.now() - 1 })))
  await denied(() => bootstrap().database().ref(leaf).get())
  await seed(env, async owner => { expect((await owner.database().ref(leaf).get()).exists()).toBe(true) })
  await assertSucceeds(guest().database().ref(leaf).remove())
  await seed(env, async owner => { expect((await owner.database().ref(leaf).get()).exists()).toBe(false) })
})
it('F04/F22-CANONICAL-CURRENT: stored Firestore Admin alone lacks RTDB reads; stale mirror survives Firestore demotion', async () => {
  await assertSucceeds(guest().database().ref(leaf).set(fix()))
  await denied(() => context(env, 'adminA').database().ref(leaf).get())
  await seed(env, owner => owner.database().ref(`live_location_admins/${scenarios.identities.adminA.uid}`).set(true))
  await assertSucceeds(context(env, 'adminA').database().ref(leaf).get())
  await seed(env, owner => updateDoc(doc(owner.firestore(), 'profiles', scenarios.identities.adminA.uid), { role: 'guest' }))
  await assertSucceeds(context(env, 'adminA').database().ref(leaf).get())
})
