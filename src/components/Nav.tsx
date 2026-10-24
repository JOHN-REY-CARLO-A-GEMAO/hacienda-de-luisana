import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Logo } from './Logo'
import { Menu, Close, Bell } from '../lib/icons'
import { useAuth } from '../hooks/useAuth'
import { useNotifications } from '../hooks/useNotifications'
import { canOpenPage, homeForRole } from '../lib/auth'
import { ariaCurrent, currentStateFor, type NavLink } from '../lib/nav-state'

/**
 * The seven visitor destinations, in the order a first-time Guest needs them.
 *
 * Every entry is a real route and every one is visible in the desktop bar —
 * there is no "More" menu and no dropdown. Two of the labels stand for a pair
 * of pages that answer the same question, and `also` is how the bar knows to
 * keep them marked as the current section: "Stay" covers /stay and /rates,
 * while "Contact" also covers /faqs. The detail pages keep their own addresses
 * and are linked from their related page and the footer, so
 * no bookmark or shared link stops working.
 *
 * "In this section" and "this page" are different claims, and the bar says
 * which is which. `aria-current="page"` belongs on the link that *is* the page
 * being read; /rates is not /stay, so "Stay" carries `aria-current="true"`
 * there — same underline, honest announcement. Everything else (Home, Gallery,
 * the phone drawer's own secondary links) is an exact match and gets "page".
 */
export const LINKS: NavLink[] = [
  { href: '/', label: 'Home' },
  { href: '/stay', label: 'Stay', also: ['/rates'] },
  { href: '/experience', label: 'Experience' },
  { href: '/gallery', label: 'Gallery' },
  { href: '/location', label: 'Location' },
  { href: '/reviews', label: 'Reviews' },
  { href: '/contact', label: 'Contact', also: ['/faqs'] },
]

/** Pages that are linked from a page or the footer rather than the bar. */
export const SECONDARY_LINKS: NavLink[] = [
  { href: '/support', label: 'Support' },
  { href: '/house-rules', label: 'House rules' },
  { href: '/legal', label: 'Terms & policies' },
]

export type { NavLink }

const FOCUS_RING =
  'rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-current'

