import { Link } from 'react-router-dom'
import { BUSINESS } from '../config/site'
import { Facebook, Instagram, Mail, Phone, MapPin } from '../lib/icons'

export function Footer() {
  return (
    <footer className="bg-forest-950 text-cream-100 pt-20 pb-10">
      <div className="mx-auto max-w-7xl px-5 lg:px-8 grid gap-12 lg:grid-cols-4">
        <div className="lg:col-span-2 max-w-md">
          <div className="font-serif text-3xl mb-4">Hacienda de LuisAna</div>
          <p className="text-cream-200/80 leading-relaxed">
            {BUSINESS.positioning}
          </p>
          <div className="mt-6 flex gap-3">
            <a href={BUSINESS.contact.facebook} target="_blank" rel="noreferrer" className="p-2.5 rounded-full border border-cream-100/20 hover:bg-cream-100/10 transition" aria-label="Facebook">
              <Facebook size={18} />
            </a>
            <a href={BUSINESS.contact.instagram} target="_blank" rel="noreferrer" className="p-2.5 rounded-full border border-cream-100/20 hover:bg-cream-100/10 transition" aria-label="Instagram">
              <Instagram size={18} />
            </a>
          </div>
        </div>

        <div>
          <div className="eyebrow text-cream-100/60 mb-4">Explore</div>
          <ul className="space-y-3 text-sm">
            <li><a href="/#stay" className="hover:text-white">Stay</a></li>
            <li><a href="/#experience" className="hover:text-white">Experience</a></li>
            <li><a href="/#gallery" className="hover:text-white">Gallery</a></li>
            <li><a href="/#location" className="hover:text-white">Location</a></li>
            <li><a href="/#faqs" className="hover:text-white">FAQs</a></li>
            <li><Link to="/book" className="hover:text-white">Book Your Stay</Link></li>
          </ul>
        </div>

        <div>
          <div className="eyebrow text-cream-100/60 mb-4">Get in Touch</div>
          <ul className="space-y-3 text-sm">
            <li className="flex items-start gap-3">
              <MapPin size={16} className="mt-0.5 text-cream-100/60 shrink-0" />
              <span>{BUSINESS.address.formatted}</span>
            </li>
            <li className="flex items-start gap-3">
              <Phone size={16} className="mt-0.5 text-cream-100/60 shrink-0" />
              <a href={`tel:${BUSINESS.contact.phone.replace(/\s+/g, '')}`} className="hover:text-white">
                {BUSINESS.contact.phoneDisplay}
              </a>
            </li>
            <li className="flex items-start gap-3">
              <Mail size={16} className="mt-0.5 text-cream-100/60 shrink-0" />
              <a href={`mailto:${BUSINESS.contact.email}`} className="hover:text-white break-all">
                {BUSINESS.contact.email}
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-5 lg:px-8 mt-16 pt-8 border-t border-cream-100/10 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="text-xs text-cream-100/50">
          © {new Date().getFullYear()} Hacienda de LuisAna. Munting mansyon ng Luisiana.
        </div>
        <div className="text-xs text-cream-100/40">
          <Link to="/admin" className="hover:text-cream-100/80 transition">Admin</Link>
        </div>
      </div>
    </footer>
  )
}
