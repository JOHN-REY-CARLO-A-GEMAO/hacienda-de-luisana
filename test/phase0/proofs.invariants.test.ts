import { beforeEach, expect, it, vi } from 'vitest'
import './doubles/cloud'
import { resetCloudDouble } from './doubles/cloud'
import { uploadPaymentProof } from '../../src/lib/payments/upload'
import { cloudBookingsDB } from '../../src/lib/firestoreBookings'
import { scenarios, request } from './fixtures'
vi.mock('../../src/lib/supabase', () => ({ isSupabaseConfigured: false, supabase: null, PAYMENT_PROOFS_BUCKET: 'payment-proofs' }))
beforeEach(resetCloudDouble)

it('F12 DESIRED: proof upload outcome preserves the browser-local versus remotely available evidence distinction', async () => {
  const result = await uploadPaymentProof({ file: new File(['synthetic'], 'phase0.png', { type: 'image/png' }), bookingRefId: scenarios.booking.ref_id })
  expect(result).toMatchObject({ ok: true, mode: 'local' })
})
it('F12 DESIRED: local-only evidence is not treated as a remotely reviewable cloud submission', async () => {
  const proof = await uploadPaymentProof({ file: new File(['synthetic'], 'phase0.png', { type: 'image/png' }), bookingRefId: scenarios.booking.ref_id })
  if (!proof.ok) throw new Error(proof.message)
  // The present API cannot carry evidence provenance. Retarget this probe to
  // the approved submission/evidence command, rather than guessing new fields.
  const created = await cloudBookingsDB.add(request({ payment_proof_url: proof.url }))
  expect(created.storage).not.toBe('cloud')
})
