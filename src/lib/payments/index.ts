// ------------------------------------------------------------------------------
// Payment proof uploads: the /payments contract, and the web adapter that
// writes the file to Supabase Storage (bucket `payment-proofs`) or, in demo
// mode, this browser (ADR-0011).
// ------------------------------------------------------------------------------
export {
  PROOF_IMAGE_EXTENSIONS,
  PROOF_MAX_BYTES,
  proofContentType,
  proofObjectPath,
  validateProofFile,
  type ProofFile,
  type ProofValidation,
} from './contract'

export {
  uploadPaymentProof,
  type ProofUploadFailureReason,
  type ProofUploadOutcome,
} from './upload'
