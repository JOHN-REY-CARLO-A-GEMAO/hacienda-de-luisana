// ----------------------------------------------------------------------------
// Add-on request pricing sources — the bridge between the pure booking module
// and the Hacienda's documented business config.
// ----------------------------------------------------------------------------
// `src/lib/booking/requests.ts` computes fee lines from the Admin's published
// rates document plus a set of fallback peso figures. Those fallbacks are the
// client-approved amounts documented in `src/config/officialBusiness.ts`
// (`optional_charges`: pets ₱300/pet, bonfire wood ₱150/set, approved late
// checkout ₱250/hour — all `automatic: false`, i.e. Admin-reviewed) and mirrored
// in `src/config/site.ts` `FEES.additional`. A rates document that publishes its
// own `policies.optional_charges` overrides the static config, and a published
// `pet_policy` / `late_checkout_per_hour` makes those charges automatic —
// priced into the stay total — exactly as `stayAddons` and firestore.rules
// compute them.

import { OFFICIAL_STAY_POLICIES } from '../config/officialBusiness'
import type { AddonFallbackAmounts, ComposeRequestMeta, PublishedRates, StayRequests } from './booking'
import { addonPricingState } from './booking'

function chargeAmount(
  published: PublishedRates | null | undefined,
  key: 'pets' | 'bonfire_wood' | 'late_checkout',
): number | undefined {
  const charges = published?.policies?.optional_charges ?? OFFICIAL_STAY_POLICIES.optional_charges
  const amount = charges?.[key]?.amount
  return typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 ? amount : undefined
}

/** The documented peso figures requests fall back to when nothing is published. */
export function officialAddonFallbacks(published: PublishedRates | null | undefined): AddonFallbackAmounts {
  return {
    fee_per_pet: published?.pet_policy?.fee_per_pet ?? chargeAmount(published, 'pets'),
    bonfire_wood_per_set: chargeAmount(published, 'bonfire_wood'),
    late_checkout_per_hour: published?.late_checkout_per_hour ?? chargeAmount(published, 'late_checkout'),
  }
}

/**
 * The meta `composeSpecialRequests` needs, derived from the same published
 * document the quote used — so the stored Notes text, the fee breakdown and
 * the money fields on the Booking can never disagree about what was automatic
 * and what awaits the Admin.
 */
export function composeRequestMeta(
  published: PublishedRates | null | undefined,
  requests: StayRequests,
): ComposeRequestMeta {
  const fallback = officialAddonFallbacks(published)
  const { petsPriced, lateCheckoutPriced } = addonPricingState(published, requests)
  return {
    petsIncludedInTotal: petsPriced,
    lateCheckoutIncludedInTotal: lateCheckoutPriced,
    petUnitAmount: fallback.fee_per_pet ?? null,
    bonfireUnitAmount: fallback.bonfire_wood_per_set ?? null,
    lateCheckoutUnitAmount: fallback.late_checkout_per_hour ?? null,
  }
}
