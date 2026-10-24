import { STAY_STAGES, stageIndex } from './stayFacts'
import { statusMeaning } from '../ui'

/**
 * Where a Booking is in its life, as one line.
 *
 * A Guest is never waiting to find out which of twelve canonical statuses they
 * are in; they are waiting on one of five answers. This draws those five, marks
 * the one the Booking is sitting on in brass, and says in a sentence what
 * happens next — which is the part a bare status word never carries.
 *
 * A Booking that ended without a stay is not drawn as "stage 0 of 5". That would
 * tell a Guest a cancelled request is still moving, so those get the sentence
 * and no track.
 */
export function StatusTrack({ status }: { status: string }) {
  const stage = stageIndex(status)

  if (stage === null) {
    return (
      <p className="text-sm leading-relaxed text-forest-800 dark:text-cream-100/85">
        {statusMeaning(status)}
      </p>
    )
  }

  return (
    <div>
      <div className="guest-track" role="img" aria-label={`Booking stage: ${STAY_STAGES[stage]} of ${STAY_STAGES.length}`}>
        {STAY_STAGES.map((name, index) => {
          const done = index < stage
          const now = index === stage
          return (
            <div
              key={name}
              className="guest-track-step"
              data-done={done || undefined}
              data-now={now || undefined}
            >
              <span className="guest-track-bar" data-done={done || undefined} data-now={now || undefined} aria-hidden="true" />
              <span className="guest-track-name">{name}</span>
            </div>
          )
        })}
      </div>
      <p className="mt-3.5 text-sm leading-relaxed text-forest-800 dark:text-cream-100/85">
        {statusMeaning(status)}
      </p>
    </div>
  )
}
