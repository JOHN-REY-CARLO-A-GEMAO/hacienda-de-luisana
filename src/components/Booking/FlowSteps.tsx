const STEPS = ['Stay details', 'Downpayment', 'Pending review'] as const

/** Where the Guest is in the booking flow. Booking is not confirmed at any of these. */
export function FlowSteps({ current }: { current: 0 | 1 | 2 }) {
  return (
    <ol className="mt-8 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-eyebrow" aria-label="Booking steps">
      {STEPS.map((label, index) => {
        const done = index < current
        const active = index === current
        return (
          <li key={label} className="flex items-center gap-2">
            {index > 0 && <span className="h-px w-6 bg-forest-900/15" aria-hidden="true" />}
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 ${
                active
                  ? 'bg-forest-800 text-cream-50'
                  : done
                    ? 'bg-forest-100 text-forest-800'
                    : 'bg-white text-forest-600 border border-forest-900/10'
              }`}
            >
              <span className="font-mono">{index + 1}</span>
              {label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
