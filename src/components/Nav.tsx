import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Logo } from './Logo'
import { Menu, Close, Bell, Calendar, LogOut, User } from '../lib/icons'
import { useAuth } from '../hooks/useAuth'
import { useNotifications } from '../hooks/useNotifications'
import { canOpenPage } from '../lib/auth'
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
  const [accountOpen, setAccountOpen] = useState(false)
  const accountMenu = useRef<HTMLDivElement | null>(null)
  const accountButton = useRef<HTMLButtonElement | null>(null)
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
  // The notification links lead to the account's notifications tab.
  const onNotifications =
    location.pathname === '/mybookings' &&
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
    setAccountOpen(false)
  }, [location.pathname, location.search, location.hash])

  useEffect(() => { setAccountOpen(false) }, [user?.uid])

  // This is a disclosure containing ordinary links, so Tab follows the normal
  // link order. Close on outside interaction or Escape, returning focus on Escape.
  useEffect(() => {
    if (!accountOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!accountMenu.current?.contains(event.target as Node)) setAccountOpen(false)
    }
    const onFocus = (event: FocusEvent) => {
      if (!accountMenu.current?.contains(event.target as Node)) setAccountOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setAccountOpen(false)
      accountButton.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [accountOpen])

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
            className={`inline-flex min-h-11 min-w-0 items-center ${FOCUS_RING}`}
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
                  className={`relative inline-flex min-h-11 items-center whitespace-nowrap px-1 py-2 text-sm font-medium leading-none transition-colors ${FOCUS_RING} ${
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
              <div ref={accountMenu} className="relative">
                <button
                  ref={accountButton}
                  type="button"
                  aria-expanded={accountOpen}
                  aria-controls="desktop-account-menu"
                  aria-label={`${role === 'admin' ? 'Admin account' : profile?.first_name?.trim() || 'Guest'} account menu${signedIn && role !== 'admin' && unreadCount > 0 ? `, ${unreadCount} unread notifications` : ''}`}
                  onClick={() => setAccountOpen((value) => !value)}
                  className={`inline-flex min-h-11 items-center gap-2 rounded-full border py-1 pl-1.5 pr-3 text-sm whitespace-nowrap transition ${FOCUS_RING} ${
                    transparent
                      ? 'border-cream-200/25 bg-forest-950/25 text-cream-50 hover:bg-forest-950/40'
                      : 'border-forest-900/10 bg-white/60 text-forest-800 hover:bg-white dark:border-cream-100/15 dark:bg-forest-900/50 dark:text-cream-100 dark:hover:bg-forest-800'
                  }`}
                >
                  <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-forest-800 text-xs font-semibold text-cream-50 dark:bg-cream-100 dark:text-forest-950" aria-hidden="true">
                    {initial}
                    {signedIn && role !== 'admin' && unreadCount > 0 && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-cream-50 bg-red-600" />}
                  </span>
                  <span className="max-w-[7.5rem] truncate">{role === 'admin' ? 'Admin account' : profile?.first_name?.trim() || 'Guest'}</span>
                  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform ${accountOpen ? 'rotate-180' : ''}`}><path d="m6 9 6 6 6-6" /></svg>
                </button>
                {accountOpen && (
                  <div id="desktop-account-menu" className="absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl border border-forest-900/10 bg-cream-50 p-2 shadow-float dark:border-cream-100/15 dark:bg-forest-900">
                    <div className="border-b border-forest-900/10 px-3 pb-3 pt-2 dark:border-cream-100/10">
                      <p className="truncate text-sm font-semibold text-forest-900 dark:text-cream-50">{profile?.display_name || profile?.first_name || (role === 'admin' ? 'Admin' : 'Guest')}</p>
                      {user.email && <p className="mt-0.5 truncate text-xs text-forest-600 dark:text-cream-200/70">{user.email}</p>}
                    </div>
                    {canOpenPage(role, '/mybookings') && (
                      <Link to="/mybookings" onClick={() => setAccountOpen(false)} className={`mt-1 flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-forest-800 hover:bg-forest-900/5 dark:text-cream-100 dark:hover:bg-cream-100/10 ${FOCUS_RING}`}>
                        <Calendar size={17} aria-hidden="true" /> My bookings
                      </Link>
                    )}
                    {canOpenPage(role, '/mybookings') && (
                      <Link to="/profile" onClick={() => setAccountOpen(false)} className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-forest-800 hover:bg-forest-900/5 dark:text-cream-100 dark:hover:bg-cream-100/10 ${FOCUS_RING}`}>
                        <User size={17} aria-hidden="true" /> My profile
                      </Link>
                    )}
                    {signedIn && role !== 'admin' && (
                      <Link to="/mybookings?tab=notifications" onClick={() => setAccountOpen(false)} className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-forest-800 hover:bg-forest-900/5 dark:text-cream-100 dark:hover:bg-cream-100/10 ${FOCUS_RING}`}>
                        <Bell size={17} aria-hidden="true" /> <span className="flex-1">Notifications</span>
                        {unreadCount > 0 && <span aria-label={`${unreadCount} unread`} className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">{unreadLabel}</span>}
                      </Link>
                    )}
                    <button type="button" onClick={() => { setAccountOpen(false); void logout() }} className={`mt-1 flex min-h-11 w-full items-center gap-3 border-t border-forest-900/10 px-3 text-left text-sm text-forest-700 hover:bg-forest-900/5 dark:border-cream-100/10 dark:text-cream-200 dark:hover:bg-cream-100/10 ${FOCUS_RING}`}>
                      <LogOut size={17} aria-hidden="true" /> Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link
                to="/guest/auth"
                className={`inline-flex min-h-11 items-center px-4 text-sm rounded-full border whitespace-nowrap transition shrink-0 ${FOCUS_RING} ${
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
              Mag-book
            </Link>
          </div>

          {/* Mobile / tablet: logo | Book Now | Menu. The booking action stays
              in the header rather than behind the menu. */}
          <div className="xl:hidden flex items-center gap-1.5 min-[360px]:gap-2 flex-shrink-0">
            <Link
              to="/book"
              aria-label="Book your stay"
              title="Mag-book ng Matutuluyan"
              className={`btn btn-sm min-h-11 whitespace-nowrap px-3 min-[360px]:px-3.5 sm:px-4 ${
                transparent
                  ? 'bg-cream-50 text-forest-900 hover:bg-white'
                  : 'bg-forest-800 text-cream-50 hover:bg-forest-900 dark:bg-cream-100 dark:text-forest-950 dark:hover:bg-white'
              }`}
            >
              <span className="sm:hidden">Book</span>
              <span className="hidden sm:inline">Mag-book</span>
            </Link>
            <button
              ref={menuButton}
              type="button"
              className={`h-11 w-11 rounded-full transition flex items-center justify-center flex-shrink-0 ${FOCUS_RING} ${
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
                  className={`${drawerRow} flex min-h-12 items-center py-3 text-lg font-serif ${
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
                    className={`${drawerRow} flex min-h-11 items-center py-2.5 text-base ${
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
          {user && canOpenPage(role, '/mybookings') ? (
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
                    className="block truncate text-sm text-forest-600 dark:text-sage-400"
                    title={user.email ?? undefined}
                  >
                    {user.email}
                  </span>
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                <Link
                  to="/mybookings"
                  onClick={() => setOpen(false)}
                  className={`flex items-center justify-between gap-2 rounded-[10px] min-h-11 px-3 py-2.5 text-base transition-colors ${FOCUS_RING} ${
                    location.pathname === '/mybookings' && !onNotifications
                      ? 'bg-forest-800 text-cream-50 dark:bg-brass-400 dark:text-forest-950'
                      : 'text-forest-800 hover:bg-cream-100 dark:text-cream-100 dark:hover:bg-forest-800/70'
                  }`}
                >
                  My bookings
                </Link>
                <Link
                  to="/profile"
                  onClick={() => setOpen(false)}
                  className={`flex items-center min-h-11 rounded-[10px] px-3 py-2.5 text-base transition-colors ${FOCUS_RING} ${
                    location.pathname === '/profile'
                      ? 'bg-forest-800 text-cream-50 dark:bg-brass-400 dark:text-forest-950'
                      : 'text-forest-800 hover:bg-cream-100 dark:text-cream-100 dark:hover:bg-forest-800/70'
                  }`}
                >
                  My profile
                </Link>
                {signedIn && (
                  <Link
                    to="/mybookings?tab=notifications"
                    onClick={() => setOpen(false)}
                    className={`flex items-center justify-between gap-2 rounded-[10px] min-h-11 px-3 py-2.5 text-base transition-colors ${FOCUS_RING} ${
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
                    className={`rounded-[10px] min-h-11 px-3 py-2.5 text-base transition-colors ${FOCUS_RING} ${
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
              {canOpenPage(role, '/mybookings') && (
                <Link to="/mybookings" onClick={() => setOpen(false)} className="btn-ghost w-full btn-sm">
                  My bookings
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
              className={`mt-3 inline-flex min-h-11 w-full items-center justify-center text-sm text-forest-700 dark:text-cream-200/80 text-center underline ${FOCUS_RING}`}
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
