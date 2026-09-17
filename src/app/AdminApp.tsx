import { NavLink, Outlet } from 'react-router-dom'

const TABS = [
  { to: '/app', label: 'Bookings', end: true },
  { to: '/app/tracking', label: 'Tracking' },
  { to: '/app/records', label: 'Records' },
]

export function AdminTabBar() {
  return (
    <nav
      className="shrink-0 z-20 bg-forest-950 border-t border-cream-50/10 pb-[max(0.4rem,env(safe-area-inset-bottom))]"
      aria-label="Owner app"
    >
      <div className="grid grid-cols-3 h-[3.85rem]">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={Boolean(tab.end)}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold tracking-wide transition ${
                isActive ? 'text-cream-50' : 'text-cream-100/50'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={`h-1 w-8 rounded-full ${isActive ? 'bg-cream-50' : 'bg-transparent'}`}
                />
                {tab.label}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

export function AdminApp() {
  return (
    <div className="h-[100dvh] bg-cream-50 flex flex-col">
      <header className="shrink-0 bg-forest-950 text-cream-50 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <div className="text-[10px] uppercase tracking-eyebrow text-cream-100/50">
          Hacienda de LuisAna · Owner
        </div>
        <div className="font-serif text-xl leading-tight">Owner App</div>
      </header>
      <div id="app-scroll" className="flex-1 overflow-y-auto overscroll-contain">
        <Outlet />
      </div>
      <AdminTabBar />
    </div>
  )
}
