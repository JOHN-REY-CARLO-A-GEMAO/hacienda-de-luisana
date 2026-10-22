/** Guest case client. No local-success fallback; all writes are trusted commands. */
import { httpsCallable } from 'firebase/functions'
import { collection, query, where, orderBy, limit, onSnapshot, getDocs, startAfter, type QueryDocumentSnapshot, type DocumentData } from 'firebase/firestore'
import { app, auth, db } from './firebase'
import { functionsClient } from './functionsClient'
import type { CaseRecord, Command } from '../../functions/src/domain'
export { CATEGORIES, STATUSES } from '../../functions/src/domain'
export type DisputeRecord = CaseRecord & { id: string }
export type CaseActivity = { id: string; action: string; text: string | null; created_at: number; actor_role: string; attachment_ids: string[]; status: string }
export type CaseEvidence = { id: string; name: string; type: string; owner: string; restricted: boolean; deleted?: boolean }
export type CaseNotification = { id: string; user_id: string; case_id: string; reference: string; type: string; title: string; message: string; created_at: number; read: boolean }
function backend() {
  if (!app || !auth?.currentUser) throw new Error('Sign in to a connected Firebase account. Cases cannot be submitted in demo mode.')
  if (auth.currentUser.isAnonymous) throw new Error('Link your anonymous booking identity to a recoverable account before reporting.')
  return functionsClient()
}
async function call<T>(name: string, data: unknown): Promise<T> {
  return (await httpsCallable<unknown, T>(backend(), name)(data)).data
}
export function operationId() { return crypto.randomUUID() }
/** Only opaque operation IDs and SHA-256 fingerprints persist; never drafts/evidence. */
export async function caseCommand(input: Omit<Command, 'operationId'>): Promise<{ caseId: string; reference: string; version: number }> {
  const fingerprint = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([auth?.currentUser?.uid, input]))))].map(b => b.toString(16).padStart(2, '0')).join('')
  const key = `hdl_case_op_${fingerprint}`
  let op: string = operationId()
  try { op = sessionStorage.getItem(key) || op; sessionStorage.setItem(key, op) } catch { /* memory-only browser */ }
  // Keep the receipt key after success too: an accidental repeated identical submission is idempotent.
  return call('disputeCommand', { ...input, operationId: op })
}
export function subscribeCases(uid: string, bookingId: string | undefined, next: (cases: DisputeRecord[]) => void, error: (error: Error) => void, count = 25) {
  if (!db) { error(new Error('Cloud case management is unavailable in demo mode. Use official contact channels.')); return () => {} }
  const q = query(collection(db, 'cases'), where('guest_id', '==', uid), where('visibility', '==', 'guest'), ...(bookingId ? [where('booking_id', '==', bookingId)] : []), orderBy('updated_at', 'desc'), limit(count))
  return onSnapshot(q, snap => next(snap.docs.map(d => ({ id: d.id, ...d.data() } as DisputeRecord)).filter(c => !bookingId || c.booking_id === bookingId)), error)
}
export async function getDisputesForBooking(bookingId: string, guestId: string): Promise<DisputeRecord[]> {
  if (!db) throw new Error('Database unavailable.')
  const snap = await getDocs(query(collection(db, 'cases'), where('guest_id', '==', guestId), where('visibility', '==', 'guest'), orderBy('updated_at', 'desc'), limit(100)))
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as DisputeRecord)).filter(c => c.booking_id === bookingId)
}
export async function activityPage(caseId: string, cursor?: QueryDocumentSnapshot<DocumentData>) {
  if (!db) throw new Error('Database unavailable.')
  const q = query(collection(db, 'cases', caseId, 'activity'), orderBy('created_at', 'desc'), ...(cursor ? [startAfter(cursor)] : []), limit(40))
  const snap = await getDocs(q)
  return { items: snap.docs.map(d => ({ id: d.id, ...d.data() } as CaseActivity)), cursor: snap.docs.at(-1), hasMore: snap.size === 40 }
}
export function subscribeEvidence(caseId: string, next: (files: CaseEvidence[]) => void, error: (error: Error) => void) {
  if (!db) return () => {}
  return onSnapshot(query(collection(db, 'cases', caseId, 'evidence'), limit(50)), snap => next(snap.docs.map(d => ({ id: d.id, ...d.data() } as CaseEvidence))), error)
}
export async function uploadCaseEvidence(c: DisputeRecord, file: File, progress: (text: string) => void): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type) || file.size < 1 || file.size > 10 * 1024 * 1024) throw new Error('Allowed: JPEG, PNG, WebP or PDF, up to 10 MB each.')
  const begin = await call<{ uploadId: string; chunkSize: number }>('disputeEvidence', { action: 'begin', operationId: operationId(), caseId: c.id, expectedVersion: c.version, name: file.name, type: file.type, size: file.size })
  for (let offset = 0, index = 0; offset < file.size; offset += begin.chunkSize, index++) {
    const bytes = new Uint8Array(await file.slice(offset, offset + begin.chunkSize).arrayBuffer())
    let binary = ''; for (const b of bytes) binary += String.fromCharCode(b)
    const payload = { action: 'chunk', uploadId: begin.uploadId, index, base64: btoa(binary) }
    // One transport retry with identical bytes; backend chunk writes are immutable.
    try { await call('disputeEvidence', payload) } catch { await call('disputeEvidence', payload) }
    progress(`Uploading ${file.name}: ${Math.round(Math.min(offset + bytes.length, file.size) / file.size * 100)}%`)
  }
  progress(`Validating ${file.name}…`)
  await call('disputeEvidence', { action: 'finalize', uploadId: begin.uploadId })
  return begin.uploadId
}
export async function downloadCaseEvidence(uploadId: string) {
  const file = await call<{ base64: string; type: string; name: string }>('disputeEvidence', { action: 'download', uploadId })
  const bytes = Uint8Array.from(atob(file.base64), c => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: file.type }))
  const link = document.createElement('a'); link.href = url; link.download = file.name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export async function caseInbox(cursor?: string): Promise<CaseNotification[]> { return (await call<{ items: CaseNotification[] }>('disputeInbox', { action: 'list', ...(cursor ? { cursor } : {}) })).items }
export async function readCaseNotification(notificationId: string) { await call('disputeInbox', { action: 'read', notificationId }) }
export const caseDate = (n: number | null) => n ? new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }).format(n) : 'Not set'
export const caseLabel = (s: string) => s.replaceAll('_', ' ').replace(/\b\w/g, x => x.toUpperCase())
