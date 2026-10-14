// ----------------------------------------------------------------------------
// Booking lifecycle — structured add-ons & special requests
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// A Guest's stay can carry requests: pets, bonfire wood sets, hours of late
// checkout, and the purpose of the stay (reunion, team building, and so on).
// Each one is either PRICED — the Admin published a figure for it, so it is
// added to the stay total exactly as `stayAddons` in ./rates computes — or a
// REQUEST — no figure is published (or the charge is manual by policy), so it
// is recorded for the Admin to review, approve and price, and it never touches
// the booking total.
//
// This module owns that split, the guest-visible fee breakdown lines, the
// sanitizer that keeps quantities whole and in range, and the composed
// `special_requests` text the Admin app has always displayed. It is pure: like
// the rest of this module it imports nothing from Firebase, the config or the
// browser, so every surface — page, adapter, rules-mirror validator and test —
// reads the same answers.
//
// Business rules encoded here (all confirmed in the repository):
//   • Pet sanitation fee ₱300/pet, bonfire wood ₱150/set, approved late
//     checkout ₱250/hour — src/config/officialBusiness.ts `optional_charges`
//     and src/config/site.ts `FEES.additional`. All three are `automatic:false`
//     in the published policy text: nothing is added to an ordinary stay by
//     itself (test/web/site-content.test.tsx, test/web/official-rates.test.ts).
//   • When the Admin publishes `pet_policy` / `late_checkout_per_hour` in the
//     rates document, those charges ARE priced into the stay total
//     (`stayAddons`, firestore.rules `petFee`/`lateCheckoutFee`) so one Booking
//     stays one receipt and one 50/50 split.
//   • Bonfire wood and special-event charges have no automatic pricing path at
//     all: they are always Admin-reviewed requests.
// ----------------------------------------------------------------------------

import { roundMoney } from './internal'
import type { PublishedRates, StayExtras } from './rates'

/** The purposes a Guest may name for the stay. Informational; never priced here. */
export type EventPurpose = 'reunion' | 'team_building' | 'wedding_prep' | 'photoshoot' | 'other'

export const EVENT_PURPOSES: { id: EventPurpose; label: string }[] = [
  { id: 'reunion', label: 'Reunion' },
  { id: 'team_building', label: 'Team Building' },
  { id: 'wedding_prep', label: 'Wedding Prep' },
  { id: 'photoshoot', label: 'Photoshoot' },
  { id: 'other', label: 'Other' },
]

export function eventPurposeLabel(id: string | undefined | null): string {
  return EVENT_PURPOSES.find((purpose) => purpose.id === id)?.label ?? ''
}

/**
 * What the Guest asked for, in structured form. Everything is optional; an
 * absent or zero value is simply "not requested". `notes` is the free text for
 * anything the structured controls do not cover.
 */
export type StayRequests = {
  pet_count?: number
  bonfire_wood_sets?: number
  late_checkout_hours?: number
  event_purpose?: EventPurpose | ''
  /** The Guest's own words when `event_purpose` is `other`. */
  event_purpose_detail?: string
  notes?: string
}

// Sanity ceilings for the UI. They are not business rules: the published
// `pet_policy.max_pets` overrides the pet ceiling whenever one exists, and the
// late-checkout ceiling matches the 1–6 hour selector the post-booking
// LateCheckoutRequest component has always offered.
export const MAX_REQUEST_PETS = 10
export const MAX_BONFIRE_WOOD_SETS = 10
export const MAX_LATE_CHECKOUT_HOURS = 6
export const EVENT_PURPOSE_DETAIL_MAX = 160
export const REQUEST_NOTES_MAX = 1000

/** The most pets one Booking may declare under the current published policy. */
export function maxPetsFor(published: PublishedRates | null | undefined): number {
  const cap = published?.pet_policy?.max_pets
  return typeof cap === 'number' && Number.isInteger(cap) && cap >= 1 ? cap : MAX_REQUEST_PETS
}

