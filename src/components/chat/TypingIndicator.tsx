export type TypingIndicatorProps = {
  senderLabel?: string
}

/**
 * Subtle typing indicator rendered only when a verified remote typing signal
 * is active (never driven by the current user's own keystrokes).
 */
export function TypingIndicator({ senderLabel = 'Hacienda Admin' }: TypingIndicatorProps) {
  return (
    <div
      className="inline-flex items-center gap-2 rounded-full border border-forest-900/10 bg-cream-100/80 px-3.5 py-1.5 text-xs text-forest-700 dark:border-cream-100/12 dark:bg-forest-950/50 dark:text-cream-100"
      role="status"
      aria-live="polite"
    >
      <span className="inline-flex items-center gap-1" aria-hidden="true">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-forest-600" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-forest-600 [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-forest-600 [animation-delay:300ms]" />
      </span>
      <span>{senderLabel} is typing…</span>
    </div>
  )
}
