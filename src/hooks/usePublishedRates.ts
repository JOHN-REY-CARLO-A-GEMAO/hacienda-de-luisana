import { useEffect, useState } from 'react'
import { ratesDB } from '../lib/ratesDB'
import type { PublishedRates } from '../lib/booking'

/**
 * The Admin's Published rates (`site_config/rates`), live, or null while
 * nothing is published. The same subscription PaymentStep uses to quote a
 * plan; the public pages use it so a nightly rate, Security deposit or
 * down-payment percentage shown to a visitor is the figure the Admin actually
 * published — never a number typed into page copy.
 */
export function usePublishedRates(): PublishedRates | null {
  const [rates, setRates] = useState<PublishedRates | null>(null)
  useEffect(() => ratesDB.subscribe(setRates), [])
  return rates
}