function clampCount(value: unknown, max: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(max, Math.max(0, Math.floor(n)))
}

function clampText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, max)
}

/**
 * Coerce anything (a parsed session draft, a query string, a stale document)
 * into whole, in-range request values. Quantities floor at zero, so a negative
 * or fractional count can never reach a quote, a fee line or Firestore.
 */
export function sanitizeStayRequests(
  raw: Partial<StayRequests> | null | undefined,
  published?: PublishedRates | null,
): StayRequests {
  const purpose = typeof raw?.event_purpose === 'string'
    && EVENT_PURPOSES.some((option) => option.id === raw?.event_purpose)
    ? (raw!.event_purpose as EventPurpose)
    : ''
  const detail = clampText(raw?.event_purpose_detail, EVENT_PURPOSE_DETAIL_MAX)
  return {
    pet_count: clampCount(raw?.pet_count, maxPetsFor(published)),
    bonfire_wood_sets: clampCount(raw?.bonfire_wood_sets, MAX_BONFIRE_WOOD_SETS),
    late_checkout_hours: clampCount(raw?.late_checkout_hours, MAX_LATE_CHECKOUT_HOURS),
    event_purpose: purpose,
    // A detail without "Other" (or without any purpose) is noise; drop it.
    ...(purpose === 'other' && detail ? { event_purpose_detail: detail } : {}),
    notes: clampText(raw?.notes, REQUEST_NOTES_MAX),
  }
}

/** Peso figures a request falls back to when the rates document publishes none. */
export type AddonFallbackAmounts = {
  fee_per_pet?: number
  bonfire_wood_per_set?: number
  late_checkout_per_hour?: number
}

export type AddonLineId = 'pets' | 'bonfire_wood' | 'late_checkout'

/** One row of the guest-visible fee breakdown. */
export type AddonFeeLine = {
  id: AddonLineId
  label: string
  quantity: number
  /** e.g. "per pet" — how one unit of this charge is described. */
  unitLabel: string
  /** Pesos per unit, or null when no figure is published or documented. */
  unitAmount: number | null
  /** `quantity × unitAmount`, or null when the unit amount is unknown. */
  amount: number | null
  /** True when the charge is part of the quoted stay total (automatic). */
  includedInTotal: boolean
  /** True when the Admin must approve the request before it is charged. */
  requiresApproval: boolean
  note: string
}

function isAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/**
 * The live fee breakdown for the current requests: one line per requested
 * add-on, each marked as priced into the stay total or pending Admin approval.
 * Lines with a quantity of zero are omitted — a Guest who asked for nothing
 * sees no breakdown.
 */
