export type LedgerTab<K extends string> = {
  key: K
  label: string
  /** Optional count, shown after the label in the display face. */
  meta?: string
}

/**
 * The two leaves of the book: the entries, and the Guest's own particulars.
 *
 * A real `tablist` — arrow keys move between tabs, Home and End jump to the
 * ends, the selected tab is announced, and `aria-selected` (never colour alone)
 * carries the state. It is drawn as a pair of index tabs on the sheet's top edge
 * rather than as a segmented pill, because on this page the switch belongs to
 * the document: the active tab is underlined in brass, the same mark the margin
 * uses for a live entry.
 */
export function LedgerTabs<K extends string>({
  items,
  value,
  onChange,
  label,
  idPrefix,
  panelId,
}: {
  items: readonly LedgerTab<K>[]
  value: K
  onChange: (key: K) => void
  /** Accessible name for the tab list, e.g. "Account sections". */
  label: string
  /** Namespace for the tabs' own ids, so two lists on one page cannot collide. */
  idPrefix: string
  /** The id of the panel these tabs control — `aria-controls` on every tab. */
  panelId: string
}) {
  const tabId = (key: K) => `${idPrefix}-tab-${key}`
  const move = (delta: number) => {
    const index = items.findIndex((item) => item.key === value)
    const next = items[(index + delta + items.length) % items.length]
    if (next) onChange(next.key)
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      className="ledger-tabs"
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          move(1)
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault()
          move(-1)
        } else if (event.key === 'Home') {
          event.preventDefault()
          const first = items[0]
          if (first) onChange(first.key)
        } else if (event.key === 'End') {
          event.preventDefault()
          const last = items[items.length - 1]
          if (last) onChange(last.key)
        }
      }}
    >
      {items.map((item) => {
        const selected = item.key === value
        return (
          <button
            key={item.key}
            id={tabId(item.key)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.key)}
            className="ledger-tab"
          >
            {item.label}
            {item.meta && <span className="ledger-tab-count guest-num">{item.meta}</span>}
          </button>
        )
      })}
    </div>
  )
}
