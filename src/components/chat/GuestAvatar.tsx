import { useState } from 'react'

export type GuestAvatarProps = {
  name: string
  avatarUrl?: string | null
  size?: 'sm' | 'md' | 'lg'
  /** 'hacienda' renders the Hacienda de LuisAna crest mark in deep forest & brass. */
  variant?: 'guest' | 'hacienda'
}

const SIZE_CLASSES: Record<NonNullable<GuestAvatarProps['size']>, string> = {
  sm: 'h-9 w-9 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
}

export function initialsFromName(name: string): string {
  const parts = name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
  if (parts.length === 0) return 'G'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

export function GuestAvatar({
  name,
  avatarUrl,
  size = 'md',
  variant = 'guest',
}: GuestAvatarProps) {
  const [imgFailed, setImgFailed] = useState(false)
  const sizeCls = SIZE_CLASSES[size]

  if (variant === 'hacienda') {
    return (
      <div
        className={`${sizeCls} flex shrink-0 items-center justify-center rounded-full border border-brass-400/50 bg-forest-800 font-serif font-semibold tracking-wider text-cream-50 shadow-sm`}
        aria-hidden="true"
      >
        HDL
      </div>
    )
  }

  const initials = initialsFromName(name)

  if (avatarUrl && !imgFailed) {
    return (
      <img
        src={avatarUrl}
        alt={name || 'Guest'}
        onError={() => setImgFailed(true)}
        className={`${sizeCls} shrink-0 rounded-full border border-forest-900/12 object-cover`}
      />
    )
  }

  return (
    <div
      className={`${sizeCls} flex shrink-0 items-center justify-center rounded-full border border-forest-900/12 bg-cream-100 font-serif font-semibold tracking-wide text-forest-800 dark:border-cream-100/15 dark:bg-forest-800 dark:text-cream-50`}
      aria-hidden="true"
    >
      {initials}
    </div>
  )
}