export function addonFeeLines(
  published: PublishedRates | null | undefined,
  requests: StayRequests,
  fallback: AddonFallbackAmounts = {},
): AddonFeeLine[] {
  const lines: AddonFeeLine[] = []
  const pets = Math.max(0, Math.floor(requests.pet_count ?? 0))
  const sets = Math.max(0, Math.floor(requests.bonfire_wood_sets ?? 0))
  const hours = Math.max(0, Math.floor(requests.late_checkout_hours ?? 0))

  if (pets > 0) {
    const policy = published?.pet_policy
    const priced = isAmount(policy?.fee_per_pet)
    const unit = priced ? policy!.fee_per_pet : isAmount(fallback.fee_per_pet) ? fallback.fee_per_pet : null
    lines.push({
      id: 'pets',
      label: `Pets (${pets})`,
      quantity: pets,
      unitLabel: 'per pet',
      unitAmount: unit,
      amount: unit === null ? null : roundMoney(pets * unit),
      includedInTotal: priced,
      requiresApproval: !priced,
      note: priced
        ? 'Published sanitation fee — added to your estimated stay total.'
        : 'Estimated sanitation fee — the Admin confirms this request; it is not added to your booking total.',
    })
  }

  if (sets > 0) {
    // Bonfire wood has no automatic pricing path anywhere in the system: the
    // published policy says the pit itself is free and the wood set is an
    // Admin-approved extra (officialBusiness.ts `optional_charges.bonfire_wood`).
    const chargeAmount = published?.policies?.optional_charges?.bonfire_wood?.amount
    const unit = isAmount(chargeAmount) ? chargeAmount
      : isAmount(fallback.bonfire_wood_per_set) ? fallback.bonfire_wood_per_set : null
    lines.push({
      id: 'bonfire_wood',
      label: `Bonfire wood (${sets} set${sets === 1 ? '' : 's'})`,
      quantity: sets,
      unitLabel: 'per set',
      unitAmount: unit,
      amount: unit === null ? null : roundMoney(sets * unit),
      includedInTotal: false,
      requiresApproval: true,
      note: 'The bonfire pit is free to use; wood sets are prepared by the Admin and settled with approval.',
    })
  }

  if (hours > 0) {
    const publishedRate = published?.late_checkout_per_hour
    const priced = isAmount(publishedRate)
    const unit = priced ? publishedRate as number
      : isAmount(fallback.late_checkout_per_hour) ? fallback.late_checkout_per_hour : null
    lines.push({
      id: 'late_checkout',
      label: `Late checkout (+${hours} hour${hours === 1 ? '' : 's'})`,
      quantity: hours,
      unitLabel: 'per hour after 12:00 noon',
      unitAmount: unit,
      amount: unit === null ? null : roundMoney(hours * unit),
      includedInTotal: priced,
      requiresApproval: !priced,
      note: priced
        ? 'Published hourly rate — added to your estimated stay total, subject to availability and the Admin’s approval of your booking.'
        : 'Estimated hourly fee — subject to availability and Admin approval; it is not added to your booking total.',
    })
  }

  return lines
}

/** The sum of every estimated add-on fee, priced and pending alike. */
export function estimatedAdditionalFees(lines: AddonFeeLine[]): number {
  return roundMoney(lines.reduce((sum, line) => sum + (line.amount ?? 0), 0))
}

/** Whether the Admin has published the figure that prices each add-on. */
export function addonPricingState(
  published: PublishedRates | null | undefined,
  requests: { pet_count?: number; late_checkout_hours?: number },
): { petsPriced: boolean; lateCheckoutPriced: boolean } {
  return {
    petsPriced: (requests.pet_count ?? 0) > 0 && isAmount(published?.pet_policy?.fee_per_pet),
    lateCheckoutPriced: (requests.late_checkout_hours ?? 0) > 0 && isAmount(published?.late_checkout_per_hour),
  }
}

/**
 * The extras that go INTO the quote — only the ones the Admin has priced. An
 * unpriced request must never reach `quoteAccommodation`: `stayAddons` refuses
 * the whole quote for a pet with no published fee, and a request the Admin has
 * not priced is the Admin's to approve, not a reason to refuse the Booking.
 */
export function pricedStayExtras(
  published: PublishedRates | null | undefined,
  requests: { pet_count?: number; late_checkout_hours?: number },
): StayExtras {
  const { petsPriced, lateCheckoutPriced } = addonPricingState(published, requests)
  return {
    ...(petsPriced ? { pet_count: Math.floor(requests.pet_count ?? 0) } : {}),
    ...(lateCheckoutPriced ? { late_checkout_hours: Math.floor(requests.late_checkout_hours ?? 0) } : {}),
  }
}

/** What `composeSpecialRequests` needs to say about each charge's status. */
export type ComposeRequestMeta = {
  petsIncludedInTotal?: boolean
  lateCheckoutIncludedInTotal?: boolean
  /** Peso unit figures to print; null/undefined prints no figure. */
  petUnitAmount?: number | null
  bonfireUnitAmount?: number | null
  lateCheckoutUnitAmount?: number | null
}

