// -----------------------------------------------------------------------------
// Legal content — Hacienda de LuisAna
// -----------------------------------------------------------------------------
// The single source of truth for /legal. The page, the booking flow and the
// payment step all read the version from here; the booking records the version
// a Guest accepted. The wording is split into five files by subject so that a
// change to the privacy notice does not sit in the same diff as the cancellation
// terms, but the exported surface is one module.
//
// The version is a date, not a semantic version: it is the date the wording was
// last changed, and it is what a Guest's acceptance is checked against. Bumping
// it is a deliberate act — it means every Guest is asked to accept the new
// wording the next time they book or pay.
// -----------------------------------------------------------------------------

import { BOOKING_SECTIONS } from './booking'
import { CONDUCT_SECTIONS } from './conduct'
import { CONTENT_SECTIONS } from './content'
import { GENERAL_SECTIONS } from './general'
import { PRIVACY_SECTIONS } from './privacy'
import type { LegalPart, LegalSection, LegalSummaryPoint, LegalVersionEntry } from './types'

export type { LegalBlock, LegalNoteTone, LegalPart, LegalPartId, LegalSection, LegalSummaryPoint, LegalVersionEntry } from './types'

/** The date the wording was last changed. Also the acceptance version. */
export const LEGAL_VERSION = '2026-11-03'

/** The date the current version takes effect. */
export const LEGAL_EFFECTIVE_DATE = '2026-11-03'

/** The date the Admin last reviewed the page. */
export const LEGAL_LAST_REVIEWED = '2026-11-03'

/** The next scheduled review. Earlier if a rule changes. */
export const LEGAL_NEXT_REVIEW = '2027-11-03'

/** How often the Admin reviews the page. */
export const LEGAL_REVIEW_CYCLE =
  'At least annually, and whenever a booking, payment, privacy or access rule changes'

/** The five groups the table of contents is arranged under. */
export const LEGAL_PARTS: LegalPart[] = [
  {
    id: 'booking',
    title: 'Booking, payment and the stay',
    blurb: 'How a request becomes a confirmed booking, what the money covers, and what happens when plans change.',
  },
  {
    id: 'conduct',
    title: 'Conduct, safety and property',
    blurb: 'What the Hacienda asks of every guest, and how the property, the deposit and the smart lock work.',
  },
  {
    id: 'privacy',
    title: 'Privacy and personal data',
    blurb: 'What the Hacienda collects, why, who it is shared with, how long it is kept, and the rights a Guest has.',
  },
  {
    id: 'content',
    title: 'Content, intellectual property and third parties',
    blurb: 'Who owns a message, a review or a photograph, and how Airbnb, Agoda and payment providers fit in.',
  },
  {
    id: 'legal',
    title: 'Legal protections and document control',
    blurb: 'Fraud prevention, zero tolerance, force majeure, liability, disputes, changes and how to give notice.',
  },
]

/**
 * The full terms, in reading order. The order is the numbering on the page and
 * the order of the table of contents. Do not reorder without checking the
 * cross-references in the text: the sections refer to each other by number.
 */
export const TERMS: LegalSection[] = [
  ...BOOKING_SECTIONS,
  ...CONDUCT_SECTIONS,
  ...PRIVACY_SECTIONS,
  ...CONTENT_SECTIONS,
  ...GENERAL_SECTIONS,
]

/** The plain-language summary at the top of the page. A guide, not the terms. */
export const LEGAL_SUMMARY: LegalSummaryPoint[] = [
  {
    lead: 'A booking is a request until the Admin approves it.',
    text: 'The dates are held for 24 hours while the payment proof is reviewed. A hold is not a reservation, and a Pending booking does not entitle you to check in.',
  },
  {
    lead: 'Pay only through the official channels.',
    text: 'The payment step shows the GCash and BDO QR codes. The Hacienda never asks for a password, PIN or OTP, and never asks you to pay a personal account that is not published there.',
  },
  {
    lead: 'The downpayment is 50% of the stay total.',
    text: 'The balance is due at check-in unless you chose full payment. The security deposit is separate and is refundable after the check-out inspection, less any itemized deductions.',
  },
  {
    lead: 'Cancellation refunds follow the policy stamped on your booking.',
    text: 'The current published policy is shown in section 9. Check your booking’s recorded policy for the terms that apply to it, because a later change does not rewrite an existing booking.',
  },
  {
    lead: 'Check-in is 2:00 PM and check-out is 12:00 noon.',
    text: 'The standard stay is 22 hours. Late checkout is by request and approval, at the published hourly rate. Check-in must be at least 30 days before arrival.',
  },
  {
    lead: 'The property is private and family-oriented.',
    text: 'Parties, events and commercial use need written approval. Illegal drugs, firearms without authority, gambling, trafficking and exploitation are prohibited and will be reported to the authorities.',
  },
  {
    lead: 'The Hacienda protects your privacy.',
    text: 'The Hacienda collects only what it needs to run the stay, does not sell personal data, and deletes a conversation 90 days after the booking reaches a terminal status.',
  },
  {
    lead: 'Questions? Contact the Hacienda before you book.',
    text: 'Use the official channels on the Contact page. The Hacienda would rather answer a question than have a dispute later.',
  },
]

/** The version-history table at the foot of the page. */
export const LEGAL_VERSION_HISTORY: LegalVersionEntry[] = [
  {
    version: '2026-11-03',
    effective: '3 November 2026',
    summary:
      'Expanded and reorganized the terms; added a detailed privacy notice, guest conduct, safety, liability, indemnity, dispute resolution, force majeure, fraud prevention and document control; clarified the 30-day booking lead time and the 90-day chat retention.',
  },
  {
    version: '2026-10-30',
    effective: '30 October 2026',
    summary: 'Core terms, privacy summary, booking rules, cancellation, payment and smart-lock rules.',
  },
]

/** The document-control table at the foot of the page. */
export const LEGAL_DOCUMENT_CONTROL: { field: string; value: string }[] = [
  { field: 'Document owner', value: 'The Admin, Hacienda de LuisAna' },
  { field: 'Version', value: LEGAL_VERSION },
  { field: 'Effective date', value: '3 November 2026' },
  { field: 'Last reviewed', value: '3 November 2026' },
  { field: 'Next review', value: '3 November 2027, or earlier if a rule changes' },
  { field: 'Review cycle', value: LEGAL_REVIEW_CYCLE },
  { field: 'Scope', value: 'The website, bookings, stays, payments, access and personal data' },
  { field: 'Related documents', value: 'House rules, published rates, booking confirmation, privacy notice' },
]

export function sectionById(id: string): LegalSection | undefined {
  return TERMS.find((section) => section.id === id)
}

/** The 1-based number a section shows on the page, or null if it is not listed. */
export function sectionNumber(id: string): number | null {
  const index = TERMS.findIndex((section) => section.id === id)
  return index === -1 ? null : index + 1
}

/** The sections in one part, in reading order. */
export function sectionsInPart(part: LegalPart['id']): LegalSection[] {
  return TERMS.filter((section) => section.part === part)
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
