import { useEffect } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { Nav } from './components/Nav'
import { Footer } from './components/Footer'
import { MobileStickyCTA } from './components/MobileStickyCTA'
import { Home } from './pages/Home'
import { BookingPage } from './pages/BookingPage'
import { LiveTrackingPage } from './pages/LiveTrackingPage'
import { AdminPage } from './pages/AdminPage'
import { ProtectedRoute } from './components/Auth/ProtectedRoute'
import { useReveal } from './lib/reveal'
import { isNativeApp } from './lib/native'
import { AdminApp } from './app/AdminApp'
import { AdminBookingsScreen } from './app/screens/AdminBookingsScreen'
import { AdminTrackingScreen } from './app/screens/AdminTrackingScreen'
import { ClientAnalyticsScreen } from './app/screens/ClientAnalyticsScreen'
import { AdminRecordsScreen } from './app/screens/AdminRecordsScreen'

function ScrollHandler() {
  const location = useLocation()
  useEffect(() => {
    if (location.hash) {
      const id = location.hash.slice(1)
      const el = document.getElementById(id)
      if (el) {
        setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
        return
      }
    }
    window.scrollTo({ top: 0 })
  }, [location.pathname, location.hash])
  return null
}

function WebsiteLayout() {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <ScrollHandler />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
      <MobileStickyCTA />
    </div>
  )
}

function NativeHomeRedirect() {
  const location = useLocation()
  if (isNativeApp && location.pathname === '/') {
    return <Navigate to="/app" replace />
  }
  return null
}

export default function App() {
  useReveal()
  return (
    <>
      <NativeHomeRedirect />
      <Routes>
        {/* App for Client (Client / Host App) */}
        <Route path="/app" element={<AdminApp />}>
          <Route index element={<AdminBookingsScreen />} />
          <Route path="tracking" element={<AdminTrackingScreen />} />
          <Route path="analytics" element={<ClientAnalyticsScreen />} />
          <Route path="records" element={<AdminRecordsScreen />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Route>

        {/* Website for Bookers and Public Website */}
        <Route element={<WebsiteLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/book" element={<BookingPage />} />
          <Route path="/track" element={<LiveTrackingPage />} />
          <Route path="/share-location" element={<LiveTrackingPage />} />
          
          {/* Website for Admin */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <AdminPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </>
  )
}

function NotFound() {
  return (
    <div className="pt-32 pb-24 min-h-screen bg-cream-50 flex items-center">
      <div className="mx-auto max-w-lg text-center px-5">
        <div className="eyebrow">404</div>
        <h1 className="display text-5xl mt-3 text-forest-900">Page not found</h1>
        <p className="mt-4 text-forest-800/80">
          The page you're looking for doesn't exist. Let's head back to the Hacienda.
        </p>
        <a href="/" className="btn-primary mt-8">Back to Home</a>
      </div>
    </div>
  )
}
