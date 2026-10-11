// ----------------------------------------------------------------------------
// Booking submission — the proof gate
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// A Booking does not exist until the Guest has attached a downpayment
// screenshot. The form collects the stay; the payment page is what submits.
// This check is the lifecycle's copy of that rule (ADR-0012). The UI asks for
// the file, and `cloudBookingsDB.add` refuses a submission that skips it, so
// a screen cannot create a Pending Booking with nothing for the Admin to review.
// ----------------------------------------------------------------------------

export type SubmissionProof = {
  payment_proof_url?: string | null
  amount_claimed?: number | null
}

export type SubmissionReady = { ok: true } | { ok: false; reason: string }

/**
 * Can this draft be submitted as a Pending Booking?
 *
 * The screenshot is mandatory. The amount is what the Admin checks the
 * screenshot against, so a proof with no figure is not a submission either.
 */
export function assertSubmittable(input: SubmissionProof): SubmissionReady {
  if (!input.payment_proof_url?.trim()) {
    return {
      ok: false,
      reason: 'Upload a screenshot of your downpayment before submitting the booking.',
    }
  }
  if (typeof input.amount_claimed !== 'number' || !(input.amount_claimed > 0)) {
    return {
      ok: false,
      reason: 'Enter the downpayment amount shown on the screenshot.',
    }
  }
  return { ok: true }
}