/** `₱1,250` for whole pesos; centavos only when the figure has them. */
export function formatPesos(amount: number): string {
  const hasCentavos = Math.abs(amount * 100 - Math.round(amount) * 100) >= 0.5
  return `₱${amount.toLocaleString('en-PH', {
    minimumFractionDigits: hasCentavos ? 2 : 0,
    maximumFractionDigits: hasCentavos ? 2 : 0,
  })}`
}

/**
 * The `special_requests` text stored on the Booking: a composed, human-readable
 * summary of every structured request plus the Guest's own notes. The Flutter
 * Admin app has always shown this string as the booking's Notes
 * (lib/views/bookings/booking_detail_screen.dart), so composing it here is what
 * keeps structured requests visible to the Admin with no schema the Admin app
 * has to learn. With no structured selections the output is exactly the Guest's
 * free text — byte-identical to what the old free-text-only form stored.
 */
export function composeSpecialRequests(requests: StayRequests, meta: ComposeRequestMeta = {}): string {
  const parts: string[] = []
  const pets = Math.max(0, Math.floor(requests.pet_count ?? 0))
  const sets = Math.max(0, Math.floor(requests.bonfire_wood_sets ?? 0))
  const hours = Math.max(0, Math.floor(requests.late_checkout_hours ?? 0))

  if (pets > 0) {
    const fee = isAmount(meta.petUnitAmount) ? ` at ${formatPesos(meta.petUnitAmount!)} per pet` : ''
    const status = meta.petsIncludedInTotal
      ? 'included in the stay total'
      : 'estimated fee, pending Admin approval'
    parts.push(`Pets: ${pets}${fee} (${status}).`)
  }
  if (sets > 0) {
    const fee = isAmount(meta.bonfireUnitAmount) ? ` at ${formatPesos(meta.bonfireUnitAmount!)} per set` : ''
    parts.push(`Bonfire wood: ${sets} set${sets === 1 ? '' : 's'}${fee} (pending Admin approval; the bonfire pit itself is free).`)
  }
  if (hours > 0) {
    const fee = isAmount(meta.lateCheckoutUnitAmount) ? ` at ${formatPesos(meta.lateCheckoutUnitAmount!)} per hour` : ''
    const status = meta.lateCheckoutIncludedInTotal
      ? 'included in the stay total, subject to availability and Admin approval'
      : 'requested, subject to availability and Admin approval'
    parts.push(`Late checkout: +${hours} hour${hours === 1 ? '' : 's'} after 12:00 noon${fee} (${status}).`)
  }
  const purpose = eventPurposeLabel(requests.event_purpose)
  if (purpose) {
    const detail = requests.event_purpose === 'other' && requests.event_purpose_detail?.trim()
      ? ` — ${requests.event_purpose_detail.trim()}`
      : ''
    parts.push(`Event / purpose: ${purpose}${detail}.`)
  }
  const notes = requests.notes?.trim()
  if (notes) parts.push(parts.length > 0 ? `Notes: ${notes}` : notes)
  return parts.join(' ')
}

/** A one-line summary of the structured requests, for compact order summaries. */
export function summarizeStayRequests(requests: StayRequests): string[] {
  const lines: string[] = []
  if ((requests.pet_count ?? 0) > 0) lines.push(`${requests.pet_count} pet${requests.pet_count === 1 ? '' : 's'}`)
  if ((requests.bonfire_wood_sets ?? 0) > 0) lines.push(`${requests.bonfire_wood_sets} bonfire wood set${requests.bonfire_wood_sets === 1 ? '' : 's'}`)
  if ((requests.late_checkout_hours ?? 0) > 0) lines.push(`Late checkout +${requests.late_checkout_hours}h`)
  const purpose = eventPurposeLabel(requests.event_purpose)
  if (purpose) {
    lines.push(requests.event_purpose === 'other' && requests.event_purpose_detail?.trim()
      ? `${purpose}: ${requests.event_purpose_detail.trim()}`
      : purpose)
  }
  return lines
}
