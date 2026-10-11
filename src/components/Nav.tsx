import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Logo } from './Logo'
import { Menu, Close, Sun, Moon } from '../lib/icons'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../context/ThemeContext'
import { canOpenPage, homeForRole } from '../lib/auth'

// The site's sections, as pages. Every entry is a real route: the homepage
// carries a preview of each and links here for the detail, so a `/#section`
// hash would land on a page that no longer holds that section. `wide` links
// only show from the xl breakpoint so the floating bar never wraps on smaller
// laptops; the drawer lists all of them.
export const LINKS: { href: string; label: string; wide?: boolean }[] = [
  { href: '/', label: 'Home' },
  { href: '/stay', label: 'Stay' },
  { href: '/experience', label: 'Experience' },
  { href: '/gallery', label: 'Gallery', wide: true },
  { href: '/rates', label: 'Rates' },
  { href: '/location', label: 'Location' },
  { href: '/reviews', label: 'Reviews' },
  { href: '/faqs', label: 'FAQs', wide: true },
  { href: '/contact', label: 'Contact' },
]
const DRAWER_LINKS = [...LINKS, { href: '/house-rules', label: 'House Rules' }, { href: '/legal', label: 'Terms' }]

export function Nav() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const { user, role, logout } = useAuth()
  const { isDark, toggleTheme } = useTheme()
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
            ? 'mx-2 sm:mx-3 mt-2 sm:mt-3 lg:mx-auto lg:max-w-6xl rounded-full bg-cream-50/90 dark:bg-forest-900/95 backdrop-blur-xl border border-forest-900/10 dark:border-cream-100/15 shadow-float'
            : 'mx-auto max-w-7xl bg-transparent border border-transparent'
        }`}
      >
      <div className={`px-3 sm:px-5 lg:px-6 flex items-center justify-between transition-all duration-500 ${floating ? 'h-14 lg:h-16' : 'h-16 lg:h-20'}`}>
        <Link to="/" aria-label="Hacienda de LuisAna home" className="flex-shrink-0">
          <Logo tone={transparent ? 'light' : isDark ? 'light' : 'dark'} />
        </Link>

        <nav className="hidden lg:flex items-center gap-3 xl:gap-5 2xl:gap-7 flex-shrink" aria-label="Site">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              to={l.href}
              className={`${l.wide ? 'hidden xl:inline-flex' : 'inline-flex'} text-[13px] font-medium whitespace-nowrap transition ${
                transparent ? 'text-cream-100 hover:text-white' : 'text-forest-800 dark:text-cream-100 hover:text-forest-950 dark:hover:text-white'
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden lg:flex items-center gap-2.5 flex-shrink-0">
          {/* Theme toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            className={`p-2 rounded-full transition flex items-center justify-center ${
              transparent
                ? 'text-cream-100 hover:text-white hover:bg-white/10'
                : 'text-forest-700 dark:text-cream-100 hover:text-forest-900 dark:hover:text-white hover:bg-forest-900/5 dark:hover:bg-cream-100/10'
            }`}
          >
            {isDark ? <Sun size={17} /> : <Moon size={17} />}
          </button>

          {/* The Guest's own page; the Admin has no page on this website */}
          {user ? (
            <>
              <Link
                to={homeForRole(role)}
                className={`text-xs px-3 py-1.5 rounded-full border whitespace-nowrap transition max-w-[140px] truncate ${
                  transparent
                    ? 'border-cream-200/30 text-cream-100 hover:bg-cream-50/10'
                    : 'border-forest-900/10 dark:border-cream-100/15 text-forest-700 dark:text-cream-200 hover:bg-forest-50 dark:hover:bg-forest-800'
                }`}
                title={user.email ?? undefined}
              >
                {role === 'admin' ? 'Admin account' : 'My Bookings'}
              </Link>
              <button
                onClick={() => void logout()}
                className={`text-xs whitespace-nowrap ${transparent ? 'text-cream-200 hover:text-white' : 'text-forest-600 dark:text-cream-200/70 hover:text-forest-900 dark:hover:text-white'}`}
              >
                Sign out
              </button>
            </>
          ) : (
            <Link
              to="/guest/auth"
              className={`text-xs px-3 py-1.5 rounded-full border whitespace-nowrap transition ${
                transparent
                  ? 'border-cream-200/30 text-cream-100 hover:bg-cream-50/10'
                  : 'border-forest-900/10 dark:border-cream-100/15 text-forest-700 dark:text-cream-200 hover:bg-forest-50 dark:hover:bg-forest-800'
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
                ? 'btn bg-cream-50 text-forest-900 hover:bg-white text-xs px-3.5 py-2 shadow-glow whitespace-nowrap'
                : 'btn bg-forest-800 text-cream-50 hover:bg-forest-900 dark:bg-cream-100 dark:text-forest-950 dark:hover:bg-white text-xs px-3.5 py-2 shadow-soft whitespace-nowrap'
            }
          >
            Book Your Stay
          </Link>
        </div>

        <div className="lg:hidden flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            className={`p-2 rounded-full transition ${
              transparent ? 'text-cream-50' : 'text-forest-900 dark:text-cream-50'
            }`}
          >
            {isDark ? <Sun size={19} /> : <Moon size={19} />}
          </button>
          <button
            className={`p-2 rounded-full transition flex-shrink-0 ${
              transparent ? 'text-cream-50' : 'text-forest-900 dark:text-cream-50'
            }`}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <Close size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>
      </div>

      {/* Mobile drawer */}
      <div
        className={`lg:hidden pointer-events-auto overflow-hidden transition-[max-height] duration-500 ${
          open ? 'max-h-[85vh]' : 'max-h-0'
        } ${floating ? 'mx-3 mt-2 rounded-[28px] shadow-float border border-forest-900/10 dark:border-cream-100/15' : 'border-t border-forest-900/5 dark:border-cream-100/10'} bg-cream-50 dark:bg-forest-950`}
      >
        <div className="px-6 py-6 flex flex-col gap-1 overflow-y-auto max-h-[calc(85vh-1px)]">
          {DRAWER_LINKS.map((l) => (
            <Link
              key={l.href}
              to={l.href}
              className="text-forest-900 dark:text-cream-50 py-2.5 border-b border-forest-900/5 dark:border-cream-100/10 text-base font-serif"
            >
              {l.label}
            </Link>
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
