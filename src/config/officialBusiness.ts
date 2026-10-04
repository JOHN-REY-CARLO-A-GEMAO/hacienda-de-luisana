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
        min_guests: 6, base_max_guests: 10, base_rate: 5000,
        upper_min_guests: 11, upper_max_guests: 13, upper_rate: 5500,
        excess_after: 13, excess_per_guest: 500,
      },
      weekend_holiday: {
        min_guests: 6, base_max_guests: 10, base_rate: 6000,
        upper_min_guests: 11, upper_max_guests: 13, upper_rate: 6500,
        excess_after: 13, excess_per_guest: 500,
      },
    },
    manual_review_notice: 'Reunions, team building, wedding preparation and shoots may have additional charges depending on guest count. The Admin confirms any amount before charging it.',
  },
  annex: {
    property_name: 'HDL Annex',
    rate_unit: 'standard_stay',
    active: true,
    guest_pricing: {
      units_per_booking: 1,
      weekday: { min_guests: 2, base_max_guests: 6, base_rate: 4000 },
      weekend_holiday: { min_guests: 2, base_max_guests: 6, base_rate: 5000 },
    },
    manual_review_notice: 'Reunions, team building, wedding preparation and shoots may have additional charges depending on guest count. The Admin confirms any amount before charging it.',
  },
  'house-a-camping': {
    property_name: 'A-House',
    rate_unit: 'standard_stay',
    active: true,
    guest_pricing: {
      units_per_booking: 1,
      weekday: { min_guests: 2, base_max_guests: 3, base_rate: 1000 },
      weekend_holiday: { min_guests: 2, base_max_guests: 3, base_rate: 1000 },
    },
    manual_review_notice: 'One booking represents one A-House. Contact the Hacienda if more than one unit is needed.',
  },
}

export const OFFICIAL_STAY_POLICIES: PublishedStayPolicies = {
  standard_stay_hours: 22,
  check_in: '2:00 PM',
  check_out: '12:00 noon',
  special_event_notice: 'For reunions, team building, wedding preparation and shoots, additional charges may apply depending on the number of guests. The Admin will review and confirm any charge.',
  clean_as_you_go: 'CLEAN AS YOU GO! Please observe the Hacienda house rules.',
  optional_charges: {
    pets: { label: 'Pet sanitation fee', amount: 300, unit: 'pet', automatic: false, note: '₱300 per pet for sanitation purposes. Mention pets when booking; this is not added automatically.' },
    bonfire_wood: { label: 'Bonfire wood set', amount: 150, unit: 'set', automatic: false, note: 'Optional wood set. Free use of the bonfire pit does not automatically include wood.' },
    late_checkout: { label: 'Approved late checkout', amount: 250, unit: 'hour', automatic: false, note: '₱250 per hour after 12:00 noon, only when requested and approved.' },
    special_event: { label: 'Special-event/use charge', unit: 'manual', automatic: false, note: 'No fixed amount is published. The Admin confirms it from use case and guest count.' },
  },
}

export const OFFICIAL_PAYMENT_INFORMATION: PaymentInformation = {
  active: true,
  methods: [
    { method: 'GCash', recipient_name: 'Agueda H.', account_identifier: '09258507707' },
    { method: 'BDO', recipient_name: 'Agueda Hortillas', account_identifier: '005438013682' },
  ],
  instructions: 'Send the non-refundable deposit/reservation fee through one of the listed payment channels. Settle the remaining full payment upon check-in. After sending payment, submit a screenshot or the Gmail confirmation/reference number for verification.',
  security_deposit_notes: 'The reservation fee is non-refundable. Its exact amount or percentage must be confirmed by the Admin before online booking can enforce it.',
  notes: 'Payment proof is reviewed by an Admin. Never share a password, PIN, OTP, API key, or banking credential.',
}
