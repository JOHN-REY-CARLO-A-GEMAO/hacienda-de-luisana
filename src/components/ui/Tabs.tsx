export type TabItem<K extends string> = {
  key: K
  label: string
  /** Optional count or short qualifier, shown after the label. */
  meta?: string
}

/**
 * The tab strip for a page with two or three views of the same subject.
 *
 * Implemented as a real `tablist`: arrow keys move between tabs, the selected
 * tab is announced, and the underline — rather than a filled pill — keeps the
 * page title the strongest element on the screen.
 */
export function Tabs<K extends string>({
  items,
  value,
  onChange,
  label,
  className = '',
}: {
  items: readonly TabItem<K>[]
  value: K
  onChange: (key: K) => void
  /** Accessible name for the tab list, e.g. "Account sections". */
  label: string
  className?: string
}) {
  const move = (delta: number) => {
    const index = items.findIndex((item) => item.key === value)
    const next = items[(index + delta + items.length) % items.length]
    if (next) onChange(next.key)
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      className={`flex gap-1 border-b border-forest-900/10 ${className}`}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          move(1)
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault()
          move(-1)
        }
      }}
    >
      {items.map((item) => {
        const selected = item.key === value
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.key)}
            className={`relative px-4 py-3 text-sm font-medium transition-colors ${
              selected
                ? 'text-forest-900'
                : 'text-forest-700/70 hover:text-forest-900'
            }`}
          >
            {item.label}
            {item.meta && <span className="ml-1.5 text-xs text-forest-600">{item.meta}</span>}
            <span
              aria-hidden="true"
              className={`absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-forest-800 transition-transform duration-300 origin-left ${
                selected ? 'scale-x-100' : 'scale-x-0'
              }`}
            />
          </button>
        )
      })}
    </div>
  )
}
