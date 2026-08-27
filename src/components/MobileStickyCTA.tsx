import { Link, useLocation } from 'react-router-dom'
import { BUSINESS } from '../config/site'
import { Phone } from '../lib/icons'

export function MobileStickyCTA() {
  const location = useLocation()
  // Don't show over the booking or admin pages
  if (
    location.pathname.startsWith('/book') ||
    location.pathname.startsWith('/admin') ||
    location.pathname.startsWith('/app')
  ) return null

  return (
    <div className="lg:hidden fixed inset-x-0 bottom-0 z-30 pb-safe pointer-events-none">
      <div className="mx-4 mb-3 pointer-events-auto">
        <div className="rounded-2xl bg-forest-900/95 backdrop-blur border border-cream-100/10 shadow-soft flex items-center gap-2 p-2">
          <a
            href={`tel:${BUSINESS.contact.phone.replace(/\s+/g, '')}`}
            aria-label="Call the host"
            className="w-11 h-11 rounded-xl bg-cream-100/10 text-cream-100 flex items-center justify-center shrink-0"
          >
            <Phone size={18} />
          </a>
          <Link
            to="/book"
            className="flex-1 rounded-xl bg-cream-50 text-forest-900 h-11 flex items-center justify-center font-medium text-sm"
          >
            Check Availability
          </Link>
        </div>
      </div>
    </div>
  )
}
