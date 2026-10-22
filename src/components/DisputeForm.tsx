import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CATEGORIES, caseCommand, caseDate, caseLabel, subscribeCases, subscribeEvidence, activityPage, uploadCaseEvidence, downloadCaseEvidence, type DisputeRecord, type CaseActivity, type CaseEvidence } from '../lib/disputes'
import { auth } from '../lib/firebase'
import { DISPUTE_DESCRIPTION_MAX, DISPUTE_MESSAGE_MAX } from '../lib/validation'
import { Alert, Field, Select, Textarea } from './ui'

export function DisputeForm({ bookingId, guestId }: { bookingId?: string; guestId: string }) {
  const [cases, setCases] = useState<DisputeRecord[]>([])
  const [loading, setLoading] = useState(true)
  // Two failures that must not be confused: the case list could not be read, so
  // the centre is closed; or a submission was not confirmed, so the report is
  // still typed in front of the Guest and still worth retrying. Only the first
  // closes the centre — the second must never swallow what someone wrote.
  const [readError, setReadError] = useState('')
  const [writeError, setWriteError] = useState('')
  const [show, setShow] = useState(false)
  const [category, setCategory] = useState('other')
  const [description, setDescription] = useState('')
  const [review, setReview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [count, setCount] = useState(25)
  const [retry, setRetry] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    setLoading(true); setReadError(''); setCases([]); setSelected(null)
    // Firestore detaches a listener for good once it reports a failure, so a
    // closed centre is only reopened by subscribing again — which is what the
    // retry counter is for. Waiting on the same listener would wait forever.
    return subscribeCases(guestId, bookingId, rows => { setCases(rows); setReadError(''); setLoading(false) }, e => { setReadError(e.message); setLoading(false) }, count)
  }, [guestId, bookingId, count, retry])
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (description || busy) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn)
  }, [description, busy])
  async function submit() {
    setBusy(true); setWriteError(''); setNotice('Submitting—waiting for server acknowledgement…')
    try {
      const result = await caseCommand({ action: 'create', category, description, ...(bookingId ? { bookingId } : {}) })
      if (!mounted.current) return
      setNotice(`Submitted as ${result.reference}. You can now add supporting evidence inside the case.`)
      setDescription(''); setShow(false); setReview(false); setSelected(result.caseId)
    } catch (e) { setNotice('Submission is not confirmed. Check your case list, then retry unchanged information to recover the same operation.'); setWriteError(e instanceof Error ? e.message : 'Could not submit.') }
    finally { if (mounted.current) setBusy(false) }
  }
  const duplicate = cases.some(c => c.category === category && c.booking_id === (bookingId || null) && !['closed', 'resolved'].includes(c.status))
  // The case store is unreadable: demo mode, a backend that is not deployed, a
  // missing index or rules that are out of sync all mean the same thing to a
  // Guest — a report submitted here could not be received or tracked. Offering
  // the form would promise a case reference that never arrives.
  const unavailable = Boolean(readError)
  return (
    <section className="card-tight p-5" aria-label="Issue and dispute center">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="h3">Issue &amp; Dispute Center</h2>
          <p className="mt-1 text-xs leading-relaxed text-forest-700/80">
            For urgent safety or access concerns, use{' '}
            <Link className="text-link" to="/contact">
              official contact channels
            </Link>
            . This is not an emergency or 24/7 response service.
          </p>
        </div>
        {!unavailable && (
          <button type="button" className="btn-quiet btn-sm" onClick={() => setShow((value) => !value)}>
            {show ? 'Close form' : 'Report an Issue'}
          </button>
        )}
      </div>

      {auth?.currentUser?.isAnonymous && (
        <Alert tone="warning" className="mt-4 text-xs">
          Link this booking identity to a recoverable account at{' '}
          <Link className="text-link" to="/support">
            Support
          </Link>{' '}
          before reporting. A booking reference alone cannot recover ownership.
        </Alert>
      )}
      {writeError && (
        <Alert tone="danger" className="mt-4 text-xs">
          {writeError}
        </Alert>
      )}
      {readError && (
        <Alert tone="danger" className="mt-4 text-xs">
          {readError}
        </Alert>
      )}
      {unavailable && (
        <p className="mt-4 text-sm leading-relaxed text-forest-800">
          Reporting and case tracking are not available at the moment, so a report submitted here could
          not reach the Hacienda. Please raise this through the{' '}
          <Link className="text-link" to="/contact">
            contact page
          </Link>{' '}
          instead.
        </p>
      )}
      {notice && <Alert tone="info" className="mt-4 text-xs">{notice}</Alert>}

      {show && !unavailable && (
        <form
          className="mt-5 space-y-4 border-t border-forest-900/10 pt-5"
          onSubmit={(event) => {
            event.preventDefault()
            if (description.trim().length < 10) {
              setWriteError('Please provide at least 10 characters describing the issue.')
              return
            }
            if (writeError) setWriteError('')
            review ? void submit() : setReview(true)
          }}
        >
          {review ? (
            <div className="rounded-2xl bg-cream-100/60 p-4">
              <h3 className="font-semibold text-forest-900">Review before submitting</h3>
              <p className="mt-1 text-xs text-forest-700">
                {caseLabel(category)} · {bookingId ? 'Linked to this booking' : 'General support'}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm">{description}</p>
              <p className="mt-2 text-xs text-forest-700/80">
                Your submitted explanation is retained as history. Add corrections later; do not include
                passwords, PINs, full card details or government IDs.
              </p>
            </div>
          ) : (
            <>
              <Field label="Category">
                <Select
                  value={category}
                  onChange={(event) => {
                    setCategory(event.target.value)
                    if (writeError) setWriteError('')
                  }}
                >
                  {CATEGORIES.map((option) => (
                    <option key={option} value={option}>
                      {caseLabel(option)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="What happened?"
                hint={
                  <span className="flex items-center justify-between gap-3">
                    <span>Minimum 10 characters</span>
                    <span className={`font-mono tabular-nums ${description.length >= DISPUTE_DESCRIPTION_MAX ? 'font-semibold text-amber-700' : ''}`}>
                      {description.length} / {DISPUTE_DESCRIPTION_MAX} characters
                    </span>
                  </span>
                }
              >
                <Textarea
                  required
                  minLength={10}
                  maxLength={DISPUTE_DESCRIPTION_MAX}
                  rows={5}
                  value={description}
                  onChange={(event) => {
                    setDescription(event.target.value.slice(0, DISPUTE_DESCRIPTION_MAX))
                    if (writeError) setWriteError('')
                  }}
                />
              </Field>
              <p className="text-xs text-forest-700/80">
                Evidence is optional and can be added after submission. Redact unrelated sensitive details.
              </p>
            </>
          )}

          {duplicate && (
            <Alert tone="warning" className="text-xs">
              You have an active case in this category. Check it below; you may still report a different
              incident.
            </Alert>
          )}

          <div className="flex flex-wrap gap-2">
            <button className="btn-primary btn-sm" disabled={busy || Boolean(writeError)}>
              {busy ? 'Checking submission…' : review ? 'Confirm and submit' : 'Review report'}
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={busy}
              onClick={() => (review ? setReview(false) : setShow(false))}
            >
              {review ? 'Edit' : 'Cancel'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p role="status" className="mt-4 text-sm text-forest-700">
          Loading cases…
        </p>
      ) : (
        !cases.length &&
        !readError && <p className="mt-4 text-sm text-forest-700/80">No reports yet.</p>
      )}

      <div className="mt-4 space-y-3">
        {cases
          .filter((entry) => entry.guest_id === guestId)
          .map((entry) => (
            <article key={entry.id} className="card-tight p-4">
              <button
                type="button"
                aria-expanded={selected === entry.id}
                className="w-full text-left"
                onClick={() => setSelected(selected === entry.id ? null : entry.id)}
              >
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-forest-900">{entry.reference}</span>
                  <span className="text-xs text-forest-700">{caseLabel(entry.category)}</span>
                </span>
                <span className="mt-1 block text-sm text-forest-800">
                  {caseLabel(entry.status)} · {caseLabel(entry.priority)} priority
                </span>
                <span className="mt-0.5 block text-xs text-forest-600">
                  Updated {caseDate(entry.updated_at)} (Asia/Manila)
                </span>
              </button>
              {selected === entry.id && <CaseDetail record={entry} uid={guestId} />}
            </article>
          ))}
      </div>

      {unavailable ? (
        <button type="button" className="btn-ghost btn-sm mt-3" onClick={() => setRetry((value) => value + 1)}>
          Try again
        </button>
      ) : (
        <button type="button" className="btn-ghost btn-sm mt-3" onClick={() => setCount((value) => value + 25)}>
          Look for older reports
        </button>
      )}
    </section>
  )
}

function CaseDetail({ record: c, uid }: { record: DisputeRecord; uid: string }) {
  const [items, setItems] = useState<CaseActivity[]>([])
  const [page, setPage] = useState<Awaited<ReturnType<typeof activityPage>> | null>(null)
  const [files, setFiles] = useState<CaseEvidence[]>([])
  const [message, setMessage] = useState('')
  const [uploads, setUploads] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState('')
  const ready = useRef<{ file: File; id: string }[]>([])
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { let alive = true; void activityPage(c.id).then(p => { if (alive) { setItems(p.items); setPage(p) } }).catch(e => { if (alive) setError(String(e.message)) }); return () => { alive = false } }, [c.id, c.version])
  useEffect(() => subscribeEvidence(c.id, setFiles, e => setError(e.message)), [c.id])
  useEffect(() => { const warn = (e: BeforeUnloadEvent) => { if (message || uploads.length || busy) { e.preventDefault(); e.returnValue = '' } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn) }, [message, uploads, busy])
  const active = !['resolved', 'closed'].includes(c.status)
  async function run(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setError(''); setProgress('Waiting for server acknowledgement…')
    try {
      let attachmentIds: string[] = []
      if (action === 'message') {
        for (const file of uploads) {
          let cached = ready.current.find(r => r.file === file)
          if (!cached) { cached = { file, id: await uploadCaseEvidence(c, file, setProgress) }; ready.current.push(cached) }
          attachmentIds.push(cached.id)
        }
      }
      await caseCommand({ action, caseId: c.id, expectedVersion: c.version, text: message, ...(attachmentIds.length ? { attachmentIds } : {}), ...extra })
      setMessage(''); setUploads([]); ready.current = []; if (input.current) input.current.value = ''; setProgress('Action confirmed.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Action not confirmed.'); setProgress('Not confirmed. Refresh/review the case before retrying; unchanged retries reuse the same operation.') }
    finally { setBusy(false) }
  }
  return <div className="mt-4 space-y-3 text-sm">
    <p className="whitespace-pre-wrap">{c.description}</p>
    {c.due_at && <p>Response/work due: {caseDate(c.due_at)} (Asia/Manila). Overdue does not mean accepted or rejected.</p>}
    {c.independent_review && <p>{c.reviewer_id ? 'Independent review is assigned.' : 'Waiting for an eligible independent reviewer.'}</p>}
    {c.resolution && <div className="bg-cream-50 rounded p-3"><strong>Findings / resolution</strong><p className="whitespace-pre-wrap">{c.resolution}</p>{c.remedy_pending && <p>Remedy is outstanding—not completed. Due {caseDate(c.remedy_due_at)}.</p>}</div>}
    {c.duplicate_of && <p>Consolidated into case <code>{c.duplicate_of}</code>. Original history remains available.</p>}
    <h3 className="font-semibold">Evidence</h3>
    <ul>{files.map(f => <li key={f.id} className="flex gap-2 flex-wrap my-2"><span>{f.name}{f.restricted ? ' · Restricted pending review' : ''}</span>{!f.restricted && !f.deleted && <button type="button" disabled={busy} className="underline" onClick={() => void downloadCaseEvidence(f.id).catch(e => setError(e.message))}>Download</button>}{f.owner === uid && !f.restricted && <button type="button" disabled={busy || !message.trim()} className="underline" onClick={() => void run('evidence_request', { evidenceId: f.id })}>Request withdrawal (explain below)</button>}</li>)}</ul>
    <p className="text-xs">Withdrawal cannot recall downloaded copies. Sensitive evidence is restricted for review, not silently erased.</p>
    <h3 className="font-semibold">Case Activity log</h3>
    <ol className="space-y-2 max-h-96 overflow-auto" aria-label="Case activity">{[...items].reverse().map(i => <li key={i.id} className="border-l-2 pl-3"><span className="text-xs">{caseDate(i.created_at)} · {i.actor_role} · {caseLabel(i.action)}</span>{i.text && <p className="whitespace-pre-wrap">{i.text}</p>}{i.attachment_ids?.length > 0 && <p>{i.attachment_ids.length} attachment(s)</p>}</li>)}</ol>
    {page?.hasMore && <button type="button" className="underline" onClick={() => void activityPage(c.id, page.cursor).then(p => { setItems(prev => [...prev, ...p.items]); setPage(p) }).catch(e => setError(e.message))}>Load older activity</button>}
    {error && <p role="alert" className="text-red-800">{error}</p>}{progress && <p role="status">{progress}</p>}
    {!c.duplicate_of && <form className="space-y-3" onSubmit={e => {
      e.preventDefault()
      if (!active && message.trim().length < 10) {
        setError('Minimum 10 characters required to reopen.')
        return
      }
      void run(active ? 'message' : !c.final_decision && c.reopen_until && Date.now() <= c.reopen_until ? 'reopen' : 'request_reopen')
    }}>
      <label className="block">
        <span className="label">{active ? 'Message / explanation' : 'Reason to reopen (new evidence, unfulfilled remedy, or procedural error)'}</span>
        <textarea
          className="field w-full"
          rows={3}
          maxLength={DISPUTE_MESSAGE_MAX}
          minLength={active ? 0 : 10}
          value={message}
          onChange={e => { setMessage(e.target.value.slice(0, DISPUTE_MESSAGE_MAX)); if (error) setError('') }}
        />
        <div className="mt-1 flex items-center justify-between text-[11px]">
          <span className="text-forest-600/70">{active ? 'Explain clearly without confidential credentials' : 'Minimum 10 characters required'}</span>
          <span className={`font-mono tabular-nums ${message.length >= DISPUTE_MESSAGE_MAX ? 'text-amber-700 font-semibold' : 'text-forest-600/70'}`}>
            {message.length} / {DISPUTE_MESSAGE_MAX} characters
          </span>
        </div>
      </label>
      {active && <label className="block">Add evidence (up to five files, 10 MB each)<input ref={input} className="block my-2" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple disabled={busy} onChange={e => { const selected = Array.from(e.target.files || []); if (selected.length > 5 || selected.some(f => f.size > 10 * 1024 * 1024)) { setError('Choose at most five files of 10 MB each.'); e.target.value = ''; setUploads([]) } else { setError(''); setUploads(selected) } }} /></label>}
      <p className="text-xs">No passwords, PINs, full card details or government IDs. Redact unrelated information. Temporary uploads expire after 24 hours. Submitted history cannot be edited.</p>
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary btn-sm disabled:opacity-60 disabled:cursor-not-allowed" disabled={busy || (!message.trim() && !uploads.length) || (!active && message.trim().length < 10) || Boolean(error)}>{busy ? 'Checking action…' : active ? 'Send message / evidence' : 'Request reopening'}</button>
        {c.status === 'resolution_proposed' && <><button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => { if (window.confirm('Accept this proposal? Any unfinished remedy remains outstanding.')) void run('accept') }}>Accept proposal</button>{!c.appeal_used && <button type="button" className="btn-secondary btn-sm" disabled={busy || message.trim().length < 10} onClick={() => void run('contest')}>Contest &amp; request independent appeal</button>}</>}
        {active && <button type="button" className="btn-ghost btn-sm" disabled={busy || !message.trim()} onClick={() => void run('withdraw_request')}>Request case withdrawal</button>}
      </div>
    </form>}
    {c.final_decision && <p className="text-xs">The ordinary internal appeal route is complete. Exceptional reopening requires eligible Admin approval. External complaint and legal rights are unaffected.</p>}
  </div>
}
