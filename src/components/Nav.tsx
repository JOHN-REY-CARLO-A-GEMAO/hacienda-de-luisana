import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Logo } from './Logo'
import { Menu, Close } from '../lib/icons'

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/#stay', label: 'Stay' },
  { href: '/#experience', label: 'Experience' },
  { href: '/#gallery', label: 'Gallery' },
  { href: '/#location', label: 'Location' },
  { href: '/#faqs', label: 'FAQs' },
  { href: '/#contact', label: 'Contact' },
]

export function Nav() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const transparent = location.pathname === '/' && !scrolled

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
    <header
      className={`fixed inset-x-0 top-0 z-40 transition-all duration-500 ${
        transparent
          ? 'bg-transparent'
          : 'bg-cream-50/90 backdrop-blur-md border-b border-forest-900/5 shadow-[0_1px_0_rgba(30,49,32,0.04)]'
      }`}
    >
      <div className="mx-auto max-w-7xl px-5 lg:px-8 h-16 lg:h-20 flex items-center justify-between">
        <Link to="/" aria-label="Hacienda de LuisAna home">
          <Logo tone={transparent ? 'light' : 'dark'} />
        </Link>

        <nav className="hidden lg:flex items-center gap-8">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className={`text-sm font-medium transition ${
                transparent ? 'text-cream-100 hover:text-white' : 'text-forest-800 hover:text-forest-950'
              }`}
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="hidden lg:block">
          <Link
            to="/book"
            className={
              transparent
                ? 'btn bg-cream-50 text-forest-900 hover:bg-white'
                : 'btn bg-forest-800 text-cream-50 hover:bg-forest-900'
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

      {/* Mobile drawer */}
      <div
        className={`lg:hidden overflow-hidden transition-[max-height] duration-500 ${
          open ? 'max-h-[80vh]' : 'max-h-0'
        } bg-cream-50 border-t border-forest-900/5`}
      >
        <div className="px-6 py-6 flex flex-col gap-1">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-forest-900 py-3 border-b border-forest-900/5 text-lg font-serif"
            >
              {l.label}
            </a>
          ))}
          <Link to="/book" className="btn-primary mt-6 w-full">Book Your Stay</Link>
          <Link to="/admin" className="text-xs text-forest-600 mt-4 text-center underline">
            Owner admin
          </Link>
        </div>
      </div>
    </header>
  )
}
