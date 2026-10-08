import React, { useState } from 'react'
import type { Booking } from '../../lib/storage'
import { cloudBookingsDB } from '../../lib/firestoreBookings'
import { useAuth } from '../../hooks/useAuth'

interface LateCheckoutRequestProps {
  booking: Booking
  onUpdated?: () => void
}

export const LateCheckoutRequest: React.FC<LateCheckoutRequestProps> = ({ booking, onUpdated }) => {
  const { actor } = useAuth()
  const [hours, setHours] = useState<number>(2)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)

  const existingRequest = (booking as unknown as { late_checkout_request?: { hours: number; fee: number; status: string; reason?: string } }).late_checkout_request

  const calculatedFee = hours * 250

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!actor || busy) return
    setBusy(true)
    setNotice(null)

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
    <div className="mt-4 p-4 rounded-2xl bg-cream-50 border border-forest-900/10 text-xs">
      <div className="flex items-center justify-between">
        <h4 className="font-bold text-forest-900 text-sm">Late Checkout Extension</h4>
        <span className="text-forest-600 font-medium">₱250 / hour</span>
      </div>

      {existingRequest ? (
        <div className="mt-3 p-3 rounded-xl bg-white border border-forest-900/10">
          <div className="flex items-center justify-between font-semibold text-forest-900">
            <span>
              Requested: +{existingRequest.hours} hour{existingRequest.hours > 1 ? 's' : ''}
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                existingRequest.status === 'approved'
                  ? 'bg-emerald-100 text-emerald-800'
                  : existingRequest.status === 'rejected'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-amber-100 text-amber-800'
              }`}
            >
              {existingRequest.status.toUpperCase()}
            </span>
          </div>
          <p className="mt-1 text-forest-700/80">Fee: ₱{existingRequest.fee.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
          {existingRequest.reason && <p className="mt-1 italic text-forest-600">Note: {existingRequest.reason}</p>}
        </div>
      ) : (
        <form onSubmit={handleRequest} className="mt-3 space-y-3">
          <div>
            <label className="block text-forest-700 font-medium mb-1">
              Select Extra Hours (Standard checkout is 12:00 PM):
            </label>
            <select
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              className="field text-xs w-full"
            >
              {[1, 2, 3, 4, 5, 6].map((h) => (
                <option key={h} value={h}>
                  +{h} hour{h > 1 ? 's' : ''} (Until {12 + h}:00 PM) — ₱{(h * 250).toLocaleString()}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className="font-bold text-forest-900">Calculated Fee: ₱{calculatedFee.toLocaleString()}</span>
            <button
              type="submit"
              disabled={busy}
              className="btn-primary text-xs disabled:opacity-50"
            >
              {busy ? 'Submitting…' : 'Submit Extension Request'}
            </button>
          </div>
        </form>
      )}

      {notice && (
        <div
          className={`mt-3 p-2.5 rounded-xl border text-xs ${
            notice.tone === 'good' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {notice.text}
        </div>
      )}
    </div>
  )
}
