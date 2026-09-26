import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Logo } from './Logo'
import { Menu, Close } from '../lib/icons'
import { useAuth } from '../hooks/useAuth'
import { canOpenPage, homeForRole } from '../lib/auth'

// Scene order of the homepage. `wide` links only show from the xl breakpoint
// so the floating bar never wraps on smaller laptops; the drawer lists all.
const LINKS: { href: string; label: string; wide?: boolean }[] = [
  { href: '/', label: 'Home' },
  { href: '/#stay', label: 'Stay' },
  { href: '/#experience', label: 'Experience' },
  { href: '/#gallery', label: 'Gallery', wide: true },
  { href: '/#rates', label: 'Rates' },
  { href: '/#location', label: 'Location' },
  { href: '/#reviews', label: 'Reviews' },
  { href: '/#faqs', label: 'FAQs', wide: true },
  { href: '/#contact', label: 'Contact' },
]
const DRAWER_LINKS = [...LINKS, { href: '/legal', label: 'Terms' }]

export function Nav() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const { user, role, logout } = useAuth()
  const transparent = location.pathname === '/' && !scrolled
  // Once the visitor scrolls (or leaves the homepage) the bar detaches into a
  // floating pill; at the top of the homepage it sits flush over the hero.
  const floating = !transparent

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    setOpen(false)
  }, [location.pathname, location.hash])

  return (
    <header className="fixed inset-x-0 top-0 z-40 pointer-events-none" data-nav={floating ? 'floating' : 'hero'}>
      <div
        className={`pointer-events-auto transition-all duration-500 ease-out-expo ${
          floating
            ? 'mx-3 mt-3 lg:mx-auto lg:max-w-6xl rounded-full bg-cream-50/90 backdrop-blur-xl border border-forest-900/10 shadow-float'
            : 'mx-auto max-w-7xl bg-transparent border border-transparent'
        }`}
      >
      <div className={`px-5 lg:px-8 flex items-center justify-between transition-all duration-500 ${floating ? 'h-14 lg:h-16 lg:px-6' : 'h-16 lg:h-20'}`}>
        <Link to="/" aria-label="Hacienda de LuisAna home">
          <Logo tone={transparent ? 'light' : 'dark'} />
        </Link>

        <nav className="hidden lg:flex items-center gap-6 xl:gap-7" aria-label="Site">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className={`${l.wide ? 'hidden xl:inline-flex' : 'inline-flex'} text-[13px] font-medium transition ${
                transparent ? 'text-cream-100 hover:text-white' : 'text-forest-800 hover:text-forest-950'
              }`}
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="hidden lg:flex items-center gap-2.5">
          {/* The Guest's own page; the Admin has no page on this website */}
          {user ? (
            <>
              <Link
                to={homeForRole(role)}
                className={`text-xs px-3 py-1.5 rounded-full border transition ${
                  transparent
                    ? 'border-cream-200/30 text-cream-100 hover:bg-cream-50/10'
                    : 'border-forest-900/10 text-forest-700 hover:bg-forest-50'
                }`}
                title={user.email ?? undefined}
              >
                {role === 'admin' ? 'Admin account' : 'My Bookings'}
              </Link>
              <button
                onClick={() => void logout()}
                className={`text-xs ${transparent ? 'text-cream-200 hover:text-white' : 'text-forest-600 hover:text-forest-900'}`}
              >
                Sign out
              </button>
            </>
          ) : (
            <Link
              to="/guest/auth"
              className={`text-xs px-3 py-1.5 rounded-full border transition ${
                transparent
                  ? 'border-cream-200/30 text-cream-100 hover:bg-cream-50/10'
                  : 'border-forest-900/10 text-forest-700 hover:bg-forest-50'
              }`}
            >
              Sign in
            </Link>
          )}

          <Link
            to="/book"
            data-tour="nav-book"
            className={
              transparent
                ? 'btn bg-cream-50 text-forest-900 hover:bg-white text-xs px-4 py-2 shadow-glow'
                : 'btn bg-forest-800 text-cream-50 hover:bg-forest-900 text-xs px-4 py-2 shadow-soft'
            }
          >
            Book Your Stay
          </Link>
        </div>

        <button
          className={`lg:hidden p-2 rounded-full transition ${
            transparent ? 'text-cream-50' : 'text-forest-900'
          }`}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <Close size={22} /> : <Menu size={22} />}
        </button>
      </div>
      </div>

      {/* Mobile drawer */}
      <div
        className={`lg:hidden pointer-events-auto overflow-hidden transition-[max-height] duration-500 ${
          open ? 'max-h-[85vh]' : 'max-h-0'
        } ${floating ? 'mx-3 mt-2 rounded-[28px] shadow-float border border-forest-900/10' : 'border-t border-forest-900/5'} bg-cream-50`}
      >
        <div className="px-6 py-6 flex flex-col gap-1 overflow-y-auto max-h-[calc(85vh-1px)]">
          {DRAWER_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-forest-900 py-2.5 border-b border-forest-900/5 text-base font-serif"
            >
              {l.label}
            </a>
          ))}

          <div className="mt-4 pt-2 space-y-2">
            <Link to="/book" className="btn-primary w-full text-xs">
              Book a Stay (/book)
            </Link>
            {canOpenPage(role, '/account') && (
              <Link to="/account" className="btn-ghost w-full text-xs">
                My Bookings (/account)
              </Link>
            )}
            <Link to="/legal" className="btn bg-cream-100 text-forest-800 w-full text-xs">
              Terms & policies
            </Link>
            {canOpenPage(role, '/messages') && (
              <Link to="/messages" className="btn-ghost w-full text-xs">
                Messages
              </Link>
            )}
          </div>

          {user ? (
            <button onClick={() => void logout()} className="text-xs text-forest-600 mt-3 text-center underline w-full">
              Sign out ({user.email})
            </button>
          ) : (
            <Link to="/guest/auth" className="btn-ghost w-full text-xs mt-3">
              Sign in / Create a Guest account
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}
