import { BUSINESS } from '../../config/site'
import { Compass, MapPin, Navigation } from '../../lib/icons'

export type QuickReplyOption = {
  id: 'on-the-way' | 'arrived-gate' | 'send-directions'
  label: string
  text: string
  autoSend?: boolean
}

/**
 * Quick replies using the Hacienda address and the current approximate map pin
 * from `src/config/site.ts` — zero placeholder URLs or coordinates.
 */
export const DEFAULT_QUICK_REPLIES: readonly QuickReplyOption[] = [
  {
    id: 'on-the-way',
    label: 'On the way',
    text: `We are on the way to ${BUSINESS.name}.`,
  },
  {
    id: 'arrived-gate',
    label: 'Arrived at gate',
    text: `We have arrived at the ${BUSINESS.name} gate.`,
  },
  {
    id: 'send-directions',
    label: 'Send Directions',
    text: `Directions to ${BUSINESS.name} (${BUSINESS.address.formatted}): ${BUSINESS.contact.directions} — the map pin is approximate; please confirm it with the Hacienda.`,
  },
] as const

export type QuickReplyActionsProps = {
  disabled?: boolean
  onSelect: (reply: QuickReplyOption) => void
}

export function QuickReplyActions({ disabled = false, onSelect }: QuickReplyActionsProps) {
  const iconFor = (id: QuickReplyOption['id']) => {
    switch (id) {
      case 'on-the-way':
        return <Navigation size={13} />
      case 'arrived-gate':
        return <MapPin size={13} />
      case 'send-directions':
        return <Compass size={13} />
    }
  }

  return (
    <div
      className="mb-2.5 flex items-center gap-2 overflow-x-auto pb-0.5"
      role="group"
      aria-label="Quick message templates"
    >
      {DEFAULT_QUICK_REPLIES.map((reply) => (
        <button
          key={reply.id}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(reply)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-forest-900/12 bg-cream-100/75 px-3 py-1.5 text-xs font-medium text-forest-800 transition-colors hover:border-brass-500/50 hover:bg-cream-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass-400 disabled:cursor-not-allowed disabled:opacity-45 dark:border-cream-100/15 dark:bg-forest-950/45 dark:text-cream-100 dark:hover:bg-forest-950/70"
        >
          {iconFor(reply.id)}
          <span>{reply.label}</span>
        </button>
      ))}
    </div>
  )
}
