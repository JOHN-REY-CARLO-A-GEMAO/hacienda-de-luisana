import { useEffect, useState } from 'react'
import { ACCOMMODATIONS } from '../../config/site'
import { ratesDB } from '../../lib/ratesDB'
import type { RatesProblem } from '../../lib/booking'
import { useAuth } from '../../hooks/useAuth'

/**
 * The Host's published figures: per-Accommodation rates, Security deposit,
 * down-payment percent and cancellation policy, under a version.
 *
 * This is the document the Guest's payment choice is quoted from (ticket #14):
 * publishing is the Host's alone (`rates:publish`), reading is public. The
 * panel starts clean — no hardcoded production prices — and the same
 * `validatePublishedRates` check a test runs gates every write. A Booking
 * chosen under no published policy carries nulls and refunds nothing.
 */

type RateRow = { nightly: string; deposit: string; downPercent: string }
type RefundTierRow = { minDays: string; percent: string }

const emptyRows = (): Record<string, RateRow> =>
  Object.fromEntries(ACCOMMODATIONS.map((a) => [a.id, { nightly: '', deposit: '', downPercent: '' }]))

function peso(n: number): string {
  return `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function RatesPanel() {
  const { can } = useAuth()
  const [version, setVersion] = useState('')
  const [effectiveDate, setEffectiveDate] = useState('')
  const [rows, setRows] = useState<Record<string, RateRow>>(emptyRows)
  const [refundPercent, setRefundPercent] = useState('')
  const [depositRefundPercent, setDepositRefundPercent] = useState('')
  const [tiers, setTiers] = useState<RefundTierRow[]>([])
  const [current, setCurrent] = useState<{ version: string; effective_date: string } | null>(null)
  const [problems, setProblems] = useState<RatesProblem[]>([])
  const [notice, setNotice] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [prefilled, setPrefilled] = useState(false)

  useEffect(() => ratesDB.subscribe((doc) => {
    setCurrent(doc ? { version: doc.version, effective_date: doc.effective_date } : null)
    if (doc && !prefilled) {
      setPrefilled(true)
      setVersion(doc.version)
      setEffectiveDate(doc.effective_date)
      setRows((prev) => {
        const next = { ...prev }
        for (const [id, figures] of Object.entries(doc.accommodations)) {
          next[id] = {
            nightly: String(figures.nightly_rate),
            deposit: String(figures.security_deposit),
            downPercent: figures.down_payment_percent === undefined ? '' : String(figures.down_payment_percent),
          }
        }
        return next
      })
      setRefundPercent(doc.refund?.refund_percent === undefined ? '' : String(doc.refund.refund_percent))
      setDepositRefundPercent(
        doc.refund?.deposit_refund_percent === undefined ? '' : String(doc.refund.deposit_refund_percent),
      )
      setTiers(
        (doc.refund?.tiers ?? []).map((t) => ({
          minDays: String(t.min_days_before_check_in),
          percent: String(t.refund_percent),
        })),
      )
    }
  }), [prefilled])

  if (!can('rates:publish')) {
    return (
      <div className="rounded-3xl bg-white border border-forest-900/5 shadow-card p-6 text-sm text-forest-800">
        Only the Host publishes rates.
      </div>
    )
  }

  const setRow = (id: string, patch: Partial<RateRow>) =>
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))

  const publish = async () => {
    setBusy(true)
    setNotice(null)
    setProblems([])
    try {
      const accommodations: Record<string, Record<string, number>> = {}
      for (const a of ACCOMMODATIONS) {
        const row = rows[a.id]
        if (!row) continue
        // A row left blank is a unit with no machine price: omitted, so a
        // payment choice for it refuses rather than inventing a price.
        if (row.nightly.trim() === '' && row.deposit.trim() === '') continue
        const entry: Record<string, number> = {
          nightly_rate: Number(row.nightly),
          security_deposit: Number(row.deposit),
        }
        if (row.downPercent.trim() !== '') entry.down_payment_percent = Number(row.downPercent)
        accommodations[a.id] = entry
      }

      const refund: Record<string, unknown> = {}
      if (refundPercent.trim() !== '') refund.refund_percent = Number(refundPercent)
      if (depositRefundPercent.trim() !== '') refund.deposit_refund_percent = Number(depositRefundPercent)
      const parsedTiers = tiers
        .filter((t) => t.minDays.trim() !== '' || t.percent.trim() !== '')
        .map((t) => ({ min_days_before_check_in: Number(t.minDays), refund_percent: Number(t.percent) }))
      if (parsedTiers.length > 0) refund.tiers = parsedTiers

      const candidate = {
        version: version.trim(),
        effective_date: effectiveDate.trim(),
        accommodations,
        ...(Object.keys(refund).length > 0 ? { refund } : {}),
      }

      const result = await ratesDB.publish(
        candidate,
        ACCOMMODATIONS.map((a) => a.id),
      )
      if (!result.ok) {
        setProblems(result.problems)
        setNotice({ tone: 'bad', text: 'Not published — fix the problems below.' })
        return
      }
      setNotice({
        tone: 'good',
        text: `Published ${result.doc.version} (in force ${result.doc.effective_date}). Future payment choices quote from it; stays already promised keep their stamp.`,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-3xl bg-white border border-forest-900/5 shadow-card p-6">
        <div className="eyebrow">Host only · Published rates</div>
        <h3 className="font-serif text-2xl text-forest-900 mt-2">Presyo at patakaran</h3>
        <p className="mt-2 text-sm text-forest-700/80 leading-relaxed max-w-3xl">
          What the Guest&apos;s payment choice is quoted from: the nightly rate and refundable Security
          deposit per Accommodation, the down-payment percent, and the cancellation policy. Nothing here
          takes money — the Guest pays externally and uploads proof (ADR-0001).
          {current
            ? <> Currently published: <strong>{current.version}</strong> (in force {current.effective_date}).</>
            : <> Nothing published yet — until there is, no payment plan can be chosen.</>}
        </p>
        <div className="mt-4 grid sm:grid-cols-2 gap-3 max-w-xl">
          <label className="block">
            <span className="block text-xs font-medium text-forest-900">Version</span>
            <input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="e.g. v2026-10"
              className="field mt-1"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-forest-900">In force (YYYY-MM-DD)</span>
            <input
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              placeholder="e.g. 2026-10-01"
              className="field mt-1"
            />
          </label>
        </div>
      </div>

      <div className="rounded-3xl bg-white border border-forest-900/5 shadow-card p-6">
        <h4 className="font-serif text-xl text-forest-900">Per-Accommodation figures</h4>
        <p className="mt-1 text-xs text-forest-700/70">
          Leave a row blank and that unit has no machine price — a payment choice for it is refused.
        </p>
        <div className="mt-4 space-y-4">
          {ACCOMMODATIONS.map((a) => (
            <div key={a.id} className="rounded-2xl border border-forest-900/10 p-4">
              <div className="text-sm font-medium text-forest-900">{a.name}</div>
              <div className="mt-2 grid sm:grid-cols-3 gap-3">
                <label className="block">
                  <span className="block text-xs text-forest-700">Nightly rate (₱)</span>
                  <input
                    value={rows[a.id]?.nightly ?? ''}
                    onChange={(e) => setRow(a.id, { nightly: e.target.value })}
                    inputMode="decimal"
                    placeholder="e.g. 8500"
                    className="field mt-1"
                  />
                </label>
                <label className="block">
                  <span className="block text-xs text-forest-700">Security deposit (₱)</span>
                  <input
                    value={rows[a.id]?.deposit ?? ''}
                    onChange={(e) => setRow(a.id, { deposit: e.target.value })}
                    inputMode="decimal"
                    placeholder="e.g. 2000"
                    className="field mt-1"
                  />
                </label>
                <label className="block">
                  <span className="block text-xs text-forest-700">Down-payment % (optional)</span>
                  <input
                    value={rows[a.id]?.downPercent ?? ''}
                    onChange={(e) => setRow(a.id, { downPercent: e.target.value })}
                    inputMode="decimal"
                    placeholder="e.g. 50"
                    className="field mt-1"
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-3xl bg-white border border-forest-900/5 shadow-card p-6">
        <h4 className="font-serif text-xl text-forest-900">Cancellation policy</h4>
        <p className="mt-1 text-xs text-forest-700/70">
          Absent means publish nothing — and a stay promised under no policy refunds nothing.
        </p>
        <div className="mt-3 grid sm:grid-cols-2 gap-3 max-w-xl">
          <label className="block">
            <span className="block text-xs text-forest-700">Flat refund % (optional)</span>
            <input
              value={refundPercent}
              onChange={(e) => setRefundPercent(e.target.value)}
              inputMode="decimal"
              placeholder="e.g. 50"
              className="field mt-1"
            />
          </label>
          <label className="block">
            <span className="block text-xs text-forest-700">Deposit returned % (default 100)</span>
            <input
              value={depositRefundPercent}
              onChange={(e) => setDepositRefundPercent(e.target.value)}
              inputMode="decimal"
              placeholder="e.g. 100"
              className="field mt-1"
            />
          </label>
        </div>
        <div className="mt-4">
          <div className="text-xs font-medium text-forest-900">Tiers (instead of the flat percent)</div>
          {tiers.map((tier, i) => (
            <div key={i} className="mt-2 flex gap-2 items-center max-w-xl">
              <input
                value={tier.minDays}
                onChange={(e) => setTiers((prev) => prev.map((t, j) => (j === i ? { ...t, minDays: e.target.value } : t)))}
                inputMode="numeric"
                placeholder="Days before"
                aria-label="Minimum days before check-in"
                className="field"
              />
              <input
                value={tier.percent}
                onChange={(e) => setTiers((prev) => prev.map((t, j) => (j === i ? { ...t, percent: e.target.value } : t)))}
                inputMode="decimal"
                placeholder="Refund %"
                aria-label="Refund percent"
                className="field"
              />
              <button
                onClick={() => setTiers((prev) => prev.filter((_, j) => j !== i))}
                className="btn-ghost text-xs shrink-0"
              >
                Remove
              </button>
            </div>
          ))}
          <button onClick={() => setTiers((prev) => [...prev, { minDays: '', percent: '' }])} className="btn-ghost text-xs mt-2">
            Add tier
          </button>
        </div>
      </div>

      {problems.length > 0 && (
        <ul className="rounded-2xl bg-red-50 border border-red-200 px-4 py-3 text-xs text-red-800 space-y-1">
          {problems.map((p) => (
            <li key={p.path || '(root)'}>
              <strong>{p.path || 'document'}:</strong> {p.message}
            </li>
          ))}
        </ul>
      )}

      {notice && (
        <p
          className={`rounded-2xl px-4 py-3 text-sm border ${
            notice.tone === 'good'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {notice.text}
        </p>
      )}

      <div className="flex gap-2">
        <button onClick={() => void publish()} disabled={busy} className="btn-primary text-xs disabled:opacity-50">
          {busy ? 'Publishing…' : 'Publish rates'}
        </button>
        <span className="text-[11px] text-forest-600 self-center">
          Quoted stays show {peso(8500)}-style amounts from this document — never invented.
        </span>
      </div>
    </div>
  )
}
