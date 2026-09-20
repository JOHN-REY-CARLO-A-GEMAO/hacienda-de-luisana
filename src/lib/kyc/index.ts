// ----------------------------------------------------------------------------
// KYC document uploads: the contract shared with the mobile app, and the web
// adapter that writes to Firebase Storage under the Guest's own uid.
// ----------------------------------------------------------------------------
export {
  KYC_IMAGE_EXTENSIONS,
  KYC_MAX_BYTES,
  kycContentType,
  kycObjectPath,
  validateKycFile,
  type KycFile,
  type KycKind,
  type KycValidation,
} from './contract'

export {
  KYC_UPLOAD_UNAVAILABLE_MESSAGE,
  uploadKycDocument,
  type KycUploadFailureReason,
  type KycUploadOutcome,
} from './upload'
