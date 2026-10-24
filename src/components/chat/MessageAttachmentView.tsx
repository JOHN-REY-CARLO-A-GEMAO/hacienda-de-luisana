import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { readMessageAttachment, type ChatAttachment } from '../../lib/chatAttachments'
import { Close, Refresh } from '../../lib/icons'
import { useOverlay } from '../ui/overlay'

/**
 * An authenticated private image, fetched as bytes rather than a public URL.
 * The object URL exists only for this mounted component and is revoked on every
 * reload/unmount. Opening the larger view reuses those same authorized bytes.
 */
export function MessageAttachmentView({
  attachment,
  mine,
  caption,
}: {
  attachment: ChatAttachment
  mine: boolean
  caption?: string
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [viewing, setViewing] = useState(false)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const sender = mine ? 'you' : 'the Hacienda Admin'
  useOverlay(viewing, () => setViewing(false), panelRef, { initialFocus: closeRef })

  useEffect(() => {
    let active = true
    let objectUrl: string | null = null
    setUrl(null)
    setError(null)
    readMessageAttachment(attachment)
      .then((blob) => {
        if (!active) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => {
        if (active) setError('This private image could not be loaded. Check your connection and access, then retry.')
      })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [attachment, attempt])

  return (
    <>
      <div className="messages-attachment">
        {error ? (
          <div className="messages-attachment-state" role="alert">
            <span>{error}</span>
            <button type="button" className="btn-quiet btn-sm" onClick={() => setAttempt((value) => value + 1)}>
              <Refresh size={14} />
              Retry image
            </button>
          </div>
        ) : url ? (
          <button
            type="button"
            className="messages-attachment-open"
            onClick={() => setViewing(true)}
            aria-label={`View larger image from ${sender}`}
          >
            <img
              src={url}
              alt={caption ? `Image from ${sender}: ${caption}` : `Private image from ${sender}`}
              onError={() => setError('This image could not be displayed. Retry, or ask the sender to choose another file.')}
            />
            <span>View larger</span>
          </button>
        ) : (
          <div className="messages-attachment-state" role="status">
            Loading private image…
          </div>
        )}
      </div>

      {viewing && url && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={panelRef}
              tabIndex={-1}
              className="messages-image-viewer"
              role="dialog"
              aria-modal="true"
              aria-label={`Image from ${sender}`}
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) setViewing(false)
              }}
            >
              <button
                ref={closeRef}
                type="button"
                className="messages-image-viewer-close"
                onClick={() => setViewing(false)}
                aria-label="Close larger image"
              >
                <Close size={22} />
              </button>
              <figure>
                <img src={url} alt={caption ? `Image from ${sender}: ${caption}` : `Private image from ${sender}`} />
                {caption && <figcaption>{caption}</figcaption>}
              </figure>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
