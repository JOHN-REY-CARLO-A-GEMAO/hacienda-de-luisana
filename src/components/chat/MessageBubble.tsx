import type { ChatMessage } from '../../lib/chatCloud'
import { MessageAttachmentView } from './MessageAttachmentView'

export type DeliveryStatus = 'sending' | 'sent' | 'seen' | 'local' | null

export type MessageBubbleProps = {
  message: ChatMessage
  showSenderLabel?: boolean
  senderName?: string
  showTimestamp?: boolean
  deliveryStatus?: DeliveryStatus
}

function formatBubbleTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('en-PH', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function deliveryLabel(status: DeliveryStatus): string | null {
  switch (status) {
    case 'sending':
      return 'Sending…'
    case 'seen':
      return 'Seen'
    case 'sent':
      return 'Sent'
    case 'local':
      return 'Saved locally'
    default:
      return null
  }
}

export function MessageBubble({
  message,
  showSenderLabel = false,
  senderName,
  showTimestamp = true,
  deliveryStatus = null,
}: MessageBubbleProps) {
  const isMine = message.mine
  const hasAttachment = Boolean(message.attachment)
  const hasText = message.text.trim().length > 0
  const timeText = formatBubbleTime(message.at)
  const statusWord = isMine ? deliveryLabel(deliveryStatus) : null

  return (
    <li className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
      {showSenderLabel && (
        <span className="messages-sender">
          {senderName || (isMine ? 'You' : 'Hacienda Admin')}
        </span>
      )}

      <div
        className={`messages-bubble ${
          isMine ? 'guest-bubble-mine' : 'guest-bubble-theirs'
        } ${hasAttachment ? 'messages-bubble-has-attachment' : ''}`}
      >
        {message.attachment && (
          <MessageAttachmentView
            attachment={message.attachment}
            mine={isMine}
            caption={hasText ? message.text : undefined}
          />
        )}
        {hasText && <span className="messages-message-text">{message.text}</span>}
      </div>

      {(showTimestamp || statusWord) && (
        <span className="messages-time">
          {timeText && <time dateTime={message.at}>{timeText}</time>}
          {timeText && statusWord ? ' · ' : ''}
          {statusWord && <span className="font-medium">{statusWord}</span>}
        </span>
      )}
    </li>
  )
}
