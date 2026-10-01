// Explicit SDK double for actual TS adapters. Not Firebase authorization,
// conflict/retry correctness, a durable server, or a bank/transfer ledger.
import { vi } from 'vitest'
import type { Actor } from '../../../src/lib/booking'
import type { Booking } from '../../../src/lib/storage'
import { scenarios, NOW } from '../fixtures'

type Ref = { path: string; id: string; constraints?: { field?: string; op?: string; value?: unknown }[] }
const sdk = vi.hoisted(() => ({
  records: new Map<string, Record<string, unknown>>(),
  now: '2026-10-01T04:00:00.000Z', nextId: 1,
  auth: { currentUser: { uid: 'phase0-anonymous-guest', isAnonymous: true } },
  addDoc: vi.fn(), getDoc: vi.fn(), getDocs: vi.fn(), getDocFromServer: vi.fn(), updateDoc: vi.fn(),
  runTransaction: vi.fn(), transactionReads: [] as { path: string; data: unknown }[],
  transactionWrites: [] as { path: string; data: unknown }[],
  listeners: [] as { next: (snapshot: unknown) => void; error: (error: unknown) => void }[],
}))
export { sdk }
vi.mock('../../../src/lib/firebase', () => ({
  db: { phase0SdkDouble: true }, auth: sdk.auth, isFirebaseConfigured: true, googleProvider: null,
}))
vi.mock('firebase/firestore', () => {
  const reference = (base: unknown, ...segments: string[]): Ref => {
    const parent = base && typeof base === 'object' && 'path' in base ? String(base.path) : ''
    const path = [parent, ...segments].filter(Boolean).join('/')
    return { path, id: path.split('/').at(-1) ?? '' }
  }
  return {
    collection: reference, doc: reference,
    query: (ref: Ref, ...constraints: Ref['constraints'][]) => ({ ...ref, constraints: constraints.flat() }),
    orderBy: (field: string) => ({ field }), where: (field: string, op: string, value: unknown) => ({ field, op, value }),
    serverTimestamp: () => sdk.now,
    addDoc: sdk.addDoc, getDoc: sdk.getDoc, getDocs: sdk.getDocs, getDocFromServer: sdk.getDocFromServer,
    updateDoc: sdk.updateDoc, runTransaction: sdk.runTransaction,
    setDoc: async (ref: Ref, data: Record<string, unknown>) => { sdk.records.set(ref.path, structuredClone(data)) },
    onSnapshot: (_ref: Ref, next: (snapshot: unknown) => void, error: (error: unknown) => void) => {
      sdk.listeners.push({ next, error }); return () => {}
    },
  }
})

export function documentSnapshot(path: string) {
  const data = sdk.records.get(path)
  const copy = data ? structuredClone(data) : undefined
  return { id: path.split('/').at(-1), ref: { path, id: path.split('/').at(-1) }, exists: () => Boolean(copy), data: () => copy }
}
export function collectionSnapshot(ref: Ref) {
  const level = ref.path.split('/').length + 1
  let paths = [...sdk.records.keys()].filter(path => path.startsWith(`${ref.path}/`) && path.split('/').length === level)
  for (const c of ref.constraints ?? []) if (c.op === '==') paths = paths.filter(path => sdk.records.get(path)?.[c.field!] === c.value)
  return { docs: paths.map(documentSnapshot), empty: paths.length === 0 }
}
export function putCloud(state: Booking) {
  const { id, ...data } = state
  sdk.records.set(`bookings/${id}`, structuredClone(data))
}
export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
export function resetCloudDouble() {
  sdk.records.clear(); sdk.listeners.length = 0; sdk.transactionReads.length = 0; sdk.transactionWrites.length = 0
  sdk.auth.currentUser.uid = scenarios.identities.anonymousGuest.uid
  sdk.now = NOW; sdk.nextId = 1
  for (const fn of [sdk.addDoc, sdk.getDoc, sdk.getDocs, sdk.getDocFromServer, sdk.updateDoc, sdk.runTransaction]) fn.mockReset()
  sdk.getDocFromServer.mockImplementation(async (ref: Ref) => documentSnapshot(ref.path))
  sdk.getDoc.mockImplementation(async (ref: Ref) => documentSnapshot(ref.path))
  sdk.getDocs.mockImplementation(async (ref: Ref) => collectionSnapshot(ref))
  sdk.addDoc.mockImplementation(async (ref: Ref, data: Record<string, unknown>) => {
    const id = `phase0-cloud-attempt-${sdk.nextId++}`
    sdk.records.set(`${ref.path}/${id}`, structuredClone(data)); return { id, path: `${ref.path}/${id}` }
  })
  sdk.updateDoc.mockImplementation(async (ref: Ref, data: Record<string, unknown>) => {
    sdk.records.set(ref.path, { ...sdk.records.get(ref.path), ...structuredClone(data) })
  })
  sdk.runTransaction.mockImplementation(async (_db: unknown, work: (tx: unknown) => Promise<unknown>) => {
    const writes: { ref: Ref; data: Record<string, unknown>; merge: boolean }[] = []
    const tx = {
      get: async (ref: Ref) => { const snap = documentSnapshot(ref.path); sdk.transactionReads.push({ path: ref.path, data: snap.data() }); return snap },
      update: (ref: Ref, data: Record<string, unknown>) => { writes.push({ ref, data, merge: true }) },
      set: (ref: Ref, data: Record<string, unknown>) => { writes.push({ ref, data, merge: false }) },
    }
    const result = await work(tx)
    for (const { ref, data, merge } of writes) {
      sdk.records.set(ref.path, { ...(merge ? sdk.records.get(ref.path) : {}), ...structuredClone(data) })
      sdk.transactionWrites.push({ path: ref.path, data: structuredClone(data) })
    }
    return result
  })
}

export async function lostResponseThenRetry(add: () => Promise<unknown>) {
  sdk.addDoc.mockImplementationOnce(async (ref: Ref, data: Record<string, unknown>) => {
    sdk.records.set(`${ref.path}/phase0-committed-unknown`, structuredClone(data))
    throw Object.assign(new Error('synthetic lost response after commit'), { code: 'unavailable' })
  })
  const first = await add()
  const second = await add()
  return { first, second, cloudCount: [...sdk.records.keys()].filter(path => /^bookings\/[^/]+$/.test(path)).length }
}

// Deterministic schedule: B's collection query is captured before A commits;
// B then reads A's fresh Approved document in its transaction. The adapter uses
// the stale query list rather than the fresh rival. No sleeps or Firestore
// retry simulation. Canonical emulator companion separately tests this schedule.
export async function lastUnitSchedule(adapter: typeof import('../../../src/lib/firestoreBookings')['cloudBookingsDB'], a: Booking, b: Booking, actorA: Actor, actorB: Actor) {
  putCloud(a); putCloud(b)
  const queried = deferred(); const resume = deferred()
  sdk.getDocs.mockImplementationOnce(async (ref: Ref) => {
    const stale = collectionSnapshot(ref)
    queried.resolve(); await resume.promise; return stale
  })
  const pendingB = adapter.transitionApprove(b.id, { type: 'Approve', availability: { bookings: [], unitsAvailable: 1 } }, actorB)
  await queried.promise
  const first = await adapter.transitionApprove(a.id, { type: 'Approve', availability: { bookings: [], unitsAvailable: 1 } }, actorA)
  resume.resolve()
  const second = await pendingB
  return { results: [first, second], approvedCount: [a, b].filter(state => sdk.records.get(`bookings/${state.id}`)?.status === 'Approved').length }
}
