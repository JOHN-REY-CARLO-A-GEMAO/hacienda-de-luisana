import { useEffect } from 'react'
import { Link, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { homeForRole } from './lib/auth'
import { useAuth } from './hooks/useAuth'
import { Nav } from './components/Nav'
import { Footer } from './components/Footer'
import { MobileStickyCTA } from './components/MobileStickyCTA'
import { Home } from './pages/Home'
import { BookingPage } from './pages/BookingPage'
import { AccountPage } from './pages/AccountPage'
import { LegalPage } from './pages/LegalPage'
import { MessagesPage } from './pages/MessagesPage'
import { StatusPage } from './pages/StatusPage'
import { Tutorial } from './components/Tutorial'
import { GuestAuthPage } from './pages/AuthPage'
import { ProtectedRoute } from './components/Auth/ProtectedRoute'
import { LoginForm } from './components/Auth/LoginForm'
import { useReveal } from './lib/reveal'

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
      <Tutorial />
    </div>
  )
}

/**
 * The Guest website (ADR-0007). Every route here is the Guest's: the public
 * pages, booking, the Guest's own account, chat and reviews. The Admin's
 * work — reviewing Bookings, KYC, payments, stays, the smart lock, analytics —
 * lives in the Flutter mobile app under `lib/`, so the old `/admin` and `/app`
 * addresses answer with a pointer to it rather than a dashboard.
 */
export default function App() {
  useReveal()
  return (
    <>
      <Routes>
        <Route element={<WebsiteLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/book" element={<BookingPage />} />
          <Route path="/legal" element={<LegalPage />} />
          {/* Whether this deployment reaches Firebase, and why not when it does
              not. Public and read-only: a Firebase web config is public by
              design, and the key is masked. */}
          <Route path="/status" element={<StatusPage />} />
          <Route path="/login" element={<SignInPage />} />
          {/* The Guest's sign-in page. Email and Google arrive through the
              same session either way. */}
          <Route path="/guest/auth" element={<GuestAuthPage />} />

          {/* The Guest's own page: their Bookings, their ID, their Date hold */}
          <Route
            path="/account"
            element={
              <ProtectedRoute>
                <AccountPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/messages"
            element={
              <ProtectedRoute>
                <MessagesPage />
              </ProtectedRoute>
            }
          />

          {/* The management dashboards used to be here. They are the Admin
              mobile app now; anybody with an old bookmark is told so. */}
          <Route path="/admin/*" element={<AdminMoved />} />
          <Route path="/app/*" element={<AdminMoved />} />
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
              {role === 'admin' ? 'Admin account' : 'Welcome back, Guest'}
            </h1>
            <p className="mt-2 text-sm text-forest-700/70">{user.email ?? user.displayName}</p>
            {role === 'admin' && (
              <p className="mt-3 text-xs text-forest-700/70 leading-relaxed">
                Management lives in the Hacienda de LuisAna Admin mobile app. This website only shows a Guest's
                own bookings.
              </p>
            )}
            <Link to={homeForRole(role)} className="btn-primary mt-6 inline-flex text-xs">
              {role === 'admin' ? 'Back to the Hacienda' : 'Go to my bookings'}
            </Link>
          </div>
        ) : (
          <LoginForm />
        )}
      </div>
    </div>
  )
}

/** The address of the retired web dashboards: a signpost to the Admin app. */
function AdminMoved() {
  return (
    <div className="pt-32 pb-24 min-h-screen bg-cream-50 flex items-center">
      <div className="mx-auto max-w-lg text-center px-5">
        <div className="eyebrow">Admin</div>
        <h1 className="display text-4xl sm:text-5xl mt-3 text-forest-900">The Admin dashboard moved</h1>
        <p className="mt-4 text-forest-800/80 text-sm leading-relaxed">
          Bookings, KYC review, payment verification, stays, the smart lock, chat and analytics are all in
          the <strong>Hacienda de LuisAna Admin</strong> mobile app. This website is for Guests: browsing, booking,
          and following their own stay.
        </p>
        <div className="mt-8 flex flex-wrap gap-3 justify-center">
          <Link to="/" className="btn-primary text-xs">
            Back to the Hacienda
          </Link>
          <Link to="/account" className="btn-ghost text-xs">
            My Bookings
          </Link>
        </div>
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
