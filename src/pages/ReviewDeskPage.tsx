import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ACCOMMODATIONS } from '../config/site'
import { cloudBookingsDB } from '../lib/firestoreBookings'
import { useAuth } from '../hooks/useAuth'
import { usePublishedRates } from '../hooks/usePublishedRates'
import { unitsForAccommodation } from '../lib/booking'
import { readLocalPaymentProof, type Booking } from '../lib/storage'
import { ArrowRight } from '../lib/icons'
import { Alert, Card, Container, EmptyState, Field, MessageScreen, Page, PageHeader, StatusBadge, Textarea } from '../components/ui'

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
    if (decision === 'reject' && !reason.trim()) {
      setNotice({ tone: 'bad', text: 'Please enter a reason explaining why the downpayment was rejected.' })
      return
    }
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
      <MessageScreen
        eyebrow="Admin"
        title="Review is for the Hacienda"
        body={
          <p>
            Guests can browse and book without an account. Approving or rejecting a downpayment is the
            Admin&rsquo;s decision, made in the Hacienda mobile app.
          </p>
        }
        actions={
          <Link to="/" className="btn-primary">
            Back to the Hacienda
          </Link>
        }
      />
    )
  }

  return (
    <Page>
      <Container width="wide">
        <PageHeader
          eyebrow={demo ? 'Demo review desk' : 'Admin review'}
          title="Pending downpayments"
          lead={
            <p>
              A booking stays <strong>Pending</strong> until you accept or decline the screenshot. Approve
              sets it to <strong>Approved</strong>. Reject sets it to <strong>Rejected</strong>. Nothing
              else confirms the stay.
            </p>
          }
        />

        {notice && (
          <Alert tone={notice.tone === 'good' ? 'success' : 'danger'} className="mt-6">
            {notice.text}
          </Alert>
        )}

        <div className="mt-10 grid lg:grid-cols-5 gap-6">
          <ul className="lg:col-span-2 space-y-3">
            {pending.length === 0 && (
              <li>
                <EmptyState
                  compact
                  title="No bookings are waiting"
                  body="A guest submission with a screenshot appears here as Pending."
                  className="card-tight"
                />
              </li>
            )}
            {pending.map((booking) => {
              const active = selected?.id === booking.id
              return (
                <li key={booking.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(booking.id)}
                    className={`card-tight w-full p-4 text-left transition-colors ${
                      active ? 'border-forest-900 bg-forest-900 text-cream-50' : 'hover:border-forest-900/25'
                    }`}
                  >
                    <div className="data-label opacity-70">{referenceOf(booking)}</div>
                    <div className="font-serif text-xl mt-1">{booking.guest_name}</div>
                    <div className={`text-xs mt-1 ${active ? 'text-cream-100/80' : 'text-forest-700'}`}>
                      {ACCOMMODATIONS.find((item) => item.id === booking.accommodation)?.name || booking.accommodation}
                      {' · '}
                      {booking.check_in} → {booking.check_out}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <StatusBadge status="Pending" />
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>

          <Card as="section" padding="lg" className="lg:col-span-3">
            {!selected ? (
              <EmptyState compact title="Nothing selected" body="Select a pending booking to review its screenshot." />
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="eyebrow">Reviewing</div>
                    <h2 className="h2 mt-1">{selected.guest_name}</h2>
                    <p className="text-sm text-forest-700 mt-1">
                      {selected.email} · {selected.phone}
                    </p>
                  </div>
                  <StatusBadge status="Pending" />
                </div>
                <dl className="mt-5 grid sm:grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="data-label">Dates</dt>
                    <dd>{selected.check_in} → {selected.check_out}</dd>
                  </div>
                  <div>
                    <dt className="data-label">Amount claimed</dt>
                    <dd>
                      {typeof selected.amount_claimed === 'number'
                        ? `₱${selected.amount_claimed.toLocaleString('en-PH')}`
                        : '—'}
                      {typeof selected.amount_due === 'number' ? ` · due ₱${selected.amount_due.toLocaleString('en-PH')}` : ''}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="data-label">Reference</dt>
                    <dd className="font-mono text-xs">{selected.payment_reference || 'None on the form'}</dd>
                  </div>
                </dl>
                <div className="mt-5">
                  <div className="data-label">Downpayment screenshot</div>
                  {proofSrc ? (
                    <img src={proofSrc} alt="Downpayment proof" className="mt-2 max-h-80 rounded-2xl border border-forest-900/10 object-contain bg-cream-50" />
                  ) : selected.payment_proof_url ? (
                    <p className="mt-2 text-xs text-forest-700 break-all">
                      Proof stored at <span className="font-mono">{selected.payment_proof_url}</span>. Open it from the Admin app when this is a cloud booking.
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-red-800" role="alert">
                      No screenshot is attached. Approval will be refused until a proof is on the booking.
                    </p>
                  )}
                </div>
                <Field
                  className="mt-6"
                  label="If you reject, the guest reads this"
                  hint={
                    <span className="flex items-center justify-between gap-3">
                      <span>State clearly why the downpayment was rejected</span>
                      <span className="font-mono tabular-nums">{reason.length} / 500 characters</span>
                    </span>
                  }
                >
                  <Textarea
                    className="min-h-[90px]"
                    maxLength={500}
                    value={reason}
                    onChange={(event) => {
                      setReason(event.target.value.slice(0, 500))
                      if (notice?.tone === 'bad') setNotice(null)
                    }}
                  />
                </Field>
                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busy}
                    onClick={() => void decide('approve')}
                  >
                    {busy ? 'Saving…' : 'Approve downpayment'}
                  </button>
                  <button
                    type="button"
                    className="btn-danger"
                    disabled={busy || !reason.trim()}
                    onClick={() => void decide('reject')}
                  >
                    {busy ? 'Saving…' : 'Reject'}
                  </button>
                  <Link to={`/booking/status?id=${encodeURIComponent(selected.id)}`} className="btn-ghost btn-sm">
                    Guest status page <ArrowRight size={14} />
                  </Link>
                </div>
              </>
            )}
          </Card>
        </div>
      </Container>
    </Page>
  )
}
