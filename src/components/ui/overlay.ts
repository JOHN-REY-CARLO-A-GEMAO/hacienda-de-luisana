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
 *
 * Two overlays do not fit that shape exactly and say so with an option:
 *
 * * `lockScroll: false` — the Guest tour scrolls the page itself to bring each
 *   highlighted control into view. Locking the body would strand it.
 * * `scope` — an element outside the panel that *is* part of the dialog's
 *   interaction surface: the tour's spotlighted control. Tab reaches it, and
 *   still cannot reach anything else on the page.
 */

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * True when the element is actually rendered.
 *
 * The old filter only looked for the `hidden` attribute, so a control hidden by
 * a responsive class — the lightbox's `md:hidden` Prev/Next on a desktop screen
 * — was counted as the last item in the dialog. Tab then never matched the
 * "last" check and the browser carried focus into the page behind the scrim.
 * Walking the ancestors for `display: none` / `visibility: hidden` is what the
 * browser itself does when it decides a control is skippable.
 *
 * In jsdom (where no stylesheet is loaded) nothing computes to `display: none`,
 * so every element counts as rendered — the same answer the browser gives at
 * the widths those tests exercise.
 */
function isRendered(el: HTMLElement): boolean {
  if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return false
  for (let node: HTMLElement | null = el; node && node !== document.body; node = node.parentElement) {
    const style = window.getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
      return false
    }
  }
  return true
}

/**
 * Every rendered, focusable control in the given roots, in tab order.
 *
 * A root may itself be the control (the tour's highlighted button), so it is
 * checked before its descendants. Duplicates are dropped: an overlay that
 * points `scope` at a control already inside the panel must not see it twice.
 */
export function overlayFocusables(
  ...roots: Array<HTMLElement | null | undefined>
): HTMLElement[] {
  const found: HTMLElement[] = []
  const push = (el: HTMLElement) => {
    if (!found.includes(el) && isRendered(el)) found.push(el)
  }
  for (const root of roots) {
    if (!root) continue
    if (root.matches(FOCUSABLE)) push(root)
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))) push(el)
  }
  return found
}

export type OverlayOptions = {
  /** The control to land on when the overlay opens. Defaults to the first. */
  initialFocus?: RefObject<HTMLElement | null>
  /** Keep the page scrollable behind the overlay (the Guest tour needs it). */
  lockScroll?: boolean
  /** An element outside the panel that belongs to the dialog's focus order. */
  scope?: RefObject<HTMLElement | null>
}

export function useOverlay(
  open: boolean,
  onClose: () => void,
  panel: RefObject<HTMLDivElement | null>,
  { initialFocus, lockScroll = true, scope }: OverlayOptions = {},
) {
  const restoreTo = useRef<HTMLElement | null>(null)

  // Entering and leaving the overlay is the only thing that moves focus. Read
  // through refs so a re-render that hands over a new `onClose` (the tour's
  // callback changes with every step) never re-runs this and steals focus back.
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    if (document.activeElement instanceof HTMLElement) restoreTo.current = document.activeElement

    if (lockScroll) document.body.dataset.scrollLocked = 'true'

    const focusTarget = () =>
      initialFocus?.current ??
      overlayFocusables(panel.current, scope?.current)[0] ??
      panel.current

    // The panel is already in the DOM when the effect runs, so it can take focus
    // straight away — a dialog that waits a frame leaves the reader on the page
    // behind. The deferred retry is for a panel whose first control is rendered
    // behind a promise (the invoice modal), and is skipped when focus already
    // landed inside.
    focusTarget()?.focus()
    const focusTimer = window.setTimeout(() => {
      const roots = [panel.current, scope?.current]
      if (roots.some((root) => root?.contains(document.activeElement))) return
      focusTarget()?.focus()
    }, 0)

    return () => {
      window.clearTimeout(focusTimer)
      if (lockScroll) delete document.body.dataset.scrollLocked
      restoreTo.current?.focus?.()
      restoreTo.current = null
    }
    // `initialFocus`, `scope` and `lockScroll` are refs/booleans read at open
    // time on purpose: re-running this on any of them would re-focus a panel
    // the reader is already using.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lockScroll])

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = overlayFocusables(panel.current, scope?.current)
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      const index = active instanceof HTMLElement ? focusable.indexOf(active) : -1

      // Focus has slipped out of the dialog (an element it held was replaced,
      // or the reader clicked the scrim): the next Tab comes back in rather
      // than wandering through the page behind.
      if (index === -1) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
        return
      }
      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, panel, scope])
}
