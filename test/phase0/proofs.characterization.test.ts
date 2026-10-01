// Actual upload/storage helper under an explicitly synthetic Supabase SDK.
// No SQL/RLS, signer authentication, deployed bucket, or cloud upload proof.
import { beforeEach, expect, it, vi } from 'vitest'
import './doubles/cloud'
import { sdk, resetCloudDouble, deferred } from './doubles/cloud'
import { cloudBookingsDB } from '../../src/lib/firestoreBookings'
import { uploadPaymentProof } from '../../src/lib/payments/upload'
import { uploadPaymentProofFile, readLocalPaymentProof } from '../../src/lib/storage'
import { scenarios, request, NOW } from './fixtures'

const store = vi.hoisted(() => ({ configured: false, upload: vi.fn() }))
vi.mock('../../src/lib/supabase', () => ({
  get isSupabaseConfigured() { return store.configured }, PAYMENT_PROOFS_BUCKET: 'payment-proofs',
  supabase: { storage: { from: () => ({ upload: store.upload }) } },
}))
const image = () => new File(['synthetic receipt only'], 'phase0.png', { type: 'image/png' })
const path = scenarios.evidence.valid.path
beforeEach(() => { resetCloudDouble(); store.configured = false; store.upload.mockReset() })

it('F12-LOCAL-EVIDENCE: storage labels browser-only proof, but upload wrapper drops that label', async () => {
  const stored = await uploadPaymentProofFile({ file: image(), path })
  expect(stored).toMatchObject({ ok: true, mode: 'local', path })
  const outcome = await uploadPaymentProof({ file: image(), bookingRefId: scenarios.booking.ref_id })
  expect(outcome).toMatchObject({ ok: true, uid: scenarios.identities.anonymousGuest.uid, url: path })
  expect(outcome).not.toHaveProperty('mode')
  expect(readLocalPaymentProof(path)).toMatch(/^data:image\/png;base64,/)
  expect(store.upload).not.toHaveBeenCalled()
})
it('F12-MIXED-PERSISTENCE: a browser-only proof is accepted into a cloud Booking by the actual adapters', async () => {
  const proof = await uploadPaymentProof({ file: image(), bookingRefId: scenarios.booking.ref_id })
  if (!proof.ok) throw new Error(proof.message)
  const created = await cloudBookingsDB.add(request({ payment_proof_url: proof.url, paymentProofUrl: proof.url }))
  expect(created.storage).toBe('cloud')
  expect(sdk.records.get(`bookings/${created.id}`)?.payment_proof_url).toBe(path)
  expect(readLocalPaymentProof(path)).not.toBeNull()
  expect(store.upload).not.toHaveBeenCalled()
})
it('F12-CLOUD-SUCCESS-CONTROL: configured successful upload is labelled Supabase at storage seam', async () => {
  store.configured = true; store.upload.mockResolvedValue({ error: null })
  expect(await uploadPaymentProofFile({ file: image(), path })).toMatchObject({ ok: true, mode: 'supabase', path })
  expect(readLocalPaymentProof(path)).toBeNull()
})
it('F12-CLOUD-FAILURE-CONTROL: configured permission failure is visible, not replayed into local proofs', async () => {
  store.configured = true; store.upload.mockResolvedValue({ error: { message: 'synthetic RLS refusal' } })
  expect(await uploadPaymentProofFile({ file: image(), path })).toMatchObject({ ok: false })
  expect(readLocalPaymentProof(path)).toBeNull()
})
it('F05-INVALID-FILE-CONTROL: missing/wrong file context cannot initiate an SDK upload', async () => {
  const invalid = new File(['synthetic'], scenarios.evidence.invalidFile.name, { type: scenarios.evidence.invalidFile.type })
  expect(await uploadPaymentProof({ file: invalid, bookingRefId: scenarios.booking.ref_id })).toMatchObject({ ok: false, reason: 'wrong-type' })
  expect(store.upload).not.toHaveBeenCalled()
})
it('F17-PROOF-TIMEOUT: timeout does not cancel the pending upload; retry uses the colliding object path', async () => {
  store.configured = true
  vi.useRealTimers()
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(new Date(NOW))
  const commit = deferred<{ error: null }>()
  store.upload.mockReturnValueOnce(commit.promise)
  const first = uploadPaymentProof({ file: image(), bookingRefId: scenarios.booking.ref_id })
  await vi.waitFor(() => expect(store.upload).toHaveBeenCalledTimes(1))
  expect(vi.getTimerCount()).toBeGreaterThan(0)
  await vi.advanceTimersByTimeAsync(60_001)
  expect(await first).toMatchObject({ ok: false, reason: 'failed' })
  // Simulate the already-issued SDK operation completing AFTER timeout.
  commit.resolve({ error: null }); await Promise.resolve()
  store.upload.mockResolvedValueOnce({ error: { message: 'already exists (synthetic late commit)' } })
  const second = await uploadPaymentProof({ file: image(), bookingRefId: scenarios.booking.ref_id })
  expect(second).toMatchObject({ ok: false, reason: 'failed' })
  expect(store.upload.mock.calls.map(call => call[0])).toEqual([path, path])
  expect(readLocalPaymentProof(path)).toBeNull()
})
