import { describe, expect, it } from 'vitest'
import { validatePublishedRates, quoteAccommodation } from '../../src/lib/booking/rates'
import { paymentOptionsForTotal } from '../../src/lib/booking'
import { liveRates } from './zz-probe-live.test'

describe('PROBE 2: the exact payload the deployed build sends', () => {
  it('dumps the quote and the payment options', () => {
    const draft = {
      accommodation: 'main-house', check_in: '2026-11-06', check_out: '2026-11-07', guests: 2,
    }
    const P = quoteAccommodation(liveRates as never, 'main-house', draft as never)
    console.log('quoteAccommodation =>', JSON.stringify(P, null, 2))

    const T = paymentOptionsForTotal(P!.stayTotal, P!.rateCard)
    console.log('paymentOptionsForTotal =>', JSON.stringify(T, null, 2))
    const D = T.find((f) => f.plan === 'down-payment') ?? T.find((f) => f.plan === 'full')
    console.log('chosen plan =>', JSON.stringify(D, null, 2))
    console.log('security_deposit sent =>', JSON.stringify(P!.rateCard.securityDeposit))
    console.log('balance_due sent =>', JSON.stringify(Math.max(0, Math.round((P!.stayTotal - (D?.dueNow ?? 0)) * 100) / 100)))
    expect(true).toBe(true)
  })
})