import { Check, CheckCircle, AlertCircle } from '../../lib/icons'

export type MessageBubbleProps = {
  id: string
  text: string
  at: string
  mine: boolean
  status?: 'sent' | 'delivered' | 'seen'
  error?: boolean
  attachment?: { path: string; contentType: string; size: number } | null
  isFirst?: boolean
  isLast?: boolean
}

/**
 * A single message bubble with sender-appropriate styling, timestamp, and
 * delivery state (sent / delivered / seen). Delivery states are only shown
 * when the underlying system has sufficient information to support them.
 */
export function MessageBubble({
  id,
  text,
  at,
  mine,
  status,
  error,
  attachment,
  isFirst,
  isLast,
}: MessageBubbleProps) {
  const time = at ? new Date(at).toLocaleTimeString('en-PH', {
    hour: 'numeric',
    minute: '2-digit',
  }) : 'Time unavailable'

  const showReceipt = mine && status != null

  return (
    <li
      className={`flex w-full mb-2 ${mine ? 'justify-end' : 'justify-start'} [&_li]:last:mb-0`}
    >
      <div
        className={`
          max-w-[80%] rounded-xl px-4 py-2.5 text-sm leading-relaxed shadow-sm
          ${mine
            ? 'bg-forest-900 text-white'
            : 'bg-white border border-card-surface text-forest-900'}
        `}
      >
        {attachment && (
          <div className={`mb-2 ${mine ? 'text-right' : 'text-left'}`}>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-forest-200/30 text-forest-700 text-xs font-medium">
              📷 Photo
            </span>
          </div>
        )}
        {text && (
          <p className={`mb-1 ${mine ? 'text-right' : 'text-left'}`}>
            {text}
          </p>
        )}
        <div className="flex items-baseline gap-1.5">
          <time
            dateTime={at}
            className="text-[10px] text-forest-400 leading-none"
            title={at}
          >
            {time}
          </time>
          {showReceipt && (
            <DeliveryReceipt status={status} error={error} mine={mine} />
          )}
        </div>
      </div>

      {/* Sender label for the first message in a group, when needed for clarity */}
      {isFirst && !mine && (
        <p className="ml-4 mt-[-1px] text-[10px] font-medium text-forest-400 leading-none">
          Admin
        </p>
      )}
    </li>
  )
}

type DeliveryReceiptProps = {
  status: 'sent' | 'delivered' | 'seen'
  error?: boolean
  mine: boolean
}

function DeliveryReceipt({ status, error, mine }: DeliveryReceiptProps) {
  const isMine = mine
  const base = 'flex h-3 w-3 items-center justify-center rounded-full border text-[9px] leading-none'

  if (error) {
    return (
      <span className={`${base} bg-alert-danger/10 border-alert-danger text-alert-danger`} title="Failed to send">
        <AlertCircle size={10} />
      </span>
    )
  }

  switch (status) {
    case 'sent':
      return (
        <span className={`${base} bg-forest-100 border-forest-200 text-forest-600`} title="Sent">
          <Check size={10} />
        </span>
      )
    case 'delivered':
      return (
        <span className={`${base} bg-forest-100 border-forest-200 text-forest-600`} title="Delivered">
          <Check size={10} />
          <Check size={10} className="opacity-50" />
        </span>
      )
    case 'seen':
      return (
        <span className={`${base} bg-forest-900 border-forest-900 text-white`} title="Seen">
          <CheckCircle size={10} />
        </span>
      )
  }
}
