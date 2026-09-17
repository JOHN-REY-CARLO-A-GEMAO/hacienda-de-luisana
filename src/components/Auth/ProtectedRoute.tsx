import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { LoginForm } from './LoginForm'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, isConfigured } = useAuth()
  const [showSetup, setShowSetup] = useState(false)

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

  // If Firebase not configured, allow seamless access in local demo mode
  if (!isConfigured) {
    return (
      <div className="min-h-screen bg-cream-50">
        <div className="bg-amber-100/90 border-b border-amber-200 text-amber-900 text-xs px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-semibold uppercase tracking-eyebrow text-[10px]">Local Mode Active:</span>
            <span>Running with simulated smart lock & local bookings database.</span>
          </div>
          <button
            onClick={() => setShowSetup(!showSetup)}
            className="underline hover:text-amber-950 font-medium"
          >
            {showSetup ? 'Hide Setup Info' : 'Cloud Setup'}
          </button>
        </div>
        {showSetup && (
          <div className="max-w-xl mx-auto my-6 px-4">
            <LoginForm />
          </div>
        )}
        {children}
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
          Admin access only. Sign in with your authorized account.
        </p>
      </div>
    )
  }

  return <>{children}</>
}
