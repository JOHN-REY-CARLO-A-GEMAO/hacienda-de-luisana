import { STAY_STAGES, stageIndex } from './stayFacts'

/**
 * Where a Booking is in its life, as one line.
 *
 * A Guest is never waiting to find out which of twelve canonical statuses they
 * are in; they are waiting on one of five answers. This draws those five and
 * marks the one the Booking is sitting on in brass. The sentence that says what
 * the stage means is the entry's own line above the fold — not repeated here,
 * because on a closed booking the track has nothing to add and on an open one
 * the Guest has already read it.
 *
 * A Booking that ended without a stay is not drawn at all: "stage 0 of 5" would
 * tell a Guest a cancelled request is still moving.
 */
export function StatusTrack({ status }: { status: string }) {
  const stage = stageIndex(status)
  if (stage === null) return null

  return (
    <div
      className="ledger-track"
      role="img"
      aria-label={`Booking stage: ${STAY_STAGES[stage]} of ${STAY_STAGES.length}`}
    >
      {STAY_STAGES.map((name, index) => {
        const done = index < stage
        const now = index === stage
        return (
          <div key={name} className="ledger-track-step" data-done={done || undefined} data-now={now || undefined}>
            <span className="ledger-track-bar" data-done={done || undefined} data-now={now || undefined} aria-hidden="true" />
            <span className="ledger-track-name">{name}</span>
          </div>
        )
      })}
    </div>
  )
}
