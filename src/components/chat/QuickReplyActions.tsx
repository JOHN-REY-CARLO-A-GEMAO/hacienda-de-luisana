/**
 * Quick reply chips shown above the message input. All quick replies use the
 * same unified conversation thread — they are ordinary messages sent to the
 * current conversation.
 */
export type QuickReply = {
  id: string
  label: string
  text: string
  sendImmediately: boolean
}

export const QUICK_REPLIES: QuickReply[] = [
  {
    id: 'on-the-way',
    label: 'On the way',
    text: 'On the way.',
    sendImmediately: true,
  },
  {
    id: 'arrived-at-gate',
    label: 'Arrived at gate',
    text: 'Arrived at the gate.',
    sendImmediately: true,
  },
  {
    id: 'send-directions',
    label: 'Send Directions',
    text: 'Please share directions to the property.',
    sendImmediately: false,
  },
]

export type QuickReplyActionsProps = {
  onSelect: (reply: QuickReply) => void
  disabled?: boolean
}

export function QuickReplyActions({
  onSelect,
  disabled = false,
}: QuickReplyActionsProps) {
  return (
    <div className="flex flex-wrap gap-2 px-4 pb-1.5 pt-1">
      {QUICK_REPLIES.map((reply) => (
        <button
          key={reply.id}
          type="button"
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors border
            ${disabled
              ? 'bg-forest-50 border-transparent text-forest-400 cursor-not-allowed'
              : 'bg-white border-card-surface text-forest-700 hover:bg-forest-50 hover:text-forest-900'}
          `}
          disabled={disabled}
          onClick={() => onSelect(reply)}
          aria-label={reply.label}
        >
          {reply.label}
        </button>
      ))}
    </div>
  )
}
