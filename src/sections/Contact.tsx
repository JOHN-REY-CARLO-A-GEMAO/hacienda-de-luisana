import { BUSINESS } from '../config/site'
import { Phone, Mail, Facebook, Messenger, MapPin, ArrowRight } from '../lib/icons'

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
      value: 'Chat with the host',
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
  ]

  return (
    <section id="contact" className="py-24 lg:py-36 bg-forest-900 text-cream-100">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-14 lg:gap-24 items-center">
          <div className="reveal">
            <div className="eyebrow text-cream-100/60">Contact</div>
            <h2 className="display text-4xl sm:text-5xl lg:text-6xl mt-4 text-cream-50">
              Talk to Your <br />
              <span className="italic font-light">Host</span>
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
          </div>

          <div className="reveal grid sm:grid-cols-2 gap-4">
            {cards.map((c) => (
              <a
                key={c.label}
                href={c.href}
                target={c.href.startsWith('http') ? '_blank' : undefined}
                rel="noreferrer"
                className="group bg-forest-800/50 hover:bg-forest-800 border border-cream-100/10 rounded-2xl p-6 transition"
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
