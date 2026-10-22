import { useEffect, useRef, type RefObject } from 'react'

/**
 * The behaviour every overlay in the site shares, written once.
 *
 * Three surfaces need the same contract — the notification drawer, the invoice
 * modal and the confirmation prompt — and each used to implement its own copy:
 * one handled Escape, one did not; one locked the page behind it, one did not;
 * all three restored focus differently. The rules are now:
 *
 * * Escape closes (and never falls through to the page behind).
 * * Focus moves into the panel when it opens, and returns to the control that
 *   opened it when it closes.
 * * Tab and Shift+Tab cycle within the panel; nothing behind is reachable.
 * * The document behind stops scrolling, and is released even if the panel is
 *   unmounted while still open.
 *
 * `initialFocus` names the element to land on first. Left out, the first
 * focusable element in the panel is used — which is right for a drawer or a
 * dialog whose content comes first. A confirmation prompt passes its confirm
 * button so Enter acts on the action the person just chose.
 */
export function useOverlay(
  open: boolean,
  onClose: () => void,
  panel: RefObject<HTMLDivElement | null>,
  { initialFocus }: { initialFocus?: RefObject<HTMLElement | null> } = {},
) {
  const restoreTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    if (document.activeElement instanceof HTMLElement) restoreTo.current = document.activeElement

    document.body.dataset.scrollLocked = 'true'

    const focusTarget = () =>
      initialFocus?.current ??
      panel.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ) ??
      panel.current

    // The panel is already in the DOM when the effect runs, so it can take focus
    // straight away — a dialog that waits a frame leaves the reader on the page
    // behind. The deferred retry is for a panel whose first control is rendered
    // behind a promise (the invoice modal), and is skipped when focus already
    // landed inside.
    focusTarget()?.focus()
    const focusTimer = window.setTimeout(() => {
      if (panel.current?.contains(document.activeElement)) return
      focusTarget()?.focus()
    }, 0)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !panel.current) return
      const focusable = Array.from(
        panel.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter(
        // `offsetParent`/rects are unavailable in jsdom and unreliable inside a
        // fixed-position panel, so hidden controls are excluded by intent:
        // nothing in an overlay is marked hidden or aria-hidden.
        (element) =>
          !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true',
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      window.removeEventListener('keydown', onKeyDown)
      delete document.body.dataset.scrollLocked
      restoreTo.current?.focus?.()
    }
  }, [open, onClose, panel, initialFocus])
}
