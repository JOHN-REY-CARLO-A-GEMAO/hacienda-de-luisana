import { useCallback, useRef, useState } from 'react'
import { Paperclip, Refresh, Navigation } from '../../lib/icons'
import { MESSAGE_MAX } from '../../lib/validation'

/**
 * The message composer at the bottom of the chat: attachment button, multiline
 * text input, send button, with disabled/loading states and keyboard
 * submission (Enter to send, Shift+Enter for newline).
 */
export type MessageComposerProps = {
  disabled?: boolean
  sending: boolean
  value: string
  onChange: (value: string) => void
  onSend: (text: string) => Promise<void> | void
  onAttach: () => void
  attachment?: { name: string; size: number; previewUrl: string } | null
  onRemoveAttachment: () => void
  onRetry?: () => void
  sendError?: string | null
}

export function MessageComposer({
  disabled = false,
  sending,
  value,
  onChange,
  onSend,
  onAttach,
  attachment,
  onRemoveAttachment,
  onRetry,
  sendError,
}: MessageComposerProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [showError, setShowError] = useState(false)

  const handleSend = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      void onSend(value)
    },
    [value, onSend],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault()
        void onSend(value)
      }
    },
    [value, onSend],
  )

  const handleAttach = () => {
    setShowError(false)
    onAttach()
  }

  const canSend =
    !disabled && !sending && (value.trim().length > 0 || Boolean(attachment))

  return (
    <form
      className="flex flex-col gap-2 pt-2 pb-4 px-4 border-t border-card-surface bg-white"
      onSubmit={handleSend}
    >
      {attachment && (
        <div className="flex items-start gap-2 rounded-lg bg-forest-50 border border-forest-100 p-2">
          <img
            src={attachment.previewUrl}
            alt="Selected attachment preview"
            className="h-10 w-10 rounded-md object-cover"
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-forest-900 truncate">
              {attachment.name}
            </p>
            <p className="text-[10px] text-forest-500 truncate">
              {Math.max(1, Math.ceil(attachment.size / 1024))} KB · {sending ? 'Sending…' : 'Ready to send'}
            </p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-md text-forest-600 hover:bg-forest-100 transition-colors"
            onClick={onRemoveAttachment}
            disabled={sending}
            aria-label="Remove attached image"
          >
            <Refresh size={14} />
          </button>
        </div>
      )}

      {sendError && showError && (
        <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-alert-danger/50 border border-alert-danger/50 text-[11px] text-alert-danger">
          <AlertCircle size={12} className="shrink-0" />
          <span>{sendError}</span>
          {onRetry && (
            <button
              type="button"
              className="ml-auto underline underline-offset-2 hover:text-alert-danger/90"
              onClick={() => {
                setShowError(false)
                void onRetry()
              }}
            >
              Retry
            </button>
          )}
        </div>
      )}

      <div className="flex items-end gap-2">
        <button
          type="button"
          className="shrink-0 flex h-10 w-10 items-center justify-center rounded-lg border border-card-surface text-forest-600 hover:bg-forest-50 transition-colors"
          disabled={disabled || sending}
          onClick={handleAttach}
          aria-label={attachment ? 'Replace attachment' : 'Attach image'}
          title={attachment ? 'Replace attachment' : 'Attach JPEG, PNG, or WebP image (5 MB max)'}
        >
          <Paperclip size={18} />
        </button>

        <textarea
          ref={inputRef}
          className="flex-1 resize-none min-h-[44px] max-h-[200px] px-4 py-2.5 rounded-xl border border-card-surface text-forest-900 focus:ring-1 focus:ring-forest-600 focus:border-transparent transition-colors"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? 'Waiting for the conversation…' : 'Write a message…'}
          disabled={disabled || sending}
          maxLength={MESSAGE_MAX}
          aria-label="Write a message"
          data-tour-field="message"
          spellCheck={false}
          autoComplete="off"
        />

        <button
          type="submit"
          disabled={!canSend}
          className={`shrink-0 flex h-10 w-10 items-center justify-center rounded-xl text-white font-medium shadow-sm transition-colors
            ${!canSend
              ? 'bg-forest-300 cursor-not-allowed'
              : 'bg-forest-900 hover:bg-forest-800'}
          `}
          aria-label={sending ? 'Sending…' : 'Send message'}
        >
          {sending ? (
            <svg className="h-5 w-5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 2 5.373 2 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          ) : (
            <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          )}
        </button>
      </div>

      <div className="flex justify-between px-2">
        <span className="text-[10px] text-forest-400">
          {attachment ? 'JPEG, PNG, or WebP · 5 MB max' : 'Enter to send'}
        </span>
        <span
          id="message-character-count"
          className={`text-[10px] font-mono tabular-nums ${
            value.length >= MESSAGE_MAX
              ? 'text-amber-700 dark:text-amber-400 font-semibold'
              : value.length >= MESSAGE_MAX * 0.9
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-forest-400'
          }`}
          aria-live="polite"
        >
          {value.length}/{MESSAGE_MAX}
        </span>
      </div>
    </form>
  )
}

function AlertCircle({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}
