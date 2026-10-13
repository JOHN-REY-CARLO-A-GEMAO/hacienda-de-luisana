import { describe, expect, it } from 'vitest'
import { validatePublishedRates, quoteAccommodation } from '../../src/lib/booking/rates'
import { paymentOptionsForTotal } from '../../src/lib/booking'
import { liveRates } from './zz-probe-live.test'

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compileRules, type Store } from '../rules/engine'
import { request } from '../rules/context'

const rules = readFileSync(join(__dirname, '../../firestore.rules'), 'utf8')
const decideRules = compileRules(rules)

describe('PROBE 2: the exact payload the deployed build sends', () => {
  it('evaluates firestore.rules against the exact failing payload from the prompt', () => {
    const auth = {
      uid: 'fCrl2iddjFh1a3UAD9EtGuHv5WB2',
      token: { email: 'j23245164@gmail.com', firebase: { sign_in_provider: 'password' } },
    }

    const store: Store = {
      'profiles/fCrl2iddjFh1a3UAD9EtGuHv5WB2': { uid: 'fCrl2iddjFh1a3UAD9EtGuHv5WB2', role: 'guest' },
      'site_config/booking': { minimumBookingLeadTimeDays: 30 },
      'site_config/rates': {
        version: 'v1-guest-v3',
        effective_date: '2026-10-05',
        holiday_dates: [],
        accommodations: {
          'main-house': {
            property_name: 'The Main House',
            rate_unit: 'standard_stay',
            active: true,
            security_deposit: 2000,
            down_payment_percent: 50,
            available_units: 1,
            guest_pricing: {
              units_per_booking: 1,
              weekday: { min_guests: 1, base_max_guests: 10, base_rate: 5000, excess_per_guest: 500 },
              weekend_holiday: { min_guests: 1, base_max_guests: 10, base_rate: 6000, excess_per_guest: 500 },
            },
          },
          'house-a-camping': {
            property_name: 'A-House',
            rate_unit: 'standard_stay',
            active: true,
            security_deposit: 1000,
            down_payment_percent: 50,
            available_units: 1,
            guest_pricing: {
              units_per_booking: 1,
              weekday: { min_guests: 1, base_max_guests: 3, max_guests: 3, base_rate: 1000 },
              weekend_holiday: { min_guests: 1, base_max_guests: 3, max_guests: 3, base_rate: 1000 },
            },
          },
          'annex': {
            property_name: 'HDL Annex',
            rate_unit: 'standard_stay',
            active: true,
            security_deposit: 0,
            down_payment_percent: 50,
            available_units: 1,
            guest_pricing: {
              units_per_booking: 1,
              weekday: { min_guests: 1, base_max_guests: 6, base_rate: 4000, excess_per_guest: 500 },
              weekend_holiday: { min_guests: 1, base_max_guests: 6, base_rate: 5000, excess_per_guest: 500 },
            },
          },
        },
        refund: {
          deposit_refund_percent: 100,
          tiers: [
            { min_days_before_check_in: 30, refund_percent: 100 },
            { min_days_before_check_in: 14, refund_percent: 50 },
            { min_days_before_check_in: 7, refund_percent: 25 },
          ],
        },
      },
    }

    const payload = {
      guest_name: 'John',
      phone: '09304857798',
      email: 'j23245164@gmail.com',
      check_in: '2026-11-14',
      check_out: '2026-11-15',
      guests: 2,
      accommodation: 'main-house',
      special_requests: '',
      uid: 'fCrl2iddjFh1a3UAD9EtGuHv5WB2',
      payment_proof_url: 'payments/fCrl2iddjFh1a3UAD9EtGuHv5WB2/HDL-7560/proof-1.jpeg',
      paymentProofUrl: 'payments/fCrl2iddjFh1a3UAD9EtGuHv5WB2/HDL-7560/proof-1.jpeg',
      payment_plan: 'down-payment',
      payment_status: 'pending',
      amount_claimed: 3000,
      payment_reference: '8159662488150',
      nights: 1,
      stay_total: 6000,
      amount_due: 3000,
      security_deposit: 2000,
      balance_due: 3000,
      rate_amount: 6000,
      rate_unit: 'standard_stay',
      rate_classification: 'weekend_holiday',
      policy_version: 'v1-guest-v3',
      policy_effective_date: '2026-10-05',
      refund_policy_snapshot: {
        deposit_refund_percent: 100,
        tiers: [
          { min_days_before_check_in: 30, refund_percent: 100 },
          { min_days_before_check_in: 14, refund_percent: 50 },
          { min_days_before_check_in: 7, refund_percent: 25 },
        ],
      },
      source: 'web',
      hold_expires_at: '2026-10-14T21:23:22.431Z',
      status: 'Pending',
      created_at: '2026-10-14T21:23:22.431Z',
    }

    const evalResult = decideRules(
      request({
        path: 'bookings/HDL-7560',
        method: 'create',
        auth,
        requestData: payload,
        time: Date.parse('2026-10-14T21:23:22.431Z'),
      }),
      { store },
    )

    console.log('EVAL RESULT:', JSON.stringify(evalResult, null, 2))
    expect(evalResult.allow).toBe(true)
  })
})