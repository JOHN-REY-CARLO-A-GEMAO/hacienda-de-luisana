import { BUSINESS } from '../config/site'

export const telHref = () => `tel:${BUSINESS.contact.phone.replace(/\s+/g, '')}`

export async function shareHacienda(): Promise<'shared' | 'copied' | 'cancelled'> {
  const url = typeof window !== 'undefined' ? window.location.origin : 'https://haciendadeluisana.com'
  const payload = {
    title: BUSINESS.name,
    text: `${BUSINESS.tagline} — a private countryside escape in Luisiana, Laguna.`,
    url,
  }
  try {
    if (typeof navigator !== 'undefined' && navigator.share) {
      await navigator.share(payload)
      return 'shared'
    }
  } catch {
    return 'cancelled'
  }
  try {
    await navigator.clipboard.writeText(url)
    return 'copied'
  } catch {
    return 'cancelled'
  }
}
