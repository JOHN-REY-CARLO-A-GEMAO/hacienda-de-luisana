import { useEffect, useState } from 'react'
import { ratesDB } from '../lib/ratesDB'
import type { PublishedRates } from '../lib/booking'

/**
 * The Admin's Published rates (`site_config/rates`), live, or null while
 * nothing valid is published. The public pages use the per-stay guest schedule,
 * Security deposit and 50% down-payment figure from the Admin — never a number
 * typed into page copy.
 */
export function usePublishedRates(): PublishedRates | null {
  const [rates, setRates] = useState<PublishedRates | null>(null)
  useEffect(() => ratesDB.subscribe(setRates), [])
  return rates
}
