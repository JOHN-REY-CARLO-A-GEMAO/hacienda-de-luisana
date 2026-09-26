import { BUSINESS, LISTINGS, OFFICIAL_CHANNELS } from '../config/site'
import { AlertCircle, ArrowRight } from '../lib/icons'

/**
 * The scam notice: the only places the Hacienda talks to guests or takes
 * money, and the two platform listings it vouches for. Shown wherever money
 * or contact details appear (the booking page, Contact), so a guest reading
 * either has the warning in view.
 *
 * `tone` follows the surface it sits on: 'light' on cream/white, 'dark' on
 * the forest-green panels.
 */
export function OfficialChannelsNotice({ tone = 'light', compact = false }: { tone?: 'light' | 'dark'; compact?: boolean }) {
  const dark = tone === 'dark'
  const tel = BUSINESS.contact.phone.replace(/\s+/g, '')

  return (
    <aside
      className={`rounded-2xl border px-5 py-4 text-xs leading-relaxed ${
        dark
          ? 'bg-forest-800/60 border-cream-100/15 text-cream-100/85'
          : 'bg-amber-50 border-amber-200 text-amber-950'
      }`}
      aria-label={OFFICIAL_CHANNELS.headline}
      data-testid="official-channels"
    >
      <div className={`flex items-center gap-2 font-medium ${dark ? 'text-cream-50' : 'text-amber-900'}`}>
        <AlertCircle size={15} className="shrink-0" />
        {OFFICIAL_CHANNELS.headline}
      </div>
      <p className="mt-1.5">{OFFICIAL_CHANNELS.body}</p>

      {!compact && (
        <ul className={`mt-3 grid sm:grid-cols-2 gap-x-6 gap-y-1 ${dark ? 'text-cream-50' : 'text-amber-950'}`}>
          <li>
            Phone: <a href={`tel:${tel}`} className="underline underline-offset-2">{BUSINESS.contact.phoneDisplay}</a>
          </li>
          <li>
            Email: <a href={`mailto:${BUSINESS.contact.email}`} className="underline underline-offset-2 break-all">{BUSINESS.contact.email}</a>
          </li>
          <li>
            Facebook:{' '}
            <a href={BUSINESS.contact.facebook} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              facebook.com/haciendadeluisiana
            </a>
          </li>
          <li>
            Listings:{' '}
            <a href={LISTINGS.airbnb.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">{LISTINGS.airbnb.label}</a>
            {' · '}
            <a href={LISTINGS.agoda.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">{LISTINGS.agoda.label}</a>
          </li>
        </ul>
      )}

      {compact && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <a href={LISTINGS.airbnb.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">
            Our Airbnb listing <ArrowRight size={11} />
          </a>
          <a href={LISTINGS.agoda.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">
            Our Agoda listing <ArrowRight size={11} />
          </a>
        </div>
      )}
    </aside>
  )
}