export function Nav() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement | null>(null)
  const location = useLocation()
  const { user, profile, role, logout } = useAuth()
  const { unreadCount, signedIn } = useNotifications()
  const initial = (
    profile?.first_name?.trim()?.[0] ??
    profile?.display_name?.trim()?.[0] ??
    user?.email?.trim()?.[0] ??
    'G'
  ).toUpperCase()
  const unreadLabel = unreadCount > 9 ? '9+' : String(unreadCount)
  // The bell in the bar and the drawer's own Notifications row are the same
  // destination: `/account?tab=notifications`. Derived from the location the
  // header already reads, rather than a second router hook.
  const onNotifications =
    location.pathname === '/account' &&
    new URLSearchParams(location.search).get('tab') === 'notifications'
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

  // Navigating — by link, browser back, or a hash — closes the drawer. The
  // drawer's own links also close it directly, which covers Home while already
  // on Home, where the pathname does not change.
  useEffect(() => {
    setOpen(false)
  }, [location.pathname, location.hash])

  // Escape closes the drawer and returns focus to the control that opened it.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      menuButton.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  // Separate size/colour classes rather than overrides: two utilities for the
  // same property on one element are resolved by stylesheet order, not by the
  // order they are written here.
  const drawerRow = `block border-b border-forest-900/5 dark:border-cream-100/10 ${FOCUS_RING}`

  return (
    <header
      className="fixed inset-x-0 top-0 z-40 pointer-events-none"
      data-nav={floating ? 'floating' : 'hero'}
    >
      <div
        className={`pointer-events-auto transition-all duration-500 ease-out-expo ${
          floating
            ? 'mx-2 sm:mx-3 mt-2 sm:mt-3 lg:mx-auto lg:w-[calc(100%_-_1.5rem)] lg:max-w-5xl xl:max-w-7xl rounded-full bg-cream-50/90 dark:bg-forest-900/95 backdrop-blur-xl border border-forest-900/10 dark:border-cream-100/15 shadow-float'
            : 'mx-auto max-w-7xl bg-transparent border border-transparent'
        }`}
      >
        <div
          className={`px-2.5 min-[360px]:px-3 sm:px-5 lg:px-6 flex items-center justify-between gap-1.5 min-[360px]:gap-2 transition-all duration-500 ${
            floating ? 'h-14 lg:h-16' : 'h-16 lg:h-20'
          }`}
        >
          <Link
            to="/"
            aria-label="Hacienda de LuisAna home"
            className={`min-w-0 ${FOCUS_RING}`}
          >
            <Logo tone={transparent ? 'light' : 'dark'} />
          </Link>

          <nav
            className="hidden xl:flex items-center gap-3 2xl:gap-4 min-w-0"
            aria-label="Site"
          >
            {LINKS.map((l) => {
              const state = currentStateFor(l, location.pathname)
              const current = state !== null
              return (
                <Link
                  key={l.href}
                  to={l.href}
                  aria-current={ariaCurrent(state)}
                  className={`relative inline-flex items-center whitespace-nowrap py-2 text-[12.5px] 2xl:text-[13px] font-medium leading-none transition-colors ${FOCUS_RING} ${
                    transparent
                      ? current
                        ? 'text-white'
                        : 'text-cream-100/90 hover:text-white'
                      : current
                        ? 'text-forest-950 dark:text-white'
                        : 'text-forest-800/90 dark:text-cream-100/90 hover:text-forest-950 dark:hover:text-white'
                  }`}
                >
                  {l.label}
                  <span
                    aria-hidden="true"
                    className={`absolute inset-x-0 -bottom-0.5 h-px origin-left transition-transform duration-300 ${
                      current ? 'scale-x-100' : 'scale-x-0'
                    } ${transparent ? 'bg-cream-50/80' : 'bg-forest-700/70 dark:bg-cream-100/70'}`}
                  />
                </Link>
              )
            })}
          </nav>

          <div className="hidden xl:flex items-center gap-2 2xl:gap-2.5 flex-shrink-0">
            {/* The Guest's own page; the Admin has no page on this website */}
            {user ? (
              <>
                {/* One bordered group for the Guest's own side of the site: the
                    bell and their identity sit together because they are the
                    same thing — what is waiting for them — and the bar's public
                    destinations stay visually separate from it. */}
                <div
                  className={`flex items-center gap-0.5 rounded-full border py-0.5 pl-0.5 pr-1 transition-colors ${
                    transparent
                      ? 'border-cream-200/25 bg-forest-950/25'
                      : 'border-forest-900/10 bg-white/60 dark:border-cream-100/15 dark:bg-forest-900/50'
                  }`}
                >
                  {signedIn && role !== 'admin' && (
                    <Link
                      to="/account?tab=notifications"
                      aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
                      title="Notifications"
                      className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition ${FOCUS_RING} ${
                        transparent
                          ? 'text-cream-100 hover:bg-white/10 hover:text-white'
                          : 'text-forest-700 hover:bg-forest-900/5 hover:text-forest-900 dark:text-cream-100 dark:hover:bg-cream-100/10 dark:hover:text-white'
                      }`}
                    >
                      <Bell size={16} />
                      {unreadCount > 0 && (
                        <span
                          className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-center text-[11px] font-bold leading-none text-white"
                          aria-hidden="true"
                        >
                          {unreadLabel}
                        </span>
                      )}
                    </Link>
                  )}
                  {/* One account control, not two: the avatar *is* the link to the
                      Guest's own page. The separate "My Bookings" pill this used to
                      sit beside said the same thing a few pixels apart. */}
                  <Link
                    to={homeForRole(role)}
                    aria-label={role === 'admin' ? 'Admin account' : 'My bookings and profile'}
                    className={`inline-flex h-7 shrink-0 items-center gap-2 rounded-full px-1 pr-2.5 text-xs whitespace-nowrap transition ${FOCUS_RING} ${
                      transparent
                        ? 'text-cream-100 hover:bg-cream-50/10'
                        : 'text-forest-700 hover:bg-forest-900/5 dark:text-cream-200 dark:hover:bg-cream-100/10'
                    }`}
                    title={user.email ?? undefined}
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                        transparent ? 'bg-cream-50/20 text-cream-50' : 'bg-forest-800 text-cream-50 dark:bg-cream-100 dark:text-forest-950'
                      }`}
                      aria-hidden="true"
                    >
                      {initial}
                    </span>
                    <span
                      className="hidden max-w-[7.5rem] truncate xl:inline"
                      title={profile?.first_name?.trim() || undefined}
                    >
                      {role === 'admin'
                        ? 'Admin account'
                        : profile?.first_name?.trim() || 'My bookings'}
                    </span>
                  </Link>
                </div>
                <button
                  onClick={() => void logout()}
                  className={`text-xs whitespace-nowrap shrink-0 ${FOCUS_RING} ${
                    transparent
                      ? 'text-cream-200 hover:text-white'
                      : 'text-forest-600 dark:text-cream-200/70 hover:text-forest-900 dark:hover:text-white'
                  }`}
                >
                  Sign out
                </button>
              </>
            ) : (
              <Link
                to="/guest/auth"
                className={`inline-flex items-center h-8 text-xs px-3 rounded-full border whitespace-nowrap transition shrink-0 ${FOCUS_RING} ${
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
                  ? 'btn btn-sm bg-cream-50 text-forest-900 hover:bg-white shadow-glow whitespace-nowrap shrink-0'
                  : 'btn btn-sm bg-forest-800 text-cream-50 hover:bg-forest-900 dark:bg-cream-100 dark:text-forest-950 dark:hover:bg-white shadow-soft whitespace-nowrap shrink-0'
              }
            >
              Book Your Stay
            </Link>
          </div>

          {/* Mobile / tablet: logo | Book Now | Menu. The booking action stays
              in the header rather than behind the menu. */}
          <div className="xl:hidden flex items-center gap-1.5 min-[360px]:gap-2 flex-shrink-0">
            <Link
              to="/book"
              aria-label="Book your stay"
              className={`btn btn-sm h-10 whitespace-nowrap min-[360px]:px-3.5 sm:px-4 ${
                transparent
                  ? 'bg-cream-50 text-forest-900 hover:bg-white'
                  : 'bg-forest-800 text-cream-50 hover:bg-forest-900 dark:bg-cream-100 dark:text-forest-950 dark:hover:bg-white'
              }`}
            >
              <span className="sm:hidden">Book</span>
              <span className="hidden sm:inline">Book Now</span>
            </Link>
            <button
              ref={menuButton}
              type="button"
              className={`w-9 h-9 min-[360px]:w-10 min-[360px]:h-10 rounded-full transition flex items-center justify-center flex-shrink-0 ${FOCUS_RING} ${
                transparent ? 'text-cream-50 hover:bg-white/10' : 'text-forest-900 dark:text-cream-50 hover:bg-forest-900/5 dark:hover:bg-cream-100/10'
              }`}
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
              aria-controls="mobile-nav"
              onClick={() => setOpen((v) => !v)}
            >
              {open ? <Close size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile drawer — a conventional disclosure menu, not a desktop dropdown */}
      <div
        id="mobile-nav"
        aria-hidden={!open}
        className={`xl:hidden pointer-events-auto overflow-y-auto overscroll-contain transition-[max-height] duration-500 ${
          open ? 'max-h-[85vh] visible' : 'max-h-0 invisible overflow-hidden'
        } ${
          floating
            ? 'mx-3 mt-2 rounded-[28px] shadow-float border border-forest-900/10 dark:border-cream-100/15'
            : 'border-t border-forest-900/5 dark:border-cream-100/10'
        } bg-cream-50 dark:bg-forest-950`}
      >
        <div className="px-5 sm:px-6 pt-4 pb-6 flex flex-col gap-0.5">
          <nav aria-label="Mobile" className="flex flex-col">
            {LINKS.map((l) => {
              const state = currentStateFor(l, location.pathname)
              const current = state !== null
              return (
                <Link
                  key={l.href}
                  to={l.href}
                  onClick={() => setOpen(false)}
                  aria-current={ariaCurrent(state)}
                  className={`${drawerRow} py-3 text-base font-serif ${
                    current ? 'font-medium text-forest-950 dark:text-white' : 'text-forest-900 dark:text-cream-50'
                  }`}
                >
                  {l.label}
                </Link>
              )
            })}
          </nav>

          <div className="mt-4 pt-2">
            <div className="eyebrow mb-1">Also at the Hacienda</div>
            {SECONDARY_LINKS.map((l) => {
              const state = currentStateFor(l, location.pathname)
              return (
                <Link
                  key={l.href}
                  to={l.href}
                  onClick={() => setOpen(false)}
                  aria-current={ariaCurrent(state)}
                  className={`${drawerRow} py-2.5 text-sm ${
                    state ? 'font-medium text-forest-950 dark:text-white' : 'text-forest-800 dark:text-cream-100/80'
                  }`}
                >
                  {l.label}
                </Link>
              )
            })}
          </div>

          {/* The Guest's own side of the site. When they are signed in it leads
              with who they are, so the drawer answers "am I signed in as me"
              without making them open the account page to find out. */}
          {user && canOpenPage(role, '/account') ? (
            <div className="mt-4 rounded-[14px] border border-forest-900/10 bg-white/70 p-3 dark:border-cream-100/12 dark:bg-forest-900/50">
              <div className="flex items-center gap-3 px-1 pb-3">
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-forest-800 text-sm font-semibold text-cream-50 dark:bg-cream-100 dark:text-forest-950"
                  aria-hidden="true"
                >
                  {initial}
                </span>
                <span className="min-w-0">
                  <span
                    className="block truncate text-sm font-medium text-forest-900 dark:text-cream-50"
                    title={profile?.display_name || profile?.first_name || undefined}
                  >
                    {profile?.display_name || profile?.first_name || 'Guest'}
                  </span>
                  <span
                    className="block truncate text-[11px] text-forest-600 dark:text-sage-400"
                    title={user.email ?? undefined}
                  >
                    {user.email}
                  </span>
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                <Link
                  to="/account"
                  onClick={() => setOpen(false)}
                  className={`flex items-center justify-between gap-2 rounded-[10px] px-3 py-2.5 text-sm transition-colors ${FOCUS_RING} ${
                    location.pathname === '/account'
                      ? 'bg-forest-800 text-cream-50 dark:bg-brass-400 dark:text-forest-950'
                      : 'text-forest-800 hover:bg-cream-100 dark:text-cream-100 dark:hover:bg-forest-800/70'
                  }`}
                >
                  My bookings &amp; profile
                </Link>
                {signedIn && (
                  <Link
                    to="/account?tab=notifications"
                    onClick={() => setOpen(false)}
                    className={`flex items-center justify-between gap-2 rounded-[10px] px-3 py-2.5 text-sm transition-colors ${FOCUS_RING} ${
                      onNotifications
                        ? 'bg-forest-800 text-cream-50 dark:bg-brass-400 dark:text-forest-950'
                        : 'text-forest-800 hover:bg-cream-100 dark:text-cream-100 dark:hover:bg-forest-800/70'
                    }`}
                  >
                    Notifications
                    {unreadCount > 0 && (
                      <span className="guest-num rounded-full bg-red-600 px-1.5 py-0.5 text-[11px] font-bold leading-none text-white">
                        {unreadLabel}
                      </span>
                    )}
                  </Link>
                )}
                {canOpenPage(role, '/messages') && (
                  <Link
                    to="/messages"
                    onClick={() => setOpen(false)}
                    className={`rounded-[10px] px-3 py-2.5 text-sm transition-colors ${FOCUS_RING} ${
                      location.pathname === '/messages'
                        ? 'bg-forest-800 text-cream-50 dark:bg-brass-400 dark:text-forest-950'
                        : 'text-forest-800 hover:bg-cream-100 dark:text-cream-100 dark:hover:bg-forest-800/70'
                    }`}
                  >
                    Messages
                  </Link>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-4 pt-2 space-y-2">
              {canOpenPage(role, '/account') && (
                <Link to="/account" onClick={() => setOpen(false)} className="btn-ghost w-full btn-sm">
                  My bookings &amp; profile
                </Link>
              )}
              {canOpenPage(role, '/messages') && (
                <Link to="/messages" onClick={() => setOpen(false)} className="btn-ghost w-full btn-sm">
                  Messages
                </Link>
              )}
            </div>
          )}

          {user ? (
            <button
              onClick={() => {
                setOpen(false)
                void logout()
              }}
              className={`text-xs text-forest-600 dark:text-cream-200/70 mt-3 text-center underline w-full ${FOCUS_RING}`}
            >
              Sign out ({user.email})
            </button>
          ) : (
            <Link
              to="/guest/auth"
              onClick={() => setOpen(false)}
              className="btn-ghost w-full btn-sm mt-3"
            >
              Sign in / Create a Guest account
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}
