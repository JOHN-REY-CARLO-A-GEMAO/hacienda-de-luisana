import { useEffect } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { AppHeader } from './AppHeader'
import { AppTabBar } from './AppTabBar'

function useLockBodyScroll() {
  useEffect(() => {
    const html = document.documentElement
    const body = document.body
    const prevHtml = html.style.overflow
    const prevBody = body.style.overflow
    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    return () => {
      html.style.overflow = prevHtml
      body.style.overflow = prevBody
    }
  }, [])
}

function ScrollToTop() {
  const { pathname, search } = useLocation()
  useEffect(() => {
    const el = document.getElementById('app-scroll')
    el?.scrollTo({ top: 0 })
  }, [pathname, search])
  return null
}

export function GuestApp() {
  useLockBodyScroll()

  return (
    <div className="h-[100dvh] bg-cream-50 lg:bg-[#0f1c11] lg:flex lg:flex-col lg:items-center lg:justify-center lg:p-8">
      <div className="hidden lg:block text-center mb-4">
        <div className="text-[11px] uppercase tracking-eyebrow text-cream-100/50">
          Hacienda de LuisAna · Guest app
        </div>
      </div>

      <div className="h-full w-full lg:h-[min(844px,calc(100dvh-6rem))] lg:w-[390px] lg:rounded-[40px] lg:overflow-hidden lg:border lg:border-forest-800 lg:shadow-[0_40px_80px_-24px_rgba(0,0,0,0.55)] lg:ring-4 lg:ring-forest-900 flex flex-col bg-cream-50">
        <AppHeader />
        <ScrollToTop />
        <div id="app-scroll" className="flex-1 overflow-y-auto overscroll-contain">
          <Outlet />
        </div>
        <AppTabBar />
      </div>

      <Link
        to="/"
        className="hidden lg:inline-block mt-5 text-sm text-cream-100/60 hover:text-cream-50 transition"
      >
        ← Full website
      </Link>
    </div>
  )
}
