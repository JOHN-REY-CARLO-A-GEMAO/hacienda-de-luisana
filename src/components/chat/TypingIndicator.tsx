import { useEffect, useState } from 'react'

/**
 * A lightweight typing indicator. The parent passes the set of users currently
 * typing; this component shows a temporary, animated label that expires on its
 * own. It never writes to Firestore — the parent is responsible for debouncing
 * and clearing stale state.
 */
export function TypingIndicator({
  typingUsers,
  isAdmin,
}: {
  /** Set of user ids currently typing. Empty when nobody is. */
  typingUsers: Set<string>
  /** Whether the current viewer is the Admin, for role-aware wording. */
  isAdmin: boolean
}) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted || typingUsers.size === 0) return null

  const count = typingUsers.size
  const label = count === 1 ? 'typing…' : 'typing…'
  const who = isAdmin ? 'Guest' : 'Admin'

  return (
    <div className="flex items-center gap-1.5 px-4 py-1.5 text-sm text-forest-500">
      <span className="flex h-2.5 w-2.5">
        <span className="h-[3px] w-[3px] rounded-full bg-forest-500 animate-bounce" />
      </span>
      <span className="text-forest-500">{who} {label}</span>
    </div>
  )
}
