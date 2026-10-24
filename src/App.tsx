import { SupportPage } from './pages/SupportPage'
import { useEffect } from 'react'
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Nav } from './components/Nav'
import { Footer } from './components/Footer'
import { Home } from './pages/Home'
import { StayPage } from './pages/StayPage'
import { RatesPage } from './pages/RatesPage'
import { GalleryPage } from './pages/GalleryPage'
import { ExperiencePage } from './pages/ExperiencePage'
import { LocationPage } from './pages/LocationPage'
import { ReviewsPage } from './pages/ReviewsPage'
import { FaqPage } from './pages/FaqPage'
import { HouseRulesPage } from './pages/HouseRulesPage'
import { ContactPage } from './pages/ContactPage'
import { BookingPage } from './pages/BookingPage'
import { DownpaymentPage } from './pages/DownpaymentPage'
import { BookingStatusPage } from './pages/BookingStatusPage'
import { ReviewDeskPage } from './pages/ReviewDeskPage'
import { AccountPage } from './pages/AccountPage'
import { LegalPage } from './pages/LegalPage'
import { MessagesPage } from './pages/MessagesPage'
import { StatusPage } from './pages/StatusPage'
import { Tutorial } from './components/Tutorial'
import { MessageScreen } from './components/ui'
import { GuestAuthPage } from './pages/AuthPage'
import { ProtectedRoute } from './components/Auth/ProtectedRoute'
import { useReveal } from './lib/reveal'
import { RouteMeta } from './components/RouteMeta'

/**
 * Homepage anchors that now live on a page of their own.
 *
 * These were `/#x` link targets, and they are still addressable: a bookmark, a
 * search result or a shared link that says `/#faqs` is forwarded to the page
 * that answers it rather than quietly scrolling to the top of a homepage that no
 * longer has the section. Anchors the homepage still renders — intro, stay,
 * rates, experience, gallery, reviews, location — are absent on purpose and
 * keep scrolling as before.
 */
const MOVED_ANCHORS: Readonly<Record<string, string>> = {
  faqs: '/faqs',
  'house-rules': '/house-rules',
  amenities: '/stay',
  nearby: '/experience',
  contact: '/contact',
}

function ScrollHandler() {
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    if (location.hash) {
      const id = location.hash.slice(1)
      const moved = MOVED_ANCHORS[id]
      if (moved) {
        navigate(moved, { replace: true })
        return
      }
      const el = document.getElementById(id)
      if (el) {
        setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
        return
      }
    }
    window.scrollTo({ top: 0 })
  }, [location.pathname, location.hash, navigate])
  return null
}

function WebsiteLayout() {
  return (
    <div className="min-h-screen flex flex-col">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Nav />
      <RouteMeta />
      <ScrollHandler />
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <Footer />
      {/* The way back into the tour sits at the foot of the document, after the
          footer: on a phone it is a row in the flow (nothing can scroll under
          it, and at the last scroll position it is clear of the fixed header),
          and from `lg` up it is the floating pill in the margin. */}
      <Tutorial />
    </div>
  )
}

/**
 * The Guest website (ADR-0007). Every route here is the Guest's: the public
 * pages, booking, the Guest's own account, chat and reviews. The Admin's
 * work — reviewing Bookings, payments, stays, the smart lock, analytics —
 * lives in the Flutter mobile app under `lib/`, so the old `/admin` and `/app`
 * addresses answer with a pointer to it rather than a dashboard.
 */
export default function App() {
  // Re-armed on every route change: the dedicated pages render their own
  // `.reveal` blocks, and one observer created at mount would never see them.
  const location = useLocation()
  useReveal([location.pathname])
  return (
    <>
      <Routes>
        <Route element={<WebsiteLayout />}>
          <Route path="/" element={<Home />} />

          {/* The dedicated pages the homepage links out to. Each one is the
              detail behind a preview on `/`, so a visitor who wants more is
              never more than one click away — and the homepage stays the short
              version. */}
          <Route path="/stay" element={<StayPage />} />
          <Route path="/rates" element={<RatesPage />} />
          <Route path="/gallery" element={<GalleryPage />} />
          <Route path="/experience" element={<ExperiencePage />} />
          <Route path="/location" element={<LocationPage />} />
          <Route path="/reviews" element={<ReviewsPage />} />
          <Route path="/faqs" element={<FaqPage />} />
          <Route path="/house-rules" element={<HouseRulesPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/support" element={<SupportPage />} />

          <Route path="/book" element={<BookingPage />} />
          <Route path="/book/pay" element={<DownpaymentPage />} />
          <Route path="/booking/status" element={<BookingStatusPage />} />
          {/* Demo review desk, and the same decision for an Admin session.
              Guests are turned away when Firebase is configured. */}
          <Route path="/review" element={<ReviewDeskPage />} />
          <Route path="/legal" element={<LegalPage />} />
          {/* Whether this deployment reaches Firebase, and why not when it does
              not. Public and read-only: a Firebase web config is public by
              design, and the key is masked. */}
          <Route path="/status" element={<StatusPage />} />
          <Route path="/login" element={<LoginRedirect />} />
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

/** `/login` is the address this page used to have. It stays working: anyone
    still holding an old link is sent to `/guest/auth`, the canonical page. */
function LoginRedirect() {
  return <Navigate to="/guest/auth" replace />
}

/** The address of the retired web dashboards: a signpost to the Admin app. */
function AdminMoved() {
  return (
    <MessageScreen
      eyebrow="Admin"
      title="The Admin dashboard moved"
      body={
        <p>
          Bookings, payment verification, stays, the smart lock, chat and analytics are all in the{' '}
          <strong>Hacienda de LuisAna Admin</strong> mobile app. This website is for Guests: browsing,
          booking, and following their own stay.
        </p>
      }
      actions={
        <>
          <Link to="/" className="btn-primary">
            Back to the Hacienda
          </Link>
          <Link to="/account" className="btn-ghost">
            My Bookings
          </Link>
        </>
      }
    />
  )
}

function NotFound() {
  return (
    <MessageScreen
      eyebrow="404"
      title="Page not found"
      body={<p>The page you&rsquo;re looking for doesn&rsquo;t exist. Let&rsquo;s head back to the Hacienda.</p>}
      actions={
        <>
          <Link to="/" className="btn-primary">
            Back to the Hacienda
          </Link>
          <Link to="/book" className="btn-ghost">
            Check availability
          </Link>
        </>
      }
    />
  )
}
