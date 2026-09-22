// ----------------------------------------------------------------------------
// Payment proof uploads: the /payments contract, and the web adapter that
// writes to Firebase Storage under the Guest's own uid.
// ----------------------------------------------------------------------------
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
  PROOF_UPLOAD_UNAVAILABLE_MESSAGE,
  uploadPaymentProof,
  type ProofUploadFailureReason,
  type ProofUploadOutcome,
} from './upload'
