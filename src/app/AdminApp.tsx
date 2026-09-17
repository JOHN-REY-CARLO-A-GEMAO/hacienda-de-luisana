import { NavLink, Outlet, Link } from 'react-router-dom'
import { Calendar, Navigation, BarChart, Lock } from '../lib/icons'

const TABS = [
  { to: '/app', label: 'Bookings', end: true, icon: Calendar },
  { to: '/app/tracking', label: 'Tracking', icon: Navigation },
  { to: '/app/analytics', label: 'Analytics', icon: BarChart },
  { to: '/app/records', label: 'Smart Lock', icon: Lock },
]

export function AdminTabBar() {
  return (
    <nav
      className="shrink-0 z-20 bg-forest-950 border-t border-cream-50/10 pb-[max(0.4rem,env(safe-area-inset-bottom))]"
      aria-label="Client app navigation"
    >
      <div className="grid grid-cols-4 h-[3.85rem]">
        {TABS.map((tab) => {
          const Icon = tab.icon
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={Boolean(tab.end)}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold tracking-wide transition ${
                  isActive ? 'text-cream-50' : 'text-cream-100/50 hover:text-cream-100/80'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={`h-0.5 w-6 rounded-full mb-0.5 ${isActive ? 'bg-cream-50' : 'bg-transparent'}`}
                  />
                  <Icon size={16} />
                  <span>{tab.label}</span>
                </>
              )}
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}

export function AdminApp() {
  return (
    <div className="h-[100dvh] bg-cream-50 flex flex-col">
      <header className="shrink-0 bg-forest-950 text-cream-50 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 border-b border-cream-50/10">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-eyebrow text-cream-100/60">
              Hacienda de LuisAna · Property Client App
            </div>
            <div className="font-serif text-xl leading-tight text-white">App for Client</div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/book"
              className="text-[11px] px-2.5 py-1 rounded-full bg-cream-50/10 hover:bg-cream-50/20 text-cream-100 transition"
              title="Open Booker Website Form"
            >
              Booker Site
            </Link>
            <Link
              to="/admin"
              className="text-[11px] px-2.5 py-1 rounded-full bg-cream-50 text-forest-900 font-semibold hover:bg-white transition"
              title="Open Admin Smart Lock Records"
            >
              Admin Site
            </Link>
          </div>
        </div>
      </header>
      <div id="app-scroll" className="flex-1 overflow-y-auto overscroll-contain">
        <Outlet />
      </div>
      <AdminTabBar />
    </div>
  )
}
