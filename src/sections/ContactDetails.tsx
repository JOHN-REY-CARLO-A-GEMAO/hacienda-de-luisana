import { BUSINESS, LISTINGS } from '../config/site'
import { Phone, Mail, Facebook, Messenger, MapPin, ArrowRight, House } from '../lib/icons'
import { OfficialChannelsNotice } from '../components/OfficialChannelsNotice'

/**
 * The Hacienda's contact channels, and the anti-scam notice that goes with them.
 *
 * These used to sit at the foot of the homepage inside a booking banner, which
 * made the last screen of the site a list of phone numbers rather than a
 * decision. They are the reason a visitor goes looking, though — a question, a
 * date to check, a special gathering — so they are a page of their own now,
 * behind /contact.
 *
 * `OfficialChannelsNotice` is deliberately part of this page and not a footnote:
 * it is the statement of which channels are real, and a page whose whole job is
 * contact details is exactly where someone looks for the fake ones.
 */
export function ContactDetails() {
  const tel = BUSINESS.contact.phone.replace(/\s+/g, '')

  const cards = [
    {
      icon: Phone,
      label: 'Call',
      value: BUSINESS.contact.phoneDisplay,
      href: `tel:${tel}`,
    },
    {
      icon: Messenger,
      label: 'Messenger',
      value: 'Chat with the Hacienda',
      href: BUSINESS.contact.messenger,
    },
    {
      icon: Facebook,
      label: 'Facebook',
      value: 'facebook.com/haciendadeluisiana',
      href: BUSINESS.contact.facebook,
    },
    {
      icon: Mail,
      label: 'Email',
      value: BUSINESS.contact.email,
      href: `mailto:${BUSINESS.contact.email}`,
    },
    {
      icon: MapPin,
      label: 'Google Maps',
      value: 'Open location',
      href: BUSINESS.contact.googleMaps,
    },
    {
      icon: House,
      label: 'Airbnb',
      value: 'View our Airbnb listing',
      href: LISTINGS.airbnb.url,
    },
    {
      icon: House,
      label: 'Agoda',
      value: 'View our Agoda listing',
      href: LISTINGS.agoda.url,
    },
  ]

  return (
    <div className="grid lg:grid-cols-2 gap-14 lg:gap-24 items-center">
      <div className="reveal">
        <div className="eyebrow">Contact</div>
        <h2 className="display text-4xl sm:text-5xl mt-4 text-forest-900 dark:text-cream-50">
          How to <br />
          <span className="italic font-normal">Reach Us</span>
        </h2>
        <p className="mt-6 text-forest-800/75 dark:text-cream-100/80 leading-relaxed max-w-md">
          Choose the contact method that works best for you, or use the official channels below
          to verify where you are booking.
        </p>

        <div className="mt-10 flex flex-wrap gap-3">
          <a
            href={BUSINESS.contact.messenger}
            target="_blank"
            rel="noreferrer"
            className="btn-primary"
          >
            Message Hacienda <ArrowRight size={16} />
          </a>
          <a
            href={BUSINESS.contact.directions}
            target="_blank"
            rel="noreferrer"
            className="btn-ghost"
          >
            Get Directions
          </a>
        </div>

        <p className="mt-4 max-w-md text-sm text-forest-700 dark:text-cream-100/75">
          Messenger and Google Maps open in a new tab. The map pin is approximate; confirm the exact
          location with the Hacienda before travelling.
        </p>

        <div className="mt-10">
          <OfficialChannelsNotice />
        </div>
      </div>

      <div className="reveal grid grid-cols-1 min-w-0 sm:grid-cols-2 gap-4">
        {cards.map((c) => (
          <a
            key={c.label}
            href={c.href}
            target={c.href.startsWith('http') ? '_blank' : undefined}
            rel="noreferrer"
            className="group min-w-0 bg-white border border-forest-900/5 rounded-2xl p-6 shadow-card hover:shadow-depth transition-all duration-500 ease-out-expo hover:-translate-y-1"
          >
            <div className="w-11 h-11 rounded-xl bg-forest-50 flex items-center justify-center text-forest-700 mb-4">
              <c.icon size={20} />
            </div>
            <div className="text-[11px] uppercase tracking-eyebrow text-forest-600">{c.label}</div>
            <div className="mt-1 min-w-0 break-words font-serif text-lg text-forest-900 group-hover:underline underline-offset-4">
              {c.value}
            </div>
            {c.href.startsWith('http') && (
              <div className="mt-2 text-xs text-forest-700">Opens in a new tab</div>
            )}
          </a>
        ))}
      </div>
    </div>
  )
}