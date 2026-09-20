import { useRef, useState, type RefObject } from 'react'
import { cloudBookingsDB } from '../../lib/firestoreBookings'
import { isFirebaseConfigured } from '../../lib/firebase'
import { normalizeKycStatus } from '../../lib/booking'
import { KYC_UPLOAD_UNAVAILABLE_MESSAGE, uploadKycDocument } from '../../lib/kyc'
import type { Booking } from '../../lib/storage'

/**
 * The Guest's own KYC step, on the tracking page they already have the link to.
 *
 * Documents go to Firebase Storage under the Guest's own uid and the Booking is
 * moved with the lifecycle's `UploadKyc`, so the web and the mobile app leave the
 * same trail (ticket #13). Where there is no Firebase there is no upload: an ID
 * is never parked in a browser the Host cannot read, and the Guest is told what
 * to do instead rather than watching a spinner that will not finish.
 */
export function KycUpload({ booking }: { booking: Booking }) {
  const [idFile, setIdFile] = useState<File | null>(null)
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)
  const [swapping, setSwapping] = useState(false)
  // Set once an upload lands: the page that showed this may be holding a snapshot
  // of the Booking from before, and the Guest should not be invited to send twice.
  const [sent, setSent] = useState(false)
  const idInput = useRef<HTMLInputElement>(null)
  const receiptInput = useRef<HTMLInputElement>(null)

  const status = cloudBookingsDB.readStatus(booking)
  const kyc = sent ? 'submitted' : normalizeKycStatus(booking.kyc_status)
  const canUpload = status === 'Pending' || status === 'KYC Submitted'

  if (!canUpload) {
    // Nothing to send: either the Host has the ID or the request is over.
    if (kyc === 'approved' && status !== 'Cancelled' && status !== 'Rejected') {
      return (
        <div className="rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-xs text-emerald-900 leading-relaxed">
          <strong className="block">Your ID was accepted.</strong>
          Your dates are held firmly now — no countdown left to run.
        </div>
      )
    }
    return null
  }

  const send = async () => {
    if (!idFile) {
      setMessage({ tone: 'bad', text: 'Choose a photo of your government ID first.' })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const refId = booking.ref_id || booking.id
      const idResult = await uploadKycDocument({ file: idFile, bookingRefId: refId, kind: 'id' })
      if (!idResult.ok) {
        setMessage({ tone: 'bad', text: idResult.message })
        return
      }
      let receiptUrl: string | undefined
      if (receiptFile) {
        const receiptResult = await uploadKycDocument({ file: receiptFile, bookingRefId: refId, kind: 'receipt' })
        if (!receiptResult.ok) {
          setMessage({ tone: 'bad', text: receiptResult.message })
          return
        }
        receiptUrl = receiptResult.url
      }

      const result = await cloudBookingsDB.transition(
        booking.id,
        {
          type: 'UploadKyc',
          kyc_id_url: idResult.url,
          ...(receiptUrl ? { kyc_receipt_url: receiptUrl } : {}),
        },
        {
          actor: 'guest',
          actor_id: booking.uid || idResult.uid,
          actor_name: booking.guest_name,
        },
      )
      if (!result.ok) {
        setMessage({ tone: 'bad', text: result.reason })
        return
      }
      setIdFile(null)
      setReceiptFile(null)
      setSwapping(false)
      setSent(true)
      if (idInput.current) idInput.current.value = ''
      if (receiptInput.current) receiptInput.current.value = ''
      setMessage({
        tone: 'good',
        text: 'Sent. The host will read it and either approve your dates or tell you what to fix.',
      })
    } catch (e) {
      // A refused write (permissions, connection) is the Guest's to hear about,
      // not something to leave in the console while the spinner stops.
      console.warn('[KYC] could not record the upload', e)
      setMessage({
        tone: 'bad',
        text:
          'The photo went up but your booking could not be updated. Please try again — ' +
          'if it keeps failing, email the photo to the host and mention your reference.',
      })
    } finally {
      setBusy(false)
    }
  }

  // A Booking made before the website attached an identity cannot be claimed by
  // this browser: firestore.rules keys guest updates to the uid written at
  // creation, and uid is not a key a Guest may add afterwards. Say so, rather
  // than letting the upload fail on a permission error.
  const unlinked = isFirebaseConfigured && !booking.uid
  const showControls = (kyc !== 'submitted' || swapping) && !unlinked

  return (
    <div className="rounded-2xl border border-forest-900/10 bg-white p-4">
      <div className="text-[10px] uppercase tracking-eyebrow text-forest-600 font-semibold">
        Step 2 · Send your government ID
      </div>

      {kyc === 'rejected' && booking.kyc_reject_reason ? (
        <p className="mt-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 leading-relaxed">
          <strong className="block">The host could not accept your ID.</strong>
          {booking.kyc_reject_reason}
          <span className="block mt-1 text-amber-800/80">
            Your dates are still held while you send another — but only for as long as the countdown
            above shows.
          </span>
        </p>
      ) : kyc === 'submitted' ? (
        <p className="mt-2 text-xs text-forest-800 leading-relaxed">
          Your ID is with the host.{' '}
          <button onClick={() => setSwapping(true)} className="underline font-medium">
            Send a different photo
          </button>
        </p>
      ) : (
        <p className="mt-2 text-xs text-forest-700/80 leading-relaxed">
          The host has to see a valid government ID before they can approve your dates. A clear photo
          of a driver's license, passport or UMID is fine, up to 5MB. Your receipt can go with it.
        </p>
      )}

      {unlinked && (
        <p className="mt-3 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 leading-relaxed">
          This request was made before the website could sign your browser in, so it is not linked to
          you here and we cannot attach an ID to it. Send your ID from the Hacienda de LuisAna mobile
          app, or email it to the host quoting reference{' '}
          <strong>{booking.ref_id || booking.id.slice(0, 8).toUpperCase()}</strong>.
        </p>
      )}

      {showControls &&
        (isFirebaseConfigured ? (
          <div className="mt-3 space-y-2">
            <FileRow
              label="Government ID"
              hint="Required · jpg, png, webp or heic, under 5MB"
              file={idFile}
              inputRef={idInput}
              onPick={setIdFile}
            />
            <FileRow
              label="Receipt"
              hint="Optional · the payment or deposit receipt"
              file={receiptFile}
              inputRef={receiptInput}
              onPick={setReceiptFile}
            />
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                onClick={() => void send()}
                disabled={busy}
                className="px-4 py-2.5 rounded-xl text-xs font-medium bg-forest-800 text-cream-50 hover:bg-forest-900 transition disabled:opacity-50"
              >
                {busy ? 'Uploading…' : kyc === 'rejected' ? 'Send a new ID' : 'Send my ID'}
              </button>
              {kyc === 'submitted' && swapping && (
                <button
                  onClick={() => setSwapping(false)}
                  disabled={busy}
                  className="px-4 py-2.5 rounded-xl text-xs text-forest-700 hover:bg-cream-100 transition disabled:opacity-50"
                >
                  Keep the one I sent
                </button>
              )}
            </div>
          </div>
        ) : (
          <p className="mt-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-xl px-3 py-2 leading-relaxed">
            {KYC_UPLOAD_UNAVAILABLE_MESSAGE}
          </p>
        ))}

      {message && (
        <p
          className={`mt-3 text-xs rounded-xl px-3 py-2 leading-relaxed border ${
            message.tone === 'good'
              ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
              : 'bg-red-50 text-red-800 border-red-200'
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  )
}

/** One labelled file picker, showing what was chosen before it is sent. */
function FileRow({
  label,
  hint,
  file,
  inputRef,
  onPick,
}: {
  label: string
  hint: string
  file: File | null
  inputRef: RefObject<HTMLInputElement>
  onPick: (file: File | null) => void
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-forest-900">{label}</span>
      <span className="block text-[11px] text-forest-700/70 mb-1">{hint}</span>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
        className="block w-full text-xs text-forest-800 file:mr-3 file:px-3 file:py-2 file:rounded-xl file:border-0 file:bg-cream-100 file:text-forest-800 file:text-xs file:font-medium hover:file:bg-cream-200 file:cursor-pointer"
      />
      {file && <span className="block mt-1 text-[11px] text-forest-700">{file.name} chosen.</span>}
    </label>
  )
}
