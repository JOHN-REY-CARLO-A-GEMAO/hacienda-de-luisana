import { BUSINESS, LISTINGS } from '../config/site'
import { Phone, Mail, Facebook, Messenger, MapPin, ArrowRight, House } from '../lib/icons'
import { OfficialChannelsNotice } from '../components/OfficialChannelsNotice'
import { ParallaxImage } from '../components/ParallaxImage'
import { Link } from 'react-router-dom'

export function Contact() {
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
    <section id="contact" className="relative py-24 lg:py-36 bg-forest-900 text-cream-100 overflow-hidden">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        {/* Scene 09 — the booking call to action, over the Hacienda's own dusk photograph */}
        <div className="reveal relative rounded-[32px] overflow-hidden shadow-depth grain">
          <ParallaxImage
            src="/images/gmaps/img-13.jpg"
            alt="Campfire in front of the main house at blue hour"
            range={0.06}
            className="absolute inset-0 h-full"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-forest-950/90 via-forest-950/75 to-forest-950/50" />
          <div className="relative px-7 py-14 sm:px-12 sm:py-20 lg:px-20 lg:py-28 grid lg:grid-cols-12 gap-10 items-end">
            <div className="lg:col-span-8">
              <div className="flex items-center gap-4">
                <span className="scene-index text-cream-50/70" aria-hidden="true">09</span>
                <span className="h-px w-8 bg-cream-50/25" aria-hidden="true" />
                <span className="eyebrow text-cream-100/70">Book your stay</span>
              </div>
              <h2 className="display text-4xl sm:text-5xl lg:text-7xl mt-5 text-cream-50">
                Ready for the
                <br />
                <span className="italic font-light">quiet side?</span>
              </h2>
              <p className="mt-6 text-cream-100/80 leading-relaxed max-w-lg">
                Pick your dates and send a booking request. The Hacienda confirms availability and
                the final quote with you before anything is reserved.
              </p>
            </div>
            <div className="lg:col-span-4 flex flex-col sm:flex-row lg:flex-col gap-3 lg:items-stretch">
              <Link to="/book" className="btn bg-cream-50 text-forest-900 hover:bg-white shadow-glow text-base px-8 py-4">
                Check Availability <ArrowRight size={18} />
              </Link>
              <a href="#rates" className="btn bg-transparent text-cream-50 border border-cream-50/40 hover:bg-cream-50/10 px-8 py-4">
                See Rates &amp; Fees
              </a>
            </div>
          </div>
        </div>

        <div className="mt-20 lg:mt-28 grid lg:grid-cols-2 gap-14 lg:gap-24 items-center">
          <div className="reveal">
            <div className="eyebrow text-cream-100/60">Contact</div>
            <h2 className="display text-4xl sm:text-5xl lg:text-6xl mt-4 text-cream-50">
              Talk to Your <br />
              <span className="italic font-light">Admin</span>
            </h2>
            <p className="mt-6 text-cream-100/75 leading-relaxed max-w-md">
              Have a question, planning a special gathering, or want to check dates? Send us a
              message — we usually reply within the day.
            </p>

            <div className="mt-10 flex flex-wrap gap-3">
              <a href={BUSINESS.contact.messenger} target="_blank" rel="noreferrer" className="btn bg-cream-50 text-forest-900 hover:bg-white">
                Message Hacienda <ArrowRight size={16} />
              </a>
              <a href={BUSINESS.contact.directions} target="_blank" rel="noreferrer" className="btn bg-transparent text-cream-50 border border-cream-50/30 hover:bg-cream-50/10">
                Get Directions
              </a>
            </div>

            <div className="mt-10">
              <OfficialChannelsNotice tone="dark" />
            </div>
          </div>

          <div className="reveal grid sm:grid-cols-2 gap-4">
            {cards.map((c) => (
              <a
                key={c.label}
                href={c.href}
                target={c.href.startsWith('http') ? '_blank' : undefined}
                rel="noreferrer"
                className="group bg-forest-800/50 hover:bg-forest-800 border border-cream-100/10 rounded-2xl p-6 transition-all duration-500 ease-out-expo hover:-translate-y-1 hover:shadow-float"
              >
                <div className="w-11 h-11 rounded-xl bg-cream-100/10 flex items-center justify-center text-cream-100 mb-4">
                  <c.icon size={20} />
                </div>
                <div className="text-[11px] uppercase tracking-eyebrow text-cream-100/60">{c.label}</div>
                <div className="mt-1 font-serif text-lg text-cream-50 group-hover:underline underline-offset-4">
                  {c.value}
                </div>
              </a>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
