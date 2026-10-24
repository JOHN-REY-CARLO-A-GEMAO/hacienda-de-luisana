import { afterAll, beforeAll, beforeEach, it } from 'vitest'
import { assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { deleteDoc, doc, setDoc, Timestamp } from 'firebase/firestore'
import { environment, reset, seed, context, conversation, locationSession, fix, denied } from './helpers'
import { scenarios } from '../fixtures'
let env: RulesTestEnvironment
beforeAll(async () => { env = await environment() })
beforeEach(async () => reset(env))
afterAll(async () => { await env?.cleanup() })
const leaf = `live_location/${scenarios.location.conversationId}/${scenarios.location.guestUid}`
it('F22 CANONICAL DESIRED: absent consent does not authorize own-UID live publication', async () => {
  await denied(() => context(env, 'anonymousGuest').database().ref(leaf).set(fix()))
})
it('F22 CANONICAL DESIRED: stopped consent prevents fresh publication', async () => {
  await seed(env, async owner => {
    await setDoc(doc(owner.firestore(), 'conversations', scenarios.location.conversationId), conversation())
    await setDoc(doc(owner.firestore(), 'location_sessions', scenarios.location.conversationId), locationSession({ active: false, expires_at: Timestamp.now() }))
  })
  await denied(() => context(env, 'anonymousGuest').database().ref(leaf).set(fix()))
})
it('F21 CANONICAL DESIRED: approved delete-then-create restart opens fresh consent after stop', async () => {
  await seed(env, async owner => {
    await setDoc(doc(owner.firestore(), 'conversations', scenarios.location.conversationId), conversation())
    await setDoc(doc(owner.firestore(), 'location_sessions', scenarios.location.conversationId), locationSession({ active: false }))
  })
  const session = doc(context(env, 'anonymousGuest').firestore(), 'location_sessions', scenarios.location.conversationId)
  await assertSucceeds(deleteDoc(session))
  await assertSucceeds(setDoc(session, locationSession()))
})
