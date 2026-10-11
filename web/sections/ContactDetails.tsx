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
      label: 'Call / Message',
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
      label: 'Also on',
      value: `${LISTINGS.airbnb.label} · ${LISTINGS.agoda.label}`,
      href: LISTINGS.airbnb.url,
    },
  ]

  return (
    <div className="grid lg:grid-cols-2 gap-14 lg:gap-24 items-center">
      <div className="reveal">
        <div className="eyebrow">Contact</div>
        <h2 className="display text-4xl sm:text-5xl mt-4 text-forest-900">
          Talk to Your <br />
          <span className="italic font-light">Admin</span>
        </h2>
        <p className="mt-6 text-forest-800/75 leading-relaxed max-w-md">
          Have a question, planning a special gathering, or want to check dates? Send us a
          message — we usually reply within the day.
        </p>

        <div className="mt-10 flex flex-wrap gap-3">
          <a
            href={BUSINESS.contact.messenger}
            target="_blank"
            rel="noreferrer"
            className="btn bg-forest-800 text-cream-50 hover:bg-forest-900"
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

        <div className="mt-10">
          <OfficialChannelsNotice />
        </div>
      </div>

      <div className="reveal grid sm:grid-cols-2 gap-4">
        {cards.map((c) => (
          <a
            key={c.label}
            href={c.href}
            target={c.href.startsWith('http') ? '_blank' : undefined}
            rel="noreferrer"
            className="group bg-white border border-forest-900/5 rounded-2xl p-6 shadow-card hover:shadow-depth transition-all duration-500 ease-out-expo hover:-translate-y-1"
          >
            <div className="w-11 h-11 rounded-xl bg-forest-50 flex items-center justify-center text-forest-700 mb-4">
              <c.icon size={20} />
            </div>
            <div className="text-[11px] uppercase tracking-eyebrow text-forest-600">{c.label}</div>
            <div className="mt-1 font-serif text-lg text-forest-900 group-hover:underline underline-offset-4">
              {c.value}
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}