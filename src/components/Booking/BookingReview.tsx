import { useState } from 'react'
import { ACCOMMODATIONS } from '../../config/site'
import { cloudBookingsDB } from '../../lib/firestoreBookings'
import {
  effectiveStatus,
  findDateConflicts,
  normalizeKycStatus,
  suggestAlternativeDates,
  unitsForAccommodation,
  type Actor,
  type DateRange,
  type HoldBearingBooking,
} from '../../lib/booking'
import type { Booking } from '../../lib/storage'
import { ROLE_LABELS, can, isRole } from '../../lib/auth'

/**
 * A conflicting Booking as the Host reads it. The lifecycle knows dates and
 * statuses but deliberately not people, so the name is joined back from what is
 * stored rather than pushed into the module.
 */
type Clash = HoldBearingBooking & { guest_name?: string }

/**
 * The Host's review of one Booking: read the ID, then approve it or refuse it.
 *
 * Every button here goes through the lifecycle (`cloudBookingsDB.transition`),
 * never a bare status write. That is the point of ticket #13 — the approval gate
 * re-checks the dates against what is actually stored, so a clash *refuses* the
 * approval instead of trusting the Host's eyeball, and the refusal comes back
 * with somewhere else to offer the Guest (spec #9 §2, ADR-0003).
 */
