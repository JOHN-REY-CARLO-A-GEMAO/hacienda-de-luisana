/** Canonical boundaries; run only inside the isolated Firebase Emulator Suite. */
import { readFileSync } from 'node:fs'
import { beforeAll, beforeEach, afterAll, it } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, setDoc, getDoc, updateDoc, collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore'
import { ref, uploadBytes } from 'firebase/storage'
let env: RulesTestEnvironment
beforeAll(async () => { env = await initializeTestEnvironment({ projectId: 'demo-hacienda', firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('firestore.rules', 'utf8') }, storage: { host: '127.0.0.1', port: 9199, rules: readFileSync('storage.rules', 'utf8') } }) })
afterAll(async () => { await env?.cleanup() })
beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'profiles', 'admin-one'), { uid: 'admin-one', role: 'admin' })
    await setDoc(doc(ctx.firestore(), 'cases', 'case-one'), { guest_id: 'guest-one', visibility: 'guest', updated_at: 100, status: 'submitted' })
    await setDoc(doc(ctx.firestore(), 'cases', 'internal-one'), { guest_id: null, visibility: 'internal', updated_at: 100 })
    await setDoc(doc(ctx.firestore(), 'casePrivate', 'case-one'), { participants: [], hold: false })
    await setDoc(doc(ctx.firestore(), 'casePrivate', 'case-one', 'notes', 'note-one'), { text: 'Private investigation' })
    await setDoc(doc(ctx.firestore(), 'cases', 'case-one', 'activity', 'event-one'), { text: 'Guest-visible message' })
    await setDoc(doc(ctx.firestore(), 'disputes', 'legacy-one'), { guest_id: 'guest-one', internal_notes: 'Do not disclose' })
  })
})
const account = (uid: string) => env.authenticatedContext(uid, { email: `${uid}@example.test`, email_verified: true }).firestore()
it('allows a Guest to read only their own public case and activity', async () => {
  await assertSucceeds(getDoc(doc(account('guest-one'), 'cases', 'case-one')))
  await assertSucceeds(getDoc(doc(account('guest-one'), 'cases', 'case-one', 'activity', 'event-one')))
  await assertFails(getDoc(doc(account('guest-two'), 'cases', 'case-one')))
  await assertFails(getDoc(doc(account('guest-one'), 'cases', 'internal-one')))
})
it('queries are scoped; knowing a case ID does not confer ownership', async () => {
  await assertSucceeds(getDocs(query(collection(account('guest-one'), 'cases'), where('guest_id', '==', 'guest-one'), where('visibility', '==', 'guest'), orderBy('updated_at', 'desc'), limit(25))))
  await assertFails(getDocs(collection(account('guest-one'), 'cases')))
})
it('Admin and Guest clients cannot bypass trusted commands', async () => {
  for (const uid of ['guest-one', 'admin-one']) {
    await assertFails(updateDoc(doc(account(uid), 'cases', 'case-one'), { status: 'resolved' }))
    await assertFails(setDoc(doc(account(uid), 'cases', 'invented'), { guest_id: uid, visibility: 'guest' }))
    await assertFails(setDoc(doc(account(uid), 'cases', 'case-one', 'activity', 'invented'), { text: 'Forged history' }))
  }
})
it('private notes and legacy internal fields are never returned to Guests', async () => {
  await assertFails(getDoc(doc(account('guest-one'), 'casePrivate', 'case-one')))
  await assertFails(getDoc(doc(account('guest-one'), 'casePrivate', 'case-one', 'notes', 'note-one')))
  await assertFails(getDoc(doc(account('guest-one'), 'disputes', 'legacy-one')))
  await assertSucceeds(getDoc(doc(account('admin-one'), 'casePrivate', 'case-one', 'notes', 'note-one')))
})
it('raw uploads and manifest writes are server-only, including for Admins', async () => {
  for (const uid of ['guest-one', 'admin-one']) {
    await assertFails(setDoc(doc(account(uid), 'caseUploads', 'upload-one'), { owner: uid }))
    await assertFails(uploadBytes(ref(env.authenticatedContext(uid).storage(), 'caseEvidence/case-one/file-one/validated'), new Uint8Array([1]), { contentType: 'image/jpeg' }))
  }
})
