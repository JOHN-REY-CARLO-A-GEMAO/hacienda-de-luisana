import { Link, useLocation } from 'react-router-dom'
import { BUSINESS, LISTINGS } from '../config/site'
import { ariaCurrent, currentStateFor, type NavLink } from '../lib/nav-state'
import { Facebook, Instagram, Mail, Phone, MapPin } from '../lib/icons'

/**
 * A footer destination, marked the way the bar marks the same page.
 *
 * The footer is the only place /legal, /support and /house-rules appear on a
 * desktop screen, so it is the only place that can say "you are here" for them.
 * The rule is the shared one (`src/lib/nav-state.ts`), not a second opinion:
 * the current page takes `aria-current="page"` and its weight; a sibling does
 * not.
 */
function FooterLink({ link }: { link: NavLink }) {
  const { pathname } = useLocation()
  const state = currentStateFor(link, pathname)
  return (
    <Link
      to={link.href}
      aria-current={ariaCurrent(state)}
      className={`inline-flex min-h-11 items-center rounded-sm transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brass-400 ${state ? 'text-white' : ''}`}
    >
      {link.label}
    </Link>
  )
}

const EXPLORE_LINKS: NavLink[] = [
  { href: '/stay', label: 'Stay' },
  { href: '/rates', label: 'Rates & fees' },
  { href: '/experience', label: 'Experience' },
  { href: '/gallery', label: 'Gallery' },
  { href: '/location', label: 'Location' },
  { href: '/reviews', label: 'Reviews' },
]

const POLICY_LINKS: NavLink[] = [
  { href: '/faqs', label: 'FAQs' },
  { href: '/house-rules', label: 'House rules' },
  { href: '/legal', label: 'Terms & policies' },
  // The receipt reader is linked from here rather than the bar: it is a tool for
  // a Guest who is already paying, and it is the only place that says what the
  // app can read off a screenshot before one is submitted.
  { href: '/receipt-scan', label: 'Receipt reader' },
  { href: '/support', label: 'Support' },
  { href: '/contact', label: 'Contact' },
]

export function Footer() {
  return (
    <footer className="relative border-t border-cream-100/10 bg-forest-950 pb-8 pt-16 text-cream-100">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 sm:grid-cols-2 lg:grid-cols-4 lg:gap-12 lg:px-8">
        <div className="max-w-sm sm:col-span-2 lg:col-span-1">
          <div className="font-serif text-3xl">Hacienda de LuisAna</div>
          <p className="mt-3 leading-relaxed text-cream-200/80">{BUSINESS.positioning}</p>
          <div className="mt-6 flex gap-3">
            <a href={BUSINESS.contact.facebook} target="_blank" rel="noreferrer" className="flex h-11 w-11 items-center justify-center rounded-full border border-cream-100/20 transition hover:bg-cream-100/10" aria-label="Facebook">
              <Facebook size={18} />
            </a>
            <a href={BUSINESS.contact.instagram} target="_blank" rel="noreferrer" className="flex h-11 w-11 items-center justify-center rounded-full border border-cream-100/20 transition hover:bg-cream-100/10" aria-label="Instagram">
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
            {EXPLORE_LINKS.map((link) => (
              <li key={link.href}><FooterLink link={link} /></li>
            ))}
          </ul>
        </div>

        <div>
          <div className="eyebrow mb-4 text-cream-100/60">Plan &amp; policies</div>
          <ul className="space-y-3 text-sm">
            {POLICY_LINKS.map((link) => (
              <li key={link.href}><FooterLink link={link} /></li>
            ))}
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
