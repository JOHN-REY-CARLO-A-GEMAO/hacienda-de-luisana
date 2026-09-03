import { Link } from 'react-router-dom'
import { Logo } from '../components/Logo'
import { Phone } from '../lib/icons'
import { telHref } from './share'

export function AppHeader() {
  return (
    <header className="shrink-0 z-20 bg-cream-50/95 backdrop-blur-md border-b border-forest-900/5 pt-[env(safe-area-inset-top)]">
      <div className="h-14 px-4 flex items-center justify-between">
        <Link to="/app" aria-label="Hacienda de LuisAna home">
          <Logo tone="dark" />
        </Link>
        <a
          href={telHref()}
          aria-label="Call the host"
          className="w-10 h-10 rounded-full bg-forest-800 text-cream-50 flex items-center justify-center active:scale-95 transition"
        >
          <Phone size={16} />
        </a>
      </div>
    </header>
  )
}
