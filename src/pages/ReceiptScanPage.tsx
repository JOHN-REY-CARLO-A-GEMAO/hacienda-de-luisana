import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Card, Container, Field, Page, PageHeader, Textarea } from '../components/ui'
import { Check, Copy, CreditCard, Sparkle } from '../lib/icons'
import { LIMITS, checkRateLimit } from '../lib/rateLimit'
import { validateProofFile } from '../lib/validation'
import {
  canAutoVerifyFromOcr,
  extractReceiptFields,
  runReceiptOcr,
  type OcrExtract,
} from '../lib/payments/ocr'
import {
  paymentReferenceDocId,
  scanFields,
  scanVerdict,
  unreadFields,
} from '../lib/payments/receipt-preview'

/**
 * `/receipt-scan` — the receipt reader, on its own, so it can be seen.
 *
 * The Guest never needs this page: `/book/pay` and `/account` already run the
 * same engine the moment a screenshot is chosen and pre-fill the reference
 * input. It exists because that behaviour is invisible until the day a Guest is
 * already mid-booking — and because a payment proof is the one place where a
 * misread digit matters. Opening the reader here answers three questions before
 * any money moves:
 *
 *   1. can this particular receipt be read at all (a GCash Express Send with
 *      its reference split across a date column is a different problem from a
 *      clean bank screenshot)?
 *   2. which figures does the app see, when the receipt prints two?
 *   3. which field does each value land in, and what does the Admin read back?
 *
 * It holds no state beyond the file being read, writes nothing to Firestore or
 * Storage, and states plainly that `canAutoVerifyFromOcr()` is `false`: reading
 * a receipt is never verifying a payment. The image is read in this browser by
 * tesseract.js — nothing is uploaded anywhere, which is why this page can be
 * public.
 */
