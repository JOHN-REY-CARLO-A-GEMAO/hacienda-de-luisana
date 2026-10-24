export type TabItem<K extends string> = {
  key: K
  label: string
  /** Optional count or short qualifier, shown after the label. */
  meta?: string
}

/**
 * The switch between the two or three views a page has of the same subject.
 *
 * A real `tablist`: arrow keys move between tabs, the selected tab is
 * announced, and `aria-selected` — not colour alone — carries the state.
 *
 * It is a segmented control rather than an underlined strip. The underline read
 * as a page-level divider under the header, which is a claim this control does
 * not make: it switches the content below it, and it sits inside a ruled
 * document. One rule runs along the bottom of the group, so the switch belongs
 * to the panel it controls instead of splitting the page in two.
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
      className={`no-scrollbar -mx-1 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-forest-900/10 bg-cream-100/70 p-1 dark:border-cream-100/12 dark:bg-forest-900/60 ${className}`}
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
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-forest-600 focus-visible:ring-offset-2 focus-visible:ring-offset-cream-50 dark:focus-visible:ring-brass-400 dark:focus-visible:ring-offset-forest-950 ${
              selected
                ? 'bg-forest-800 text-cream-50 shadow-[0_1px_2px_rgba(21,36,27,0.18)] dark:bg-brass-400 dark:text-forest-950'
                : 'text-forest-700 hover:bg-white/70 hover:text-forest-900 dark:text-cream-100/80 dark:hover:bg-forest-800/60 dark:hover:text-cream-50'
            }`}
          >
            {item.label}
            {item.meta && (
              <span
                className={`guest-num text-xs ${
                  selected ? 'text-cream-100/80 dark:text-forest-950/70' : 'text-forest-600 dark:text-sage-400'
                }`}
              >
                {item.meta}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
