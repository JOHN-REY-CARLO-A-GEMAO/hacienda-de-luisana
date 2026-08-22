import { useAuth } from '../../hooks/useAuth'
import { LoginForm } from './LoginForm'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, isConfigured } = useAuth()

  if (loading) {
    return (
      <div className="pt-28 pb-24 min-h-screen bg-cream-50 flex items-center justify-center">
        <div className="text-center">
          <div className="mx-auto w-10 h-10 border-2 border-forest-200 border-t-forest-700 rounded-full animate-spin" />
          <p className="mt-4 text-sm text-forest-700/70">Checking authentication…</p>
        </div>
      </div>
    )
  }

  // If Firebase not configured, still allow access but show warning + login form fallback
  // For owner dashboard we want to allow local demo even without Firebase
  if (!isConfigured) {
    return (
      <div className="pt-28 pb-24 min-h-screen bg-cream-50">
        <div className="mx-auto max-w-7xl px-5 lg:px-8">
          <div className="max-w-xl mx-auto mb-10">
            <LoginForm />
          </div>
          <div className="border-t border-forest-900/5 pt-10">
            <div className="eyebrow text-center mb-2">Local Demo Mode</div>
            <p className="text-center text-sm text-forest-700/60 mb-8 max-w-lg mx-auto">
              Firebase not configured — showing dashboard with local data. Configure Firebase to enable secure owner login and cloud storage.
            </p>
            {children}
          </div>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="pt-28 pb-24 min-h-screen bg-cream-50 flex flex-col items-center">
        <div className="w-full max-w-md px-5">
          <LoginForm />
        </div>
        <p className="mt-6 text-xs text-forest-700/60 text-center max-w-sm px-5">
          Owner access only. Sign in with your authorized account. If you are a guest, please use the booking form.
        </p>
      </div>
    )
  }

  return <>{children}</>
}