export function ReceiptScanPage() {
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [extracted, setExtracted] = useState<OcrExtract | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  /** One place for the cooldown, whichever way the text was obtained. */
  const allowed = (): boolean => {
    const limited = checkRateLimit('ocr:scan', LIMITS.ocr)
    if (limited.ok) return true
    setError(limited.message)
    return false
  }

  const readImage = async (file: File | null) => {
    setError('')
    setCopied(false)
    setExtracted(null)
    if (!file) {
      setFileName('')
      return
    }
    const valid = validateProofFile(file)
    if (!valid.ok) {
      setError(valid.message)
      setFileName('')
      if (fileInput.current) fileInput.current.value = ''
      return
    }
    if (!allowed()) {
      if (fileInput.current) fileInput.current.value = ''
      return
    }
    setFileName(file.name)
    setBusy(true)
    try {
      setExtracted(await runReceiptOcr(file))
    } catch {
      // `runReceiptOcr` already turns a dead engine into an extract with a
      // note; reaching here means something stranger happened, and the Guest's
      // next step is the same either way.
      setError('That image could not be read. Type the details from your receipt instead.')
    } finally {
      setBusy(false)
    }
  }

  const readText = () => {
    setError('')
    setCopied(false)
    setExtracted(null)
    if (!text.trim()) {
      setError('Paste the text of your receipt first, or choose a screenshot above.')
      return
    }
    if (!allowed()) return
    setExtracted(extractReceiptFields(text))
  }

  const copy = async () => {
    const reference = extracted?.reference
    if (!reference) return
    try {
      await navigator.clipboard?.writeText(reference)
      setCopied(true)
    } catch {
      // Clipboard access can be denied; the number is on screen and selectable.
      setCopied(false)
    }
  }

  const rows = extracted ? scanFields(extracted) : []
  const missing = extracted ? unreadFields(extracted) : []
  const verdict = extracted ? scanVerdict(extracted) : null

  return (
    <Page>
      <Container width="content">
        <PageHeader
          eyebrow="Payment proof"
          title={
            <>
              Check what the app reads off your <em className="font-normal italic">receipt</em>
            </>
          }
          lead={
            <p>
              Choose the screenshot you will submit, or paste the text on it, and see exactly which
              reference, amount, sender and date the app can read — and which field each one lands in.
              The image is read in your browser and nothing is uploaded.
            </p>
          }
          actions={
            <Link className="btn-secondary btn-sm" to="/book">
              Start a booking
            </Link>
          }
        />

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <Card padding="lg">
            <h2 className="font-serif text-xl text-forest-900">1 · Your receipt</h2>
            <p className="mt-2 text-sm leading-relaxed text-forest-700">
              A screenshot from GCash, Maya, or a bank app. JPG, PNG or WEBP, up to 5&nbsp;MB.
            </p>

            <label className="mt-4 block cursor-pointer rounded-[10px] border border-dashed border-forest-900/20 bg-white/70 px-4 py-5 text-sm text-forest-800 transition-colors hover:border-forest-900/40 focus-within:border-forest-700">
              <span className="flex items-center gap-2 font-medium">
                <CreditCard size={18} aria-hidden="true" /> Choose a screenshot
              </span>
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => void readImage(e.target.files?.[0] ?? null)}
                className="mt-3 block w-full cursor-pointer text-xs file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-forest-800 file:px-3 file:py-2 file:text-xs file:font-medium file:text-cream-50 hover:file:bg-forest-900"
              />
              {fileName && <span className="mt-2 block text-[11px] text-forest-600">{fileName} chosen.</span>}
            </label>

            {busy && (
              <p className="mt-3 text-[12px] text-forest-700" role="status" aria-live="polite">
                <span className="inline-block animate-pulse" aria-hidden="true">
                  ●
                </span>{' '}
                Reading your receipt — this runs in your browser and can take a moment…
              </p>
            )}

            <div className="mt-6 border-t border-forest-900/10 pt-5">
              <Field
                label="No screenshot? Paste the text"
                hint="Open your receipt, select the text under it, and paste it here. Useful when the image is too small to read."
              >
                <Textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={5}
                  spellCheck={false}
                  placeholder={'Ref No. 7044 357 122304\nAug 26, 2026 10:23 AM\nTotal Amount Sent ₱1,020.00'}
                />
              </Field>
              <button type="button" onClick={readText} disabled={busy} className="btn-secondary btn-sm mt-3">
                Read pasted text
              </button>
            </div>

            {error && (
              <Alert tone="danger" className="mt-4 text-xs">
                {error}
              </Alert>
            )}
          </Card>

          <Card padding="lg">
            <h2 className="font-serif text-xl text-forest-900">2 · What was read</h2>
            {!extracted && (
              <p className="mt-2 text-sm leading-relaxed text-forest-700">
                Nothing read yet. Choose a screenshot or paste the receipt text — the values appear
                here, together with the field each one is written to.
              </p>
            )}

            {extracted && verdict && (
              <div aria-live="polite" className="mt-3">
                <Alert tone={verdict.tone} title={verdict.headline} className="text-xs">
                  {verdict.detail}
                </Alert>

                <dl className="mt-4 space-y-3">
                  {rows.map((row) => (
                    <div key={row.key} className="rounded-[10px] border border-forest-900/10 bg-white/60 px-3 py-2.5">
                      <dt className="text-[11px] uppercase tracking-wide text-forest-600">{row.label}</dt>
                      <dd className="mt-0.5 font-mono text-base break-all text-forest-900">
                        {row.value}
                        {row.key === 'reference' && (
                          <button
                            type="button"
                            onClick={() => void copy()}
                            className="ml-2 inline-flex items-center gap-1 align-middle font-sans text-[11px] text-forest-600 underline underline-offset-2 hover:text-forest-900"
                          >
                            {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                            {copied ? 'Copied' : 'Copy'}
                          </button>
                        )}
                      </dd>
                      {row.note && <dd className="mt-1 text-[11px] text-amber-800">{row.note}</dd>}
                    </div>
                  ))}
                </dl>

                {missing.length > 0 && (
                  <Alert tone="warning" className="mt-3 text-xs">
                    Could not read: {missing.join(', ')}. Type {missing.length === 1 ? 'it' : 'them'} from
                    your receipt when you submit your proof.
                  </Alert>
                )}

                {extracted.notes.length > 0 && (
                  <ul className="mt-3 space-y-1 text-[11px] leading-relaxed text-forest-700">
                    {extracted.notes.map((note) => (
                      <li key={note}>• {note}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Card>
        </div>

        <Card padding="lg" className="mt-6">
          <h2 className="font-serif text-xl text-forest-900">3 · Where each value lands</h2>
          <p className="mt-2 text-sm leading-relaxed text-forest-700">
            When you submit a proof, the value you confirm is written on your Booking and an untouched
            copy of what the receipt said is kept beside it, so the Admin can see both.
          </p>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[38rem] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-forest-900/15 text-[11px] uppercase tracking-wide text-forest-600">
                  <th scope="col" className="py-2 pr-3 font-medium">Form field</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Booking field</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Evidence kept as</th>
                  <th scope="col" className="py-2 font-medium">Read back in</th>
                </tr>
              </thead>
              <tbody className="text-forest-800">
                <tr className="border-b border-forest-900/10">
                  <td className="py-2 pr-3">Reference number</td>
                  <td className="py-2 pr-3 font-mono">payment_reference</td>
                  <td className="py-2 pr-3 font-mono">ocr_reference</td>
                  <td className="py-2">Payment references</td>
                </tr>
                <tr className="border-b border-forest-900/10">
                  <td className="py-2 pr-3">Amount you sent</td>
                  <td className="py-2 pr-3 font-mono">amount_claimed</td>
                  <td className="py-2 pr-3 font-mono">ocr_amount</td>
                  <td className="py-2">Verification queue</td>
                </tr>
                <tr className="border-b border-forest-900/10">
                  <td className="py-2 pr-3">Sender on the receipt</td>
                  <td className="py-2 pr-3 font-mono">payment_sender_name</td>
                  <td className="py-2 pr-3 font-mono">ocr_sender_name</td>
                  <td className="py-2">Verification queue</td>
                </tr>
                <tr>
                  <td className="py-2 pr-3">Date on the receipt</td>
                  <td className="py-2 pr-3 font-mono">payment_date</td>
                  <td className="py-2 pr-3 font-mono">ocr_payment_date</td>
                  <td className="py-2">Verification queue</td>
                </tr>
              </tbody>
            </table>
          </div>

          {extracted?.reference && (
            <p className="mt-3 text-[11px] leading-relaxed text-forest-600">
              Once the Admin verifies it, your reference becomes a row in{' '}
              <span className="font-mono">payment_references</span> keyed{' '}
              <span className="font-mono break-all">
                {paymentReferenceDocId(extracted.reference, '<your booking id>')}
              </span>
              . The same reference cannot be filed twice for one Booking.
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link className="btn-primary btn-sm" to="/book/pay">
              Add a proof to a booking
            </Link>
            <Link className="text-link text-sm" to="/support">
              Something looks wrong
            </Link>
          </div>
        </Card>

        <Card padding="lg" className="mt-6">
          <h2 className="flex items-center gap-2 font-serif text-xl text-forest-900">
            <Sparkle size={18} aria-hidden="true" /> What this reader never does
          </h2>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed text-forest-700">
            <li>
              • It never marks a payment as paid.{' '}
              <span className="font-mono text-xs">
                canAutoVerifyFromOcr() === {String(canAutoVerifyFromOcr())}
              </span>{' '}
              is the rule; the Admin's check against the screenshot is what moves money.
            </li>
            <li>• It never uploads or stores your image — the reading happens in this tab.</li>
            <li>• It never decides between two amounts a receipt prints. You choose.</li>
            <li>
              • It never invents a reference. Anything shorter than 10 digits, or a 14–16 digit card
              number, is left for you to type.
            </li>
          </ul>
        </Card>
      </Container>
    </Page>
  )
}
