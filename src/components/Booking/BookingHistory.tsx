import { useEffect, useState } from 'react'
import { cloudBookingsDB } from '../../lib/firestoreBookings'
import { describeActivity } from '../../lib/booking'
import { renderSafeText } from '../../lib/renderSafeText'
import { formatDateTime } from '../../lib/formatDate'

/**
 * A Booking's Activity log, in the order it happened.
 *
 * Drawn as a spine rather than a list of bullets, because this content really is
 * a sequence and the shape should say so: the newest entry sits at the top in
 * brass — the one a Guest came back to the page to find — and the entries under
 * it fall away on the same line. Before, every entry was the same olive dot at
 * the same weight, so the one thing worth reading had to be found by scanning.
 *
 * Read-only by construction: there is no control here to edit or delete an
 * entry, the interface behind it offers neither, and the Firestore rules deny
 * both to everyone including the owner. An audit record that can be edited is
 * not an audit record.
 */
export function BookingHistory({ bookingId }: { bookingId: string }) {
  const [lines, setLines] = useState<ReturnType<typeof describeActivity>[]>([])
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    cloudBookingsDB
      .history(bookingId)
      .then((entries) => {
        if (alive) setLines(entries.map(describeActivity))
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [bookingId])

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className="font-serif text-[18px] font-medium leading-snug text-forest-900 dark:text-cream-50">Activity</h4>
        <p className="text-[11px] leading-tight text-forest-600/90 dark:text-sage-400">
          Append-only. Nobody can edit this, including the Hacienda.
        </p>
      </div>

      {failed ? (
        <p className="mt-3 text-xs text-forest-700/80 dark:text-cream-100/70">
          The activity log could not be read right now. Your booking is unchanged — try again in a
          moment.
        </p>
      ) : lines.length === 0 ? (
        <p className="mt-3 text-xs text-forest-700/80 dark:text-cream-100/70">
          Nothing has happened on this booking yet. The Hacienda&rsquo;s first decision will appear
          here.
        </p>
      ) : (
        <ol className="guest-spine mt-4">
          {lines.map((line, index) => (
            <li key={`${line.at}-${index}`} className="guest-spine-item">
              <span
                className="guest-spine-node"
                data-current={index === 0 ? 'true' : undefined}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-[13px] font-medium leading-snug text-forest-900 dark:text-cream-50">
                  {renderSafeText(line.headline)}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-forest-700/85 dark:text-cream-100/70">
                  {renderSafeText(line.change)}
                  <span className="text-forest-600/90 dark:text-sage-400">
                    {' '}
                    · {renderSafeText(line.actor)}
                  </span>
                </p>
                {line.reason ? (
                  <p className="mt-1 border-l-2 border-brass-400/50 pl-2.5 text-xs italic leading-relaxed text-forest-800/85 dark:text-cream-100/75">
                    {renderSafeText(line.reason)}
                  </p>
                ) : null}
                <p className="guest-num mt-1 text-[11px] text-forest-600/90 dark:text-sage-400">
                  {renderSafeText(formatDateTime(line.at, line.atLabel))}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