export function BookingReview({
  booking,
  bookings,
  actor,
  onDone,
}: {
  booking: Booking
  /** Everything stored, so the re-check counts the same Bookings the Guest's check did. */
  bookings: Booking[]
  actor?: Actor
  /** Called after a decision lands, so the caller can refresh or close. */
  onDone?: (message: string) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)
  const [clash, setClash] = useState<{ conflicts: Clash[]; alternatives: DateRange[] } | null>(null)
  const [reasonFor, setReasonFor] = useState<'RejectKyc' | 'Reject' | null>(null)
  const [reason, setReason] = useState('')

  const status = effectiveStatus(booking)
  const kyc = normalizeKycStatus(booking.kyc_status)
  const host = actor ?? { actor: 'host', actor_id: 'host', actor_name: 'Host' }
  const unitsAvailable = unitsForAccommodation(booking.accommodation, ACCOMMODATIONS)

  // The panel reads its own actor's role, so a Staff session handed this component
  // gets the read-only version of it without the caller having to remember: the
  // buttons that would be refused by `applyAction` are never offered, and a
  // government ID is never shown to a role storage.rules would refuse it to.
  const role = isRole(host.actor) ? host.actor : null
  const mayReview = can(role, 'bookings:review')
  const mayReadKyc = can(role, 'kyc:read')

  // A preview with the gate's own parameters, so it cannot drift from what
  // approval will actually do: the Host sees the clash before pressing, and the
  // button still refuses if the dates go between the look and the click.
  const datesAlreadyGone =
    kyc === 'submitted' &&
    findDateConflicts(booking, bookings, {
      unitsAvailable,
      excludeId: booking.id,
      forApproval: true,
    })

  const decide = async (label: string, action: Parameters<typeof cloudBookingsDB.transition>[1]) => {
    setBusy(label)
    setNotice(null)
    setClash(null)
    try {
      const result = await cloudBookingsDB.transition(booking.id, action, host)
      if (result.ok) {
        setReasonFor(null)
        setReason('')
        setNotice({ tone: 'good', text: `${label} — the Booking is now ${result.patch.status ?? booking.status}.` })
        onDone?.(label)
        return
      }
      // Refused. A clash is the one refusal worth answering with dates rather
      // than an apology: the Guest still wants to come, just not then.
      if (result.conflicts && result.conflicts.length > 0) {
        setClash({
          conflicts: result.conflicts.map((conflict) => {
            const stored = bookings.find((b) => b.id === conflict.id)
            return stored ? { ...conflict, guest_name: stored.guest_name } : conflict
          }),
          alternatives: suggestAlternativeDates(booking, bookings, { unitsAvailable, limit: 3 }),
        })
      }
      setNotice({ tone: 'bad', text: result.reason })
    } catch (e) {
      // A write that never reached Firestore (permissions, connection) must not
      // look like a decision that was made.
      console.warn('[BookingReview] decision failed', e)
      setNotice({
        tone: 'bad',
        text: 'That did not save — the booking is unchanged. Check the connection and try again.',
      })
    } finally {
      setBusy(null)
    }
  }

  const refuseWithReason = (kind: 'RejectKyc' | 'Reject') => {
    const trimmed = reason.trim()
    if (!trimmed) {
      setNotice({
        tone: 'bad',
        text:
          kind === 'RejectKyc'
            ? 'Say what is wrong with the ID — the Guest cannot send the right one otherwise.'
            : 'Say why the Booking is refused — the Guest reads this.',
      })
      return
    }
    void decide(kind === 'RejectKyc' ? 'ID refused' : 'Booking refused', { type: kind, reason: trimmed })
  }

  return (
    <div className="rounded-2xl border border-forest-900/10 bg-cream-50/60 p-4">
      <div className="text-[10px] uppercase tracking-eyebrow text-forest-600 font-semibold">
        {mayReview ? 'Host review' : `${role ? ROLE_LABELS[role] : 'Read-only'} view`} · {status}
      </div>

      {!mayReview && (
        <p className="mt-2 text-xs text-forest-700/80 leading-relaxed">
          Only the Host approves or refuses a Booking, verifies a payment or reads a government ID. What you can do
          here is read the request — and mark a cleaned stay Complete from the Bookings list.
        </p>
      )}

      {/* The documents. A government ID is only reviewable if it can be seen. */}
      <div className="mt-3">
        {booking.kyc_id_url && mayReadKyc ? (
          <div className="flex flex-wrap gap-3">
            <KycImage label="Government ID" url={booking.kyc_id_url} />
            {booking.kyc_receipt_url && <KycImage label="Receipt" url={booking.kyc_receipt_url} />}
          </div>
        ) : booking.kyc_id_url ? (
          <p className="text-xs text-forest-700/80 leading-relaxed">
            A government ID is on file. It is the Host who reads it.
          </p>
        ) : (
          <p className="text-xs text-forest-700/80 leading-relaxed">
            No government ID uploaded yet. The Guest sends it from their own account page
            (or the mobile app) before this Booking can be approved.
          </p>
        )}
      </div>

      {mayReview && datesAlreadyGone && (
        <p className="mt-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-xl px-3 py-2 leading-relaxed">
          These dates are already committed to {datesAlreadyGone.length} other{' '}
          {datesAlreadyGone.length === 1 ? 'Booking' : 'Bookings'}, so approval will be refused.
          Message the Guest about other dates first.
        </p>
      )}

      {kyc === 'rejected' && booking.kyc_reject_reason && (
        <p className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          ID refused — the Guest was told: “{booking.kyc_reject_reason}”. Their dates stay held while
          they send another.
        </p>
      )}

      {/* Decisions the lifecycle will accept from this status, from this role. */}
      {mayReview && <div className="mt-4 flex flex-wrap gap-2">
        {status === 'Pending' && kyc !== 'submitted' && (
          <span className="text-xs text-forest-700/70 self-center">
            Waiting on the Guest's ID. You can refuse the Booking outright below.
          </span>
        )}

        {kyc === 'submitted' && status === 'KYC Submitted' && (
          <>
            <button
              onClick={() =>
                void decide('Approved', {
                  type: 'Approve',
                  availability: { unitsAvailable, bookings },
                })
              }
              disabled={busy !== null}
              className="px-3 py-2 rounded-xl text-xs font-medium bg-emerald-700 hover:bg-emerald-800 text-white transition disabled:opacity-50"
            >
              {busy === 'Approved' ? 'Checking dates…' : 'Approve & hold dates'}
            </button>
            <button
              onClick={() => setReasonFor(reasonFor === 'RejectKyc' ? null : 'RejectKyc')}
              disabled={busy !== null}
              className="px-3 py-2 rounded-xl text-xs bg-amber-100 text-amber-900 border border-amber-200 hover:bg-amber-200 transition disabled:opacity-50"
            >
              ID not acceptable
            </button>
          </>
        )}

        {!['Cancelled', 'Rejected', 'Completed', 'Expired'].includes(status) && (
          <button
            onClick={() => setReasonFor(reasonFor === 'Reject' ? null : 'Reject')}
            disabled={busy !== null}
            className="px-3 py-2 rounded-xl text-xs bg-white border border-red-200 text-red-700 hover:bg-red-50 transition disabled:opacity-50"
          >
            Refuse booking
          </button>
        )}
      </div>}

      {mayReview && reasonFor && (
        <div className="mt-3">
          <label className="block text-[10px] uppercase tracking-eyebrow text-forest-600 font-semibold mb-1">
            {reasonFor === 'RejectKyc'
              ? 'What is wrong with the ID? The Guest reads this and keeps their dates.'
              : 'Why is this Booking refused? The dates go back to other guests.'}
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder={
              reasonFor === 'RejectKyc'
                ? 'e.g. The photo is cut off — please resend showing the full ID.'
                : 'e.g. We cannot host these dates; the Main House is already taken.'
            }
            className="w-full text-xs rounded-xl border border-forest-900/15 bg-white px-3 py-2 text-forest-900 focus:outline-none focus:ring-2 focus:ring-forest-700/30"
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => refuseWithReason(reasonFor)}
              disabled={busy !== null}
              className="px-3 py-2 rounded-xl text-xs font-medium bg-forest-800 text-cream-50 hover:bg-forest-900 transition disabled:opacity-50"
            >
              {busy !== null ? 'Saving…' : reasonFor === 'RejectKyc' ? 'Refuse this ID' : 'Refuse this booking'}
            </button>
            <button
              onClick={() => {
                setReasonFor(null)
                setReason('')
              }}
              className="px-3 py-2 rounded-xl text-xs text-forest-700 hover:bg-cream-100 transition"
            >
              Never mind
            </button>
          </div>
        </div>
      )}

      {notice && (
        <p
          className={`mt-3 text-xs rounded-xl px-3 py-2 leading-relaxed border ${
            notice.tone === 'good'
              ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
              : 'bg-red-50 text-red-800 border-red-200'
          }`}
        >
          {notice.text}
        </p>
      )}

      {/* The clash path: refused, and here is somewhere else instead. */}
      {clash && (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50/70 px-3 py-3 text-xs text-red-900">
          <strong className="block">Those dates are gone.</strong>
          <span className="block mt-1 text-red-800/90">
            Approval was refused because {clash.conflicts.length} other{' '}
            {clash.conflicts.length === 1 ? 'booking has' : 'bookings have'} already committed to
            overlapping dates:
          </span>
          <ul className="mt-1.5 list-disc pl-5 space-y-0.5 text-red-800/90">
            {clash.conflicts.map((c) => (
              <li key={c.id}>
                {c.guest_name || 'A guest'} · {c.check_in} → {c.check_out} · {c.status}
              </li>
            ))}
          </ul>
          {clash.alternatives.length > 0 ? (
            <>
              <span className="block mt-2 font-medium text-red-900">
                Offer the Guest one of these instead — same length, genuinely free:
              </span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {clash.alternatives.map((a) => (
                  <span
                    key={`${a.check_in}-${a.check_out}`}
                    className="px-2 py-1 rounded-lg bg-white border border-red-200 text-red-800 font-medium"
                  >
                    {a.check_in} → {a.check_out}
                  </span>
                ))}
              </div>
              <span className="block mt-2 text-red-800/80">
                Nothing was changed here: this Booking keeps its hold while you message the Guest.
                If they take new dates, cancel this one and have them request the new dates so the
                paperwork matches.
              </span>
            </>
          ) : (
            <span className="block mt-2 text-red-800/80">
              No free window of the same length turned up within 60 days either side, so this one has
              to be refused or shortened by hand.
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/** One uploaded document, opened at full size in a new tab for a proper look. */
function KycImage({ label, url }: { label: string; url: string }) {
  return (
    <figure className="w-32">
      <a href={url} target="_blank" rel="noreferrer" className="block">
        <img
          src={url}
          alt={label}
          loading="lazy"
          className="h-20 w-32 rounded-xl object-cover border border-forest-900/10 bg-white"
        />
      </a>
      <figcaption className="mt-1 text-[10px] uppercase tracking-eyebrow text-forest-600">
        {label} ↗
      </figcaption>
    </figure>
  )
}
