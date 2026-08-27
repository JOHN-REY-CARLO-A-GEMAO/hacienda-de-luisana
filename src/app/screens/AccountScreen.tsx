import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BUSINESS, FAQS } from '../../config/site'
import { Chevron, Clock, Facebook, Instagram, Mail, MapPin, Messenger, Paw, Phone } from '../../lib/icons'
import { isNativeApp } from '../../lib/native'
import { Screen, ScreenTitle } from '../components/Screen'
import { QuickActions } from '../components/QuickActions'
import { telHref } from '../share'

export function AccountScreen() {
  const [open, setOpen] = useState<number | null>(0)
  const tel = telHref()

  return (
    <Screen>
      <ScreenTitle eyebrow="Account" title="Host & stay info" />

      <div className="rounded-[22px] bg-forest-900 text-cream-100 p-5">
        <div className="text-[10px] uppercase tracking-eyebrow text-cream-100/60">Your host</div>
        <div className="font-serif text-2xl mt-1">{BUSINESS.name}</div>
        <p className="mt-2 text-sm text-cream-100/75 leading-relaxed">{BUSINESS.tagline}</p>
        <a href={tel} className="mt-4 inline-flex items-center gap-2 text-sm text-cream-50">
          <Phone size={15} /> {BUSINESS.contact.phoneDisplay}
        </a>
      </div>

      <div className="mt-4">
        <QuickActions />
      </div>

      <section className="mt-6 rounded-[22px] bg-white border border-forest-900/5 p-4">
        <div className="eyebrow">House policies</div>
        <ul className="mt-3 space-y-3 text-sm text-forest-800">
          <li className="flex items-start gap-3">
            <Clock size={16} className="mt-0.5 text-forest-600 shrink-0" />
            <span>
              Check-in {BUSINESS.policies.checkIn}
              {BUSINESS.policies.checkInPlaceholder ? ' (confirm with host)' : ''}
            </span>
          </li>
          <li className="flex items-start gap-3">
            <Clock size={16} className="mt-0.5 text-forest-600 shrink-0" />
            <span>
              Check-out {BUSINESS.policies.checkOut}
              {BUSINESS.policies.checkOutPlaceholder ? ' (confirm with host)' : ''}
            </span>
          </li>
          <li className="flex items-start gap-3">
            <Paw size={16} className="mt-0.5 text-forest-600 shrink-0" />
            <span>{BUSINESS.policies.petFriendly ? 'Pets welcome' : 'No pets'} · subject to house rules</span>
          </li>
        </ul>
      </section>

      <section className="mt-6">
        <div className="eyebrow mb-1">My bookings</div>
        <div className="rounded-[22px] border border-dashed border-forest-900/15 bg-white/60 p-5 text-center">
          <div className="font-serif text-xl text-forest-900">Coming next</div>
          <p className="mt-2 text-sm text-forest-800/75 leading-relaxed">
            Sign in to track your inquiries (Pending / Confirmed) on this phone. For now, send a
            request from Book or message the host.
          </p>
          <Link to="/app/book" className="btn-primary mt-4 h-10 px-5 text-sm">
            Book a stay
          </Link>
        </div>
      </section>

      <section className="mt-6">
        <div className="eyebrow">FAQs</div>
        <div className="mt-2 divide-y divide-forest-900/10 border-t border-b border-forest-900/10">
          {FAQS.map((f, i) => {
            const isOpen = open === i
            return (
              <div key={f.q}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="w-full flex items-start justify-between gap-3 text-left py-3.5"
                  aria-expanded={isOpen}
                >
                  <span className="font-serif text-base text-forest-900 pr-1">{f.q}</span>
                  <Chevron
                    size={18}
                    className={`text-forest-600 mt-0.5 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                <div
                  className={`grid transition-all duration-300 ${
                    isOpen ? 'grid-rows-[1fr] opacity-100 pb-3.5' : 'grid-rows-[0fr] opacity-0'
                  }`}
                >
                  <div className="overflow-hidden">
                    <p className="text-sm text-forest-800/80 leading-relaxed">{f.a}</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="mt-6 grid grid-cols-2 gap-2">
        <a
          href={BUSINESS.contact.facebook}
          target="_blank"
          rel="noreferrer"
          className="rounded-2xl bg-white border border-forest-900/5 p-3 text-sm text-forest-800 inline-flex items-center gap-2"
        >
          <Facebook size={16} /> Facebook
        </a>
        <a
          href={BUSINESS.contact.instagram}
          target="_blank"
          rel="noreferrer"
          className="rounded-2xl bg-white border border-forest-900/5 p-3 text-sm text-forest-800 inline-flex items-center gap-2"
        >
          <Instagram size={16} /> Instagram
        </a>
        <a
          href={`mailto:${BUSINESS.contact.email}`}
          className="rounded-2xl bg-white border border-forest-900/5 p-3 text-sm text-forest-800 inline-flex items-center gap-2"
        >
          <Mail size={16} /> Email
        </a>
        <a
          href={BUSINESS.contact.googleMaps}
          target="_blank"
          rel="noreferrer"
          className="rounded-2xl bg-white border border-forest-900/5 p-3 text-sm text-forest-800 inline-flex items-center gap-2"
        >
          <MapPin size={16} /> Maps
        </a>
        <a
          href={BUSINESS.contact.messenger}
          target="_blank"
          rel="noreferrer"
          className="col-span-2 rounded-2xl bg-white border border-forest-900/5 p-3 text-sm text-forest-800 inline-flex items-center gap-2"
        >
          <Messenger size={16} /> Messenger
        </a>
      </section>

      {!isNativeApp ? (
        <p className="mt-6 text-center text-xs text-forest-600">
          <Link to="/" className="underline underline-offset-4">
            View full website
          </Link>
        </p>
      ) : null}
    </Screen>
  )
}
