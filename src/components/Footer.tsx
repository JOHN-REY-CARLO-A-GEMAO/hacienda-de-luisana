import { Link } from 'react-router-dom'
import { BUSINESS, LISTINGS } from '../config/site'
import { Facebook, Instagram, Mail, Phone, MapPin } from '../lib/icons'

export function Footer() {
  return (
    <footer className="relative border-t border-cream-100/10 bg-forest-950 pb-8 pt-16 text-cream-100">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 sm:grid-cols-2 lg:grid-cols-4 lg:gap-12 lg:px-8">
        <div className="max-w-sm sm:col-span-2 lg:col-span-1">
          <div className="font-serif text-3xl">Hacienda de LuisAna</div>
          <p className="mt-3 leading-relaxed text-cream-200/80">{BUSINESS.positioning}</p>
          <div className="mt-6 flex gap-3">
            <a href={BUSINESS.contact.facebook} target="_blank" rel="noreferrer" className="rounded-full border border-cream-100/20 p-2.5 transition hover:bg-cream-100/10" aria-label="Facebook">
              <Facebook size={18} />
            </a>
            <a href={BUSINESS.contact.instagram} target="_blank" rel="noreferrer" className="rounded-full border border-cream-100/20 p-2.5 transition hover:bg-cream-100/10" aria-label="Instagram">
              <Instagram size={18} />
            </a>
          </div>
          <div className="mt-5 text-xs text-cream-200/70">
            Also on{' '}
            <a href={LISTINGS.airbnb.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-white">{LISTINGS.airbnb.label}</a>
            {' and '}
            <a href={LISTINGS.agoda.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-white">{LISTINGS.agoda.label}</a>
            . These, this website, and the contacts below are our only official channels.
          </div>
        </div>

        <div>
          <div className="eyebrow mb-4 text-cream-100/60">Explore</div>
          <ul className="space-y-3 text-sm">
            <li><Link to="/stay" className="hover:text-white">Stay</Link></li>
            <li><Link to="/rates" className="hover:text-white">Rates &amp; fees</Link></li>
            <li><Link to="/experience" className="hover:text-white">Experience</Link></li>
            <li><Link to="/gallery" className="hover:text-white">Gallery</Link></li>
            <li><Link to="/location" className="hover:text-white">Location</Link></li>
            <li><Link to="/reviews" className="hover:text-white">Reviews</Link></li>
          </ul>
        </div>

        <div>
          <div className="eyebrow mb-4 text-cream-100/60">Plan &amp; policies</div>
          <ul className="space-y-3 text-sm">
            <li><Link to="/faqs" className="hover:text-white">FAQs</Link></li>
            <li><Link to="/house-rules" className="hover:text-white">House rules</Link></li>
            <li><Link to="/legal" className="hover:text-white">Terms &amp; policies</Link></li>
            <li><Link to="/support" className="hover:text-white">Support &amp; disputes</Link></li>
            <li><Link to="/contact" className="hover:text-white">Contact</Link></li>
          </ul>
        </div>

        <div>
          <div className="eyebrow mb-4 text-cream-100/60">Get in touch</div>
          <ul className="space-y-3 text-sm">
            <li className="flex items-start gap-3">
              <MapPin size={16} className="mt-0.5 shrink-0 text-cream-100/60" />
              <span>{BUSINESS.address.formatted}</span>
            </li>
            <li className="flex items-start gap-3">
              <Phone size={16} className="mt-0.5 shrink-0 text-cream-100/60" />
              <a href={`tel:${BUSINESS.contact.phone.replace(/\s+/g, '')}`} className="hover:text-white">
                {BUSINESS.contact.phoneDisplay}
              </a>
            </li>
            <li className="flex items-start gap-3">
              <Mail size={16} className="mt-0.5 shrink-0 text-cream-100/60" />
              <a href={`mailto:${BUSINESS.contact.email}`} className="break-all hover:text-white">
                {BUSINESS.contact.email}
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="mx-auto mt-12 flex max-w-7xl flex-col items-center justify-between gap-4 border-t border-cream-100/10 px-5 pt-6 md:flex-row lg:px-8">
        <div className="text-xs text-cream-100/50">
          © {new Date().getFullYear()} Hacienda de LuisAna. Munting mansyon ng Luisiana.
        </div>
      </div>
    </footer>
  )
}
