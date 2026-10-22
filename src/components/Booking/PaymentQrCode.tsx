import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * The one way a payment QR code reaches a Guest: the image the owner supplied,
 * sized to scan, with a way to enlarge it and a way to open it full-size.
 *
 * Nothing here checks or confirms a payment — a QR code is how the Guest sends
 * money outside the system; the Admin still verifies the uploaded proof
 * (ADR-0012). The image is not drawn, generated or re-encoded: `src` is the
 * asset path from `site_config/payment` or `OFFICIAL_PAYMENT_INFORMATION`.
 */
export function PaymentQrCode({
  src,
  method,
  instruction,
}: {
  src: string
  method: string
  instruction: string
}) {
  const [enlarged, setEnlarged] = useState(false)
  const closeButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!enlarged) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEnlarged(false)
    }
    document.addEventListener('keydown', onKey)
    closeButton.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [enlarged])

  const alt = `${method} QR code — ${instruction}`

  return (
    <div className="mt-2 rounded-lg border border-forest-900/10 bg-white px-3 py-3">
      <div className="flex flex-col items-center gap-2 sm:flex-row sm:items-start sm:gap-4">
        {/* Shown at the asset's own 281 px whenever the card is wide enough, so
            no resampling happens at all. This code is dense (69×69 modules): a
            version measured at ~180 px or smaller no longer decodes on a
            scanner, so the image is never laid out below that — the card gives
            it the full panel width, and the enlarged view takes it to ~420 px. */}
        <img
          src={src}
          alt={alt}
          width={281}
          height={281}
          className="h-auto w-full max-w-[281px] shrink-0 rounded-md bg-white"
        />
        <div className="text-center sm:text-left">
          <p className="font-medium text-forest-900">{instruction}</p>
          <p className="mt-1 text-[11px] text-forest-700/70 leading-relaxed">
            In GCash, tap Scan QR and point the camera at this code from another phone. If you are
            scanning the screen you are paying from, enlarge the code first — or open the image and
            scan that. Transfer fees may apply.
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-3 sm:justify-start">
            <button
              type="button"
              onClick={() => setEnlarged(true)}
              className="rounded-lg border border-forest-900/20 px-3 py-1.5 text-[11px] font-medium text-forest-800 hover:bg-cream-100"
            >
              Enlarge QR code
            </button>
            <a
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] underline underline-offset-2 text-forest-800 hover:text-forest-900"
            >
              Open image
            </a>
          </div>
        </div>
      </div>

      {enlarged && createPortal(
        <div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-forest-950/80 p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`${method} QR code, enlarged`}
          onClick={() => setEnlarged(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-3 shadow-depth sm:p-4"
            onClick={(event) => event.stopPropagation()}
          >
            {/* Scaled up, never re-encoded: nearest-neighbour keeps every
                module a whole block, which is what a scanner wants. */}
            <img
              src={src}
              alt={alt}
              width={281}
              height={281}
              className="mx-auto h-auto w-full max-w-[420px] rounded-lg bg-white [image-rendering:pixelated]"
            />
            <p className="mt-3 text-center text-xs font-medium text-forest-900">{instruction}</p>
            <div className="mt-3 flex items-center justify-center gap-3">
              <a
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs underline underline-offset-2 text-forest-800"
              >
                Open image in a new tab
              </a>
              <button
                ref={closeButton}
                type="button"
                onClick={() => setEnlarged(false)}
                className="rounded-lg bg-forest-800 px-3 py-1.5 text-xs font-medium text-cream-50 hover:bg-forest-900"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
