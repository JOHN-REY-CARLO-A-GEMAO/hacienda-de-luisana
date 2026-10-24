import { useEffect, useId, useRef, type ReactNode } from 'react'
import { ArrowRight, Close, Paperclip, Refresh } from '../../lib/icons'
import { MESSAGE_MAX } from '../../lib/validation'
import { Alert } from '../ui'

export type ComposerAttachmentDraft = {
  name: string
  size: number
  previewUrl: string
}

export type MessageComposerProps = {
  value: string
  onChange: (value: string) => void
  onSend: (text: string) => void | Promise<void>
  onAttach: () => void
  attachment?: ComposerAttachmentDraft | null
  onRemoveAttachment?: () => void
  disabled?: boolean
  sending?: boolean
  sendStageLabel?: string | null
  error?: string | null
  onRetry?: () => void
  quickRepliesSlot?: ReactNode
  locationSlot?: ReactNode
}

export function MessageComposer({
  value,
  onChange,
  onSend,
  onAttach,
  attachment = null,
  onRemoveAttachment,
  disabled = false,
  sending = false,
  sendStageLabel = null,
  error = null,
  onRetry,
  quickRepliesSlot,
  locationSlot,
}: MessageComposerProps) {
  const inputId = useId()
  const counterId = useId()
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const trimmed = value.trim()
  const overLimit = value.length > MESSAGE_MAX
  const canSubmit =
    !disabled && !sending && !overLimit && (trimmed.length > 0 || Boolean(attachment))

  // Auto-size multiline textarea smoothly between 1 and 4 lines.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const next = Math.min(128, Math.max(48, el.scrollHeight))
    el.style.height = `${next}px`
  }, [value])

  const submit = () => {
    if (!canSubmit) return
    void onSend(value)
  }

  return (
    <form
      className="messages-composer"
      data-tour="message-composer"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      {quickRepliesSlot}

      {error && (
        <Alert
          tone="danger"
          className="mb-3 text-xs"
          actions={
            onRetry ? (
              <button
                type="button"
                className="btn-quiet btn-sm"
                disabled={sending}
                onClick={onRetry}
              >
                <Refresh size={14} />
                <span>Retry</span>
              </button>
            ) : undefined
          }
        >
          {error}
        </Alert>
      )}

      {attachment && (
        <div className="messages-attachment-preview">
          <img src={attachment.previewUrl} alt={`Selected attachment: ${attachment.name}`} />
          <div className="min-w-0 flex-1">
            <strong>{attachment.name}</strong>
            <span>
              {sendStageLabel ||
                `${Math.max(1, Math.ceil(attachment.size / 1024))} KB · Private image ready to send`}
            </span>
          </div>
          {onRemoveAttachment && (
            <button
              type="button"
              className="messages-attachment-remove"
              disabled={sending}
              onClick={onRemoveAttachment}
              aria-label="Remove attached image"
            >
              <Close size={16} />
            </button>
          )}
        </div>
      )}

      <div className="messages-composer-row items-end">
        <button
          type="button"
          className="messages-attach"
          disabled={disabled || sending}
          onClick={onAttach}
          aria-label={
            attachment
              ? 'Replace attached image (JPEG, PNG, or WebP up to 5 MB)'
              : 'Attach private image (JPEG, PNG, or WebP up to 5 MB)'
          }
          title="Attach JPEG, PNG, or WebP image (up to 5 MB)"
        >
          <Paperclip size={18} />
        </button>

        <div className="min-w-0 flex-1">
          <label htmlFor={inputId} className="sr-only">
            Message Hacienda de LuisAna
          </label>
          <textarea
            ref={textareaRef}
            id={inputId}
            rows={1}
            value={value}
            disabled={disabled || sending}
            maxLength={MESSAGE_MAX}
            data-tour-field="message"
            aria-describedby={counterId}
            aria-invalid={overLimit ? 'true' : undefined}
            placeholder={
              attachment
                ? 'Add an optional caption…'
                : 'Write a message to Hacienda de LuisAna…'
            }
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                submit()
              }
            }}
            className="block min-h-[3rem] w-full resize-none rounded-[12px] border border-forest-900/15 bg-cream-50/70 px-3.5 py-3 text-sm leading-relaxed text-forest-900 placeholder:text-forest-600/60 focus:border-forest-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brass-400/40 disabled:cursor-not-allowed disabled:opacity-55 dark:border-cream-100/15 dark:bg-forest-950/50 dark:text-cream-50 dark:placeholder:text-sage-400"
          />
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className="btn-primary messages-send"
          aria-label={sending ? sendStageLabel || 'Sending message' : 'Send message'}
        >
          <span>{sending ? 'Sending…' : 'Send'}</span>
          {!sending && <ArrowRight size={15} className="hidden sm:inline" />}
        </button>
      </div>

      <div className="messages-composer-meta flex-wrap">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-forest-600 dark:text-sage-400">
            Enter to send · Shift+Enter for new line · Private JPEG/PNG/WebP up to 5 MB
          </span>
          {locationSlot}
        </div>
        <span
          id={counterId}
          className={`tabular-nums ${
            value.length >= MESSAGE_MAX
              ? 'font-semibold text-brass-600'
              : 'text-forest-600 dark:text-sage-400'
          }`}
        >
          {value.length}/{MESSAGE_MAX}
        </span>
      </div>
    </form>
  )
}
