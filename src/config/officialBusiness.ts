import type { AccommodationRates, PublishedStayPolicies } from '../lib/booking/rates'
import type { PaymentInformation } from '../lib/paymentInfoDB'

export const OFFICIAL_ACCOMMODATION_RATES: Record<string, Omit<AccommodationRates, 'security_deposit'>> = {
  'main-house': {
    property_name: 'HDL Main House',
    rate_unit: 'standard_stay',
    active: true,
    guest_pricing: {
      units_per_booking: 1,
      weekday: {
        min_guests: 1, base_max_guests: 10, base_rate: 5000, excess_per_guest: 500,
      },
      weekend_holiday: {
        min_guests: 1, base_max_guests: 10, base_rate: 6000, excess_per_guest: 500,
      },
    },
    down_payment_percent: 50,
    manual_review_notice: 'The 50% down payment is calculated from this stay total. Reunions, team building and shoots require Admin discussion; no event charge is added automatically.',
  },
  annex: {
    property_name: 'HDL Annex',
    rate_unit: 'standard_stay',
    active: true,
    guest_pricing: {
      units_per_booking: 1,
      weekday: { min_guests: 1, base_max_guests: 6, base_rate: 4000, excess_per_guest: 500 },
      weekend_holiday: { min_guests: 1, base_max_guests: 6, base_rate: 5000, excess_per_guest: 500 },
    },
    down_payment_percent: 50,
    manual_review_notice: 'The 50% down payment is calculated from this stay total. Events require Admin discussion; no event charge is added automatically.',
  },
  'house-a-camping': {
    property_name: 'A-House',
    rate_unit: 'standard_stay',
    active: true,
    guest_pricing: {
      units_per_booking: 1,
      // Three guests at the base rate; a fourth is accommodated for ₱500. The cap
      // and the excess rule are published together, because a cap without an
      // excess rule would charge the base rate for that fourth guest.
      weekday: { min_guests: 1, base_max_guests: 3, base_rate: 1000, max_guests: 4, excess_per_guest: 500 },
      weekend_holiday: { min_guests: 1, base_max_guests: 3, base_rate: 1000, max_guests: 4, excess_per_guest: 500 },
    },
    down_payment_percent: 50,
    manual_review_notice: 'One booking represents one A-House (3 guests included, a fourth charged as excess, 4 in total). Contact the Hacienda if more than one unit is needed.',
  },
}

export const OFFICIAL_STAY_POLICIES: PublishedStayPolicies = {
  standard_stay_hours: 22,
  check_in: '2:00 PM',
  check_out: '12:00 noon',
  special_event_notice: 'Events require discussion and confirmation with the Admin. No event charge is added automatically. The wedding-preparation package applies only to a booking explicitly identified and confirmed for that purpose.',
  clean_as_you_go: 'CLEAN AS YOU GO! Please observe the Hacienda house rules.',
  optional_charges: {
    pets: { label: 'Pet sanitation fee', amount: 300, unit: 'pet', automatic: false, note: '₱300 per pet for sanitation purposes. Mention pets when booking; this is not added automatically.' },
    bonfire_wood: { label: 'Bonfire wood set', amount: 150, unit: 'set', automatic: false, note: 'Optional wood set. Free use of the bonfire pit does not automatically include wood.' },
    late_checkout: { label: 'Approved late checkout', amount: 250, unit: 'hour', automatic: false, note: '₱250 per hour after 12:00 noon, only when requested and approved.' },
    wedding_preparation: { label: 'Wedding-preparation overnight package', amount: 8500, unit: 'set', automatic: false, note: 'Overnight package for up to 10 pax. Applies only to a booking explicitly identified as wedding preparation and confirmed by the Admin; it is not added to ordinary stays.' },
    special_event: { label: 'Special-event/use charge', unit: 'manual', automatic: false, note: 'No fixed event charge is published. Discuss the use case and any confirmed amount with the Admin; nothing is added automatically.' },
  },
}

export const OFFICIAL_PAYMENT_INFORMATION: PaymentInformation = {
  active: true,
  methods: [
    { method: 'GCash', recipient_name: 'Agueda H.', account_identifier: '09258507707' },
    { method: 'BDO', recipient_name: 'Agueda Hortillas', account_identifier: '005438013682' },
  ],
  instructions: 'Send the 50% down payment calculated from the published stay total through one listed payment channel. The remaining 50% is due at check-in. After sending the down payment, upload a screenshot for Admin review.',
  security_deposit_notes: 'The down payment is 50% of the computed stay total. Any refundable security deposit is shown separately on the published rate card.',
  notes: 'Payment proof is reviewed by an Admin. Never share a password, PIN, OTP, API key, or banking credential.',
}
