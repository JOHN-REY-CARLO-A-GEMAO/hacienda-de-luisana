import { User } from '../../lib/icons'

/**
 * Guest avatar: a profile image when available, otherwise a circular
 * initials avatar. Never falls back to a raw identifier.
 */
export function GuestAvatar({
  name,
  imageUrl,
  size = 40,
  className = '',
}: {
  name?: string | null
  imageUrl?: string | null
  size?: number
  className?: string
}) {
  const initials = name ? name
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase())
    .slice(0, 2)
    .join('') : 'G'

  return (
    <div
      className={`flex-shrink-0 ${className}`}
      style={{ width: size, height: size }}
      aria-label={name ? `Profile image for ${name}` : 'Guest profile image'}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          className="w-full h-full object-cover rounded-full bg-forest-100"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className="w-full h-full rounded-full bg-forest-100 flex items-center justify-center text-forest-800 font-semibold">
          <User size={Math.round(size * 0.45)} className="text-forest-700" />
          <span className="absolute text-xs font-semibold text-forest-700">
            {initials || 'G'}
          </span>
        </div>
      )}
    </div>
  )
}
