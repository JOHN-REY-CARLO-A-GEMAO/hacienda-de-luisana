export const LEGAL_VERSION = '2026-09-24'

export type LegalSection = {
  id: string
  title: string
  body: string[]
}

export const TERMS: LegalSection[] = [
  {
    id: 'terms',
    title: 'Terms and Conditions',
    body: [
      'These Terms govern bookings at Hacienda de LuisAna in Luisiana, Laguna.',
      'A booking is a request until the Admin reviews your identity (KYC), approves the stay, and verifies payment.',
      'You must be at least 10 years old to create an account. Guests under 18 must be accompanied by a responsible adult during the stay.',
      'You agree to provide accurate guest, contact, and payment information.',
    ],
  },
  {
    id: 'privacy',
    title: 'Privacy Policy',
    body: [
      'We store your account, booking, payment proof, KYC images, chat messages, and access logs to operate the stay.',
      'We do not run a live location tracker. Access logs record door events (granted/denied) with timestamps — not GPS trails.',
      'Government IDs are used only for booking review and are purged after the stay window defined in operations policy.',
      'We do not sell personal data. Cloud Firestore is the source of truth for shared records; your browser may cache non-sensitive UI state locally.',
    ],
  },
  {
    id: 'booking-rules',
    title: 'Booking rules',
    body: [
      'Check-in cannot be in the past. Check-out must be after check-in. Stays are 1–30 nights.',
      'Availability is checked before you submit and re-checked when the Admin approves. A held date is not a confirmed reservation.',
      'A date hold lasts 24 hours while the booking waits for review. If it expires, the dates are released.',
      'Only one active booking identity is attached at creation; it cannot be claimed later by another account.',
    ],
  },
  {
    id: 'cancellation',
    title: 'Cancellation and refunds',
    body: [
      'Refunds follow the published rates policy stamped on your booking when you chose a payment plan.',
      'If no policy was published at that moment, a cancellation refunds nothing.',
      'The security deposit is refundable after check-out inspection, separate from the stay total.',
      'The Admin settles refunds through the refund pipeline after verified payment.',
    ],
  },
  {
    id: 'payment',
    title: 'Payment instructions',
    body: [
      'Pay the quoted amount to the Hacienda GCash / bank details shown on the payment step — never to a third party claiming to be staff.',
      'Use a unique payment reference. Duplicate references are rejected.',
      'Upload a clear photo of the receipt. OCR may suggest a reference and amount; you must confirm or correct it.',
      'OCR is not verification. Status stays Pending until an Admin matches the reference and amount against the valid-reference list.',
      'Do not send passwords, PINs, or OTP codes. We never ask for them.',
    ],
  },
  {
    id: 'smart-lock',
    title: 'Smart lock and access rules',
    body: [
      'Access is granted only for a Reserved or in-stay booking on the valid dates, using an RFID credential or in-app Mobile Key.',
      'Every attempt is written to the Access log with timestamp, result (granted or denied), and reason.',
      'Unauthorized or out-of-date credentials will not unlock the door.',
      'Do not share your Mobile Key. Lost RFID cards must be reported to the Admin.',
    ],
  },
]

export function sectionById(id: string): LegalSection | undefined {
  return TERMS.find((s) => s.id === id)
}

export type TermsAcceptance = {
  accepted: boolean
  version: string
  at: string
}

export function recordAcceptance(now = new Date()): TermsAcceptance {
  return { accepted: true, version: LEGAL_VERSION, at: now.toISOString() }
}

export function isAcceptanceCurrent(a: TermsAcceptance | null | undefined): boolean {
  return Boolean(a?.accepted && a.version === LEGAL_VERSION)
}
