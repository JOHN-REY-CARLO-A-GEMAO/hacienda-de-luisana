import { NavLink } from 'react-router-dom'
import { Bed, Calendar, Compass, House, User } from '../lib/icons'

const TABS: {
  to: string
  label: string
  icon: typeof House
  end?: boolean
  primary?: boolean
}[] = [
  { to: '/app', label: 'Home', icon: House, end: true },
  { to: '/app/stay', label: 'Stay', icon: Bed },
  { to: '/app/book', label: 'Book', icon: Calendar, primary: true },
  { to: '/app/explore', label: 'Explore', icon: Compass },
  { to: '/app/account', label: 'Account', icon: User },
]

export function AppTabBar() {
  return (
    <nav
      className="shrink-0 z-20 bg-cream-50/95 backdrop-blur-md border-t border-forest-900/5 pb-[max(0.4rem,env(safe-area-inset-bottom))]"
      aria-label="Guest app"
    >
      <div className="grid grid-cols-5 h-[3.85rem]">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const primary = Boolean(tab.primary)
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={Boolean(tab.end)}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition ${
                  isActive ? 'text-forest-900' : 'text-forest-600/70'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={`flex items-center justify-center ${
                      primary
                        ? `w-11 h-8 rounded-full ${
                            isActive ? 'bg-forest-800 text-cream-50' : 'bg-forest-100 text-forest-800'
                          }`
                        : isActive
                          ? 'text-forest-900'
                          : ''
                    }`}
                  >
                    <Icon size={primary ? 18 : 20} />
                  </span>
                  {tab.label}
                </>
              )}
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}
