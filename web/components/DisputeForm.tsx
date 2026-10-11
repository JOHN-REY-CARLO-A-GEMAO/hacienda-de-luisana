import React, { useEffect, useState } from 'react'
import { DisputeRecord, getDisputesForBooking, submitDispute } from '../lib/disputes'

const DISPUTE_CATEGORIES = [
  'Cleanliness & Hygiene',
  'Amenities & Facilities',
  'Billing & Extra Fees',
  'Check-in / Check-out Issue',
  'Property Damage / Safety',
  'Other / General Concern',
]

export function DisputeForm({
  bookingId,
  guestId,
}: {
  bookingId: string
  guestId: string
}) {
  const [disputes, setDisputes] = useState<DisputeRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [category, setCategory] = useState(DISPUTE_CATEGORIES[0])
  const [description, setDescription] = useState('')
  const [submitting, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    getDisputesForBooking(bookingId, guestId)
      .then((records) => {
        if (alive) {
          setDisputes(records)
          setLoading(false)
        }
      })
      .catch(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [bookingId, guestId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!description.trim()) {
      setError('Please provide a description of your issue.')
      return;
    }

    setBusy(true)
    setError(null)
    setSuccessMsg(null)

    const res = await submitDispute({
      bookingId,
      guestId,
      category,
      description,
    })

    setBusy(false)
    if (res.ok) {
      setSuccessMsg('Your report has been submitted to management for review.')
      setDescription('')
      setShowForm(false)
      // Refresh disputes
      const updated = await getDisputesForBooking(bookingId, guestId)
      setDisputes(updated)
    } else {
      setError(res.message || 'Failed to submit report.')
    }
  }

  if (loading) {
    return <p className="text-xs text-forest-700/70 mt-2">Checking issue reports…</p>
  }

  return (
    <div className="mt-4 rounded-xl border border-forest-900/10 p-4 bg-white/50">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-forest-900">
            Issue & Dispute Center
          </h4>
          <p className="text-[11px] text-forest-700">
            Report any concerns or discrepancies regarding this booking.
          </p>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="btn-secondary text-xs py-1 px-3"
          >
            Report an Issue
          </button>
        )}
      </div>

      {successMsg && (
        <p className="mt-3 text-xs text-emerald-800 bg-emerald-50 p-2 rounded-lg border border-emerald-200">
          {successMsg}
        </p>
      )}

      {error && (
        <p className="mt-3 text-xs text-red-800 bg-red-50 p-2 rounded-lg border border-red-200">
          {error}
        </p>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-forest-800 mb-1">
              Issue Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="field text-xs w-full"
            >
              {DISPUTE_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-forest-800 mb-1">
              Description of the Concern
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what happened in detail…"
              rows={3}
              className="field text-xs w-full"
              maxLength={2000}
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="btn-ghost text-xs py-1 px-3"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary text-xs py-1 px-4"
            >
              {submitting ? 'Submitting…' : 'Submit Report'}
            </button>
          </div>
        </form>
      )}

      {disputes.length > 0 && (
        <div className="mt-4 space-y-2 border-t border-forest-900/10 pt-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-forest-700">
            Report History ({disputes.length})
          </p>
          {disputes.map((d) => (
            <div
              key={d.id}
              className="p-2.5 rounded-lg border border-forest-900/10 bg-forest-50/30 text-xs"
            >
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-forest-900">{d.category}</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                    d.status === 'resolved'
                      ? 'bg-emerald-100 text-emerald-800'
                      : d.status === 'rejected'
                      ? 'bg-red-100 text-red-800'
                      : d.status === 'under_review'
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {d.status.replace('_', ' ')}
                </span>
              </div>
              <p className="mt-1 text-forest-800 whitespace-pre-line text-[11px]">
                {d.description}
              </p>
              {d.admin_response && (
                <div className="mt-2 pl-2 border-l-2 border-forest-600/30 text-[11px]">
                  <span className="font-bold text-forest-900 block">
                    Management Response:
                  </span>
                  <p className="text-forest-700 whitespace-pre-line">{d.admin_response}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
