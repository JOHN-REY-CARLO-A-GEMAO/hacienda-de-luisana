import { useEffect, useState } from 'react'
import { cloudBookingsDB } from '../../lib/firestoreBookings'
import { describeActivity } from '../../lib/booking'

/**
 * A Booking's Activity log, in the order it happened.
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
    <div className="mt-4 rounded-2xl border border-forest-900/10 p-3.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-eyebrow text-forest-600 font-semibold">
          Activity Log
        </span>
        <span className="text-[10px] text-forest-600/70">Append-only · cannot be edited</span>
      </div>

      {failed ? (
        <p className="mt-2 text-xs text-forest-700/70">Hindi mabasa ang kasaysayan ngayon.</p>
      ) : lines.length === 0 ? (
        <p className="mt-2 text-xs text-forest-700/70">Walang nakitang pagbabago.</p>
      ) : (
        <ol className="mt-2.5 space-y-2.5">
          {lines.map((line, index) => (
            <li key={`${line.at}-${index}`} className="flex gap-2.5 text-xs">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-olive" />
              <div className="min-w-0">
                <div className="font-semibold text-forest-900 leading-snug">{line.headline}</div>
                <div className="text-[11px] text-forest-700/80">
                  {line.change} · {line.actor}
                </div>
                {line.reason ? (
                  <div className="text-[11px] text-forest-800/80 italic mt-0.5">“{line.reason}”</div>
                ) : null}
                <div className="text-[10px] text-forest-600/70 mt-0.5">{line.atLabel}</div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
