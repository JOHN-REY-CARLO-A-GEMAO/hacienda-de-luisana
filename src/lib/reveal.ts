import { useEffect } from 'react'

/**
 * Reveal-on-scroll, re-armed whenever the caller says the page changed.
 *
 * `.reveal` starts at `opacity: 0` and only becomes visible once the observer
 * adds `.in`. The effect used to run once on mount, which was enough when the
 * homepage was the only long page: it now serves several routes, and a section
 * rendered by a *later* route change is not in the DOM when the observer is
 * created, so it would sit at `opacity: 0` forever. Passing the pathname in
 * re-observes after every navigation.
 *
 * `deps` defaults to `[]`, which keeps the old once-on-mount behaviour for a
 * caller with no route changes of its own.
 */
export function useReveal(deps: readonly unknown[] = []) {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>('.reveal')
    if (!('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('in'))
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in')
            io.unobserve(e.target)
          }
        })
      },
      { threshold: 0.12, rootMargin: '0px 0px -60px 0px' },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, deps)
}