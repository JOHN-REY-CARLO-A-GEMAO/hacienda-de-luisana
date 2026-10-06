import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ACCOMMODATIONS } from '../config/site'
import { cloudBookingsDB } from '../lib/firestoreBookings'
import { useAuth } from '../hooks/useAuth'
import { usePublishedRates } from '../hooks/usePublishedRates'
import { unitsForAccommodation } from '../lib/booking'
import { readLocalPaymentProof, type Booking } from '../lib/storage'
import { ArrowRight } from '../lib/icons'

function referenceOf(booking: Booking): string {
  return (booking.ref_id || booking.id.slice(0, 8)).toUpperCase()
}

/**
 * The downpayment decision, in the same lifecycle the Admin app uses.
 *
 * In demo mode this browser is the Hacienda: Pending bookings can be approved
 * or rejected here, and that is the only thing that moves the status. When
 * Firebase is configured, the same buttons run only for an Admin session —
 * a Guest cannot confirm their own stay.
 */
export function ReviewDeskPage() {
  const { role, user } = useAuth()
  const published = usePublishedRates()
  const demo = !cloudBookingsDB.isCloud
  const allowed = demo || role === 'admin'
  const [bookings, setBookings] = useState<Booking[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reason, setReason] = useState('The downpayment screenshot could not be matched.')
  const [notice, setNotice] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!allowed) return
    return cloudBookingsDB.subscribe((list) => {
      setBookings(list)
    })
  }, [allowed])

  const pending = bookings.filter((booking) => cloudBookingsDB.readStatus(booking) === 'Pending')
  const selected = bookings.find((booking) => booking.id === selectedId) ?? pending[0] ?? null
  const proofSrc = selected
    ? readLocalPaymentProof(selected.payment_proof_url) ||
      (selected.payment_proof_url?.startsWith('data:') ? selected.payment_proof_url : null)
    : null

  const decide = async (decision: 'approve' | 'reject') => {
    if (!selected) return
    setBusy(true)
    setNotice(null)
    try {
      const actor = {
        actor: 'admin' as const,
        actor_id: user?.uid || 'demo-admin',
        actor_name: user?.displayName || user?.email || 'Hacienda review',
      }
      const result =
        decision === 'approve'
          ? await cloudBookingsDB.transition(
              selected.id,
              {
                type: 'Approve',
                availability: {
                  bookings: await cloudBookingsDB.list(),
                  unitsAvailable: unitsForAccommodation(
                    selected.accommodation,
                    ACCOMMODATIONS,
                    published,
                  ),
                },
              },
              actor,
            )
          : await cloudBookingsDB.transition(selected.id, { type: 'Reject', reason }, actor)
      if (!result.ok) {
        setNotice({ tone: 'bad', text: result.reason })
        return
      }
      const next = decision === 'approve' ? 'Approved' : 'Rejected'
      setNotice({
        tone: 'good',
        text: `${referenceOf(selected)} is now ${next}. The status did not change until this decision.`,
      })
    } catch (err) {
      setNotice({
        tone: 'bad',
        text: err instanceof Error ? err.message : 'That decision could not be saved.',
      })
    } finally {
      setBusy(false)
    }
  }

  if (!allowed) {
    return (
      <div className="pt-32 pb-24 min-h-screen bg-cream-50">
        <div className="mx-auto max-w-lg px-5 text-center">
          <div className="eyebrow">Admin</div>
          <h1 className="display text-4xl mt-3 text-forest-900">Review is for the Hacienda</h1>
          <p className="mt-4 text-sm text-forest-800/80 leading-relaxed">
            Guests can browse and book without an account. Approving or rejecting a downpayment
            is the Admin’s decision, made in the Hacienda mobile app.
          </p>
          <Link to="/" className="btn-primary mt-8 inline-flex text-xs">Back to the Hacienda</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="pt-28 pb-24 bg-cream-50 min-h-screen">
      <div className="mx-auto max-w-6xl px-5 lg:px-8">
        <div className="max-w-2xl">
          <div className="eyebrow">{demo ? 'Demo review desk' : 'Admin review'}</div>
          <h1 className="display text-4xl sm:text-5xl mt-3 text-forest-900">Pending downpayments</h1>
          <p className="mt-4 text-forest-800/80 leading-relaxed">
            A booking stays <strong>Pending</strong> until you accept or decline the screenshot.
            Approve sets it to <strong>Approved</strong>. Reject sets it to <strong>Rejected</strong>.
            Nothing else confirms the stay.
          </p>
        </div>

        {notice && (
          <div
            className={`mt-6 rounded-xl px-4 py-3 text-sm ${
              notice.tone === 'good' ? 'bg-emerald-50 text-emerald-900 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            {notice.text}
          </div>
        )}

        <div className="mt-10 grid lg:grid-cols-5 gap-6">
          <ul className="lg:col-span-2 space-y-3">
            {pending.length === 0 && (
              <li className="rounded-2xl bg-white border border-forest-900/5 p-5 text-sm text-forest-700">
                No bookings are waiting. A guest submission with a screenshot appears here as Pending.
              </li>
            )}
            {pending.map((booking) => {
              const active = selected?.id === booking.id
              return (
                <li key={booking.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(booking.id)}
                    className={`w-full text-left rounded-2xl border p-4 ${
                      active ? 'bg-forest-900 text-cream-50 border-forest-900' : 'bg-white border-forest-900/10'
                    }`}
                  >
                    <div className="text-[10px] uppercase tracking-eyebrow opacity-70">{referenceOf(booking)}</div>
                    <div className="font-serif text-xl mt-1">{booking.guest_name}</div>
                    <div className={`text-xs mt-1 ${active ? 'text-cream-100/80' : 'text-forest-700'}`}>
                      {ACCOMMODATIONS.find((item) => item.id === booking.accommodation)?.name || booking.accommodation}
                      {' · '}
                      {booking.check_in} → {booking.check_out}
                    </div>
                    <div className={`mt-2 text-[11px] ${active ? 'text-amber-200' : 'text-amber-800'}`}>Pending</div>
                  </button>
                </li>
              )
            })}
          </ul>

          <section className="lg:col-span-3 bg-white rounded-[28px] border border-forest-900/5 shadow-card p-6 sm:p-8">
            {!selected ? (
              <p className="text-sm text-forest-700">Select a pending booking to review its screenshot.</p>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="eyebrow">Reviewing</div>
                    <h2 className="font-serif text-3xl text-forest-900 mt-1">{selected.guest_name}</h2>
                    <p className="text-sm text-forest-700 mt-1">
                      {selected.email} · {selected.phone}
                    </p>
                  </div>
                  <span className="rounded-full bg-amber-100 text-amber-900 text-[11px] uppercase tracking-eyebrow px-3 py-1">
                    Pending
                  </span>
                </div>
                <dl className="mt-5 grid sm:grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-[10px] uppercase tracking-eyebrow text-forest-600">Dates</dt>
                    <dd>{selected.check_in} → {selected.check_out}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-eyebrow text-forest-600">Amount claimed</dt>
                    <dd>
                      {typeof selected.amount_claimed === 'number'
                        ? `₱${selected.amount_claimed.toLocaleString('en-PH')}`
                        : '—'}
                      {typeof selected.amount_due === 'number' ? ` · due ₱${selected.amount_due.toLocaleString('en-PH')}` : ''}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-[10px] uppercase tracking-eyebrow text-forest-600">Reference</dt>
                    <dd className="font-mono text-xs">{selected.payment_reference || 'None on the form'}</dd>
                  </div>
                </dl>
                <div className="mt-5">
                  <div className="text-[10px] uppercase tracking-eyebrow text-forest-600">Downpayment screenshot</div>
                  {proofSrc ? (
                    <img src={proofSrc} alt="Downpayment proof" className="mt-2 max-h-80 rounded-2xl border border-forest-900/10 object-contain bg-cream-50" />
                  ) : selected.payment_proof_url ? (
                    <p className="mt-2 text-xs text-forest-700 break-all">
                      Proof stored at <span className="font-mono">{selected.payment_proof_url}</span>. Open it from the Admin app when this is a cloud booking.
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-red-800">
                      No screenshot is attached. Approval will be refused until a proof is on the booking.
                    </p>
                  )}
                </div>
                <label className="block mt-6">
                  <span className="label">If you reject, the guest reads this</span>
                  <textarea className="field min-h-[90px]" value={reason} onChange={(event) => setReason(event.target.value)} />
                </label>
                <div className="mt-5 flex flex-wrap gap-3">
                  <button type="button" className="btn-primary" disabled={busy} onClick={() => void decide('approve')}>
                    Approve downpayment
                  </button>
                  <button
                    type="button"
                    className="btn bg-red-700 text-white hover:bg-red-800"
                    disabled={busy || !reason.trim()}
                    onClick={() => void decide('reject')}
                  >
                    Reject
                  </button>
                  <Link to={`/booking/status?id=${encodeURIComponent(selected.id)}`} className="btn-ghost text-xs">
                    Guest status page <ArrowRight size={14} />
                  </Link>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
