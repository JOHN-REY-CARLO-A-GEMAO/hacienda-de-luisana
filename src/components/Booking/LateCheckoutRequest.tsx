import React, { useState } from 'react'
import type { Booking } from '../../lib/storage'
import { cloudBookingsDB } from '../../lib/firestoreBookings'
import { useAuth } from '../../hooks/useAuth'
import { Alert, Field, RequestBadge, Select } from '../ui'

interface LateCheckoutRequestProps {
  booking: Booking
  onUpdated?: () => void
}

/**
 * A Guest asks to keep the house past noon, and the Admin decides.
 *
 * The fee is shown as it is worked out — the hourly rate beside the hours, the
 * total on the same line as the button — so nobody submits a request and then
 * finds the figure. The answer, once there is one, replaces the form rather than
 * sitting above it: a decided request has nothing left to fill in.
 *
 * The decision pill is `RequestBadge`, the shared one. This used to spell its
 * own amber/`rounded-full` pill by hand, which is how it came to keep reading
 * "PENDING" after the Admin had said yes.
 */
export const LateCheckoutRequest: React.FC<LateCheckoutRequestProps> = ({ booking, onUpdated }) => {
  const { actor } = useAuth()
  const [hours, setHours] = useState<number>(2)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)

  const existingRequest = (booking as unknown as { late_checkout_request?: { hours: number; fee: number; status: string; reason?: string } }).late_checkout_request

  const calculatedFee = hours * 250

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    setNotice(null)
    if (!actor) {
      setNotice({ tone: 'bad', text: 'You must be signed in to submit an extension request.' })
      return
    }
    if (hours < 1 || hours > 6 || isNaN(hours)) {
      setNotice({ tone: 'bad', text: 'Please select a valid extension between 1 and 6 hours.' })
      return
    }
    if (busy) return
    setBusy(true)

    try {
      const requestData = {
        hours,
        fee: calculatedFee,
        requested_at: new Date().toISOString(),
        status: 'pending',
      }

      await cloudBookingsDB.update(
        booking.id,
        {
          late_checkout_request: requestData,
        },
        actor,
      )

      setNotice({
        tone: 'good',
        text: `Requested ${hours} hour${hours > 1 ? 's' : ''} late checkout (₱${calculatedFee.toLocaleString()}). Waiting for Admin approval.`,
      })
      if (onUpdated) onUpdated()
    } catch (err) {
      setNotice({
        tone: 'bad',
        text: `Failed to send request: ${err instanceof Error ? err.message : String(err)}`,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="guest-inset px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className="font-serif text-[18px] font-medium leading-snug text-forest-900 dark:text-cream-50">
          Late checkout
        </h4>
        <span className="guest-num text-[11px] text-forest-700 dark:text-cream-100/75">₱250 per hour</span>
      </div>

      {existingRequest ? (
        <div className="mt-3 rounded-[10px] border border-forest-900/10 bg-white/70 px-4 py-3 dark:border-cream-100/12 dark:bg-forest-900/50">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className="text-sm font-medium text-forest-900 dark:text-cream-50">
              +{existingRequest.hours} hour{existingRequest.hours > 1 ? 's' : ''} past noon
            </p>
            <RequestBadge status={existingRequest.status} />
          </div>
          <p className="guest-num mt-1.5 text-sm text-forest-800 dark:text-cream-100/80">
            ₱{existingRequest.fee.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
          </p>
          {existingRequest.reason && (
            <p className="mt-1.5 border-l-2 border-brass-400/50 pl-2.5 text-xs italic leading-relaxed text-forest-700 dark:text-cream-100/70">
              {existingRequest.reason}
            </p>
          )}
        </div>
      ) : (
        <form onSubmit={handleRequest} className="mt-3.5">
          <Field label="Extra hours" hint="Standard check-out is 12:00 noon.">
            <Select
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              className="text-sm"
            >
              {[1, 2, 3, 4, 5, 6].map((h) => (
                <option key={h} value={h}>
                  +{h} hour{h > 1 ? 's' : ''} (until {12 + h}:00 PM) — ₱{(h * 250).toLocaleString()}
                </option>
              ))}
            </Select>
          </Field>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-forest-900/8 pt-3.5 dark:border-cream-100/10">
            <p className="text-xs text-forest-700 dark:text-cream-100/75">
              Fee
              <span className="guest-num ml-2 text-xl text-forest-900 dark:text-cream-50">
                ₱{calculatedFee.toLocaleString()}
              </span>
            </p>
            <button
              type="submit"
              disabled={busy || !actor || hours < 1 || hours > 6 || isNaN(hours)}
              className="btn-primary btn-sm"
            >
              {busy ? 'Submitting…' : 'Request late checkout'}
            </button>
          </div>
        </form>
      )}

      {notice && (
        <Alert tone={notice.tone === 'good' ? 'success' : 'danger'} className="mt-3 text-xs">
          {notice.text}
        </Alert>
      )}
    </section>
  )
}
