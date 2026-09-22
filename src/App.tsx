import { useEffect } from 'react'
import { Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { ROLE_LABELS, homeForRole } from './lib/auth'
import { useAuth } from './hooks/useAuth'
import { Nav } from './components/Nav'
import { Footer } from './components/Footer'
import { MobileStickyCTA } from './components/MobileStickyCTA'
import { Home } from './pages/Home'
import { BookingPage } from './pages/BookingPage'
import { LiveTrackingPage } from './pages/LiveTrackingPage'
import { AdminPage } from './pages/AdminPage'
import { AccountPage } from './pages/AccountPage'
import { ProtectedRoute } from './components/Auth/ProtectedRoute'
import { LoginForm } from './components/Auth/LoginForm'
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
        {/* App for Client (Host + Staff). The gate reads the path it stands on,
            so /app/tracking answers from its own rule, not /app's. */}
        <Route
          path="/app"
          element={
            <ProtectedRoute>
              <AdminApp />
            </ProtectedRoute>
          }
        >
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
          <Route path="/login" element={<SignInPage />} />

          {/* The Guest's own page: their Bookings, their ID, their Date hold */}
          <Route
            path="/account"
            element={
              <ProtectedRoute>
                <AccountPage />
              </ProtectedRoute>
            }
          />
          
          {/* Website for Admin — the Host alone: this is where a Booking is
              approved, an ID is read and a payment is verified. */}
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

/** Where the sign-in form lives when nobody has a page to be turned away from. */
function SignInPage() {
  const { user, role } = useAuth()
  return (
    <div className="pt-32 pb-24 min-h-screen bg-cream-50 flex flex-col items-center">
      <div className="w-full max-w-md px-5">
        {user ? (
          <div className="bg-white rounded-[28px] border border-forest-900/5 shadow-card p-8 text-center">
            <div className="eyebrow">Signed in</div>
            <h1 className="font-serif text-3xl mt-2 text-forest-900">
              You are the {role ? ROLE_LABELS[role] : 'Guest'}
            </h1>
            <p className="mt-2 text-sm text-forest-700/70">{user.email ?? user.displayName}</p>
            <Link to={homeForRole(role)} className="btn-primary mt-6 inline-flex text-xs">
              Go to my page
            </Link>
          </div>
        ) : (
          <LoginForm />
        )}
      </div>
    </div>
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
