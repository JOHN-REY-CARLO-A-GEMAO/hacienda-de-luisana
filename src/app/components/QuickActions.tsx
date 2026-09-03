import { useState } from 'react'
import { BUSINESS } from '../../config/site'
import { MapPin, Messenger, Phone, Share } from '../../lib/icons'
import { shareHacienda, telHref } from '../share'

const ITEMS: {
  id: string
  label: string
  href?: string
  external?: boolean
  share?: boolean
  icon: typeof Phone
}[] = [
  { id: 'call', label: 'Call', href: telHref(), icon: Phone },
  { id: 'chat', label: 'Chat', href: BUSINESS.contact.messenger, external: true, icon: Messenger },
  { id: 'maps', label: 'Maps', href: BUSINESS.contact.directions, external: true, icon: MapPin },
  { id: 'share', label: 'Share', share: true, icon: Share },
]

export function QuickActions() {
  const [flash, setFlash] = useState<string | null>(null)

  const onShare = async () => {
    const result = await shareHacienda()
    if (result === 'copied') {
      setFlash('Link copied')
      window.setTimeout(() => setFlash(null), 1600)
    }
  }

  return (
    <div>
      <div className="grid grid-cols-4 gap-2">
        {ITEMS.map((item) => {
          const Icon = item.icon
          const className =
            'flex flex-col items-center gap-1.5 rounded-2xl bg-white border border-forest-900/5 py-3 text-forest-800 active:scale-[0.97] transition'
          const inner = (
            <>
              <span className="w-10 h-10 rounded-xl bg-forest-50 text-forest-700 flex items-center justify-center">
                <Icon size={18} />
              </span>
              <span className="text-[11px] font-medium">{item.label}</span>
            </>
          )
          if (item.share) {
            return (
              <button key={item.id} type="button" onClick={onShare} className={className}>
                {inner}
              </button>
            )
          }
          return (
            <a
              key={item.id}
              href={item.href}
              target={item.external ? '_blank' : undefined}
              rel={item.external ? 'noreferrer' : undefined}
              className={className}
            >
              {inner}
            </a>
          )
        })}
      </div>
      {flash ? (
        <div className="mt-2 text-center text-[11px] text-forest-600">{flash}</div>
      ) : null}
    </div>
  )
}
