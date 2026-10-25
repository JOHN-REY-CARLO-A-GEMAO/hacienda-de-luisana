interface FlowStepsProps {
  /** Zero-based active step. The journey is guidance; it does not change booking rules. */
  current: number
  /** Highest zero-based step that is genuinely complete. */
  completedThrough?: number
  /** A short explanation for pages that cover more than one planning step. */
  summary?: string
}

export const BOOKING_JOURNEY_STEPS = [
  { title: 'Piliin ang matutuluyan', english: 'Accommodation' },
  { title: 'Piliin ang petsa', english: 'Dates' },
  { title: 'Availability at presyo', english: 'Availability and price' },
  { title: 'Suriin ang detalye', english: 'Review' },
  { title: 'Bayad at patunay', english: 'Payment instructions' },
  { title: 'Ipadala ang booking', english: 'Submission' },
  { title: 'Approval at susunod na hakbang', english: 'Status and next steps' },
] as const

/**
 * The complete seven-part guest journey, shared by details, payment and status.
 * It is deliberately a list rather than a clickable stepper: guests cannot skip
 * required payment proof, submission or administrator approval.
 */
export function FlowSteps({
  current,
  completedThrough = current - 1,
  summary,
}: FlowStepsProps) {
  const safeCurrent = Math.min(Math.max(current, 0), BOOKING_JOURNEY_STEPS.length - 1)
  const active = BOOKING_JOURNEY_STEPS[safeCurrent]

  return (
    <nav className="flow-steps" aria-label="Mga hakbang sa booking">
      <p className="flow-steps__summary" aria-live="polite">
        {summary ?? `Hakbang ${safeCurrent + 1} sa 7: ${active.title}.`}
      </p>
      <ol className="flow-steps__list">
        {BOOKING_JOURNEY_STEPS.map((step, index) => {
          const isCurrent = index === safeCurrent
          const isComplete = index <= completedThrough
          return (
            <li
              key={step.title}
              className={`flow-steps__step${isCurrent ? ' is-current' : ''}${isComplete ? ' is-complete' : ''}`}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <span className="flow-steps__number" aria-hidden="true">
                {isComplete ? '✓' : index + 1}
              </span>
              <span className="flow-steps__copy">
                <span className="flow-steps__title">{step.title}</span>
                <span className="flow-steps__english">{step.english}</span>
                <span className="sr-only">
                  {isComplete ? 'Kumpleto na. ' : isCurrent ? 'Kasalukuyang hakbang. ' : 'Susunod na hakbang. '}
                  Hakbang {index + 1} sa 7.
                </span>
              </span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
