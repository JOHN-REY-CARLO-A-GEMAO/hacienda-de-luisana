import { useEffect, useState } from 'react'
import { COOKIE, getCookie, setCookie } from '../lib/cookies'

const STEPS = [
  'Create or sign in to your Guest account.',
  'Browse accommodations and pick dates.',
  'Check availability before you send a request.',
  'Submit a booking inquiry (not instant confirmation).',
  'Read and accept the Terms and Conditions.',
  'After Admin approval, choose a payment plan and pay externally.',
  'Upload your receipt. OCR may suggest the reference and amount — confirm or correct them.',
  'Wait while the Admin verifies the reference against their valid-payment list.',
  'When payment is verified your stay is Reserved.',
  'Use your RFID or Mobile Key on the stay dates. Access attempts are logged.',
  'Complete the stay, then leave a star rating and optional review.',
]

export function Tutorial({ force }: { force?: boolean }) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (force || getCookie(COOKIE.tutorialDone) !== '1') setOpen(true)
  }, [force])

  const close = (remember: boolean) => {
    setOpen(false)
    if (remember) setCookie(COOKIE.tutorialDone, '1', { days: 180, sameSite: 'Lax' })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setStep(0)
          setOpen(true)
        }}
        className="fixed bottom-20 right-4 z-30 text-[11px] px-3 py-2 rounded-full bg-forest-900 text-cream-50 shadow-card lg:bottom-6"
      >
        Replay tutorial
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-forest-950/50 flex items-end sm:items-center justify-center p-4" role="dialog" aria-modal>
      <div className="bg-white rounded-[24px] max-w-md w-full p-6 shadow-card">
        <div className="eyebrow">How a stay works</div>
        <h2 className="font-serif text-2xl mt-1 text-forest-900">
          Step {step + 1} of {STEPS.length}
        </h2>
        <p className="mt-3 text-sm text-forest-800 leading-relaxed">{STEPS[step]}</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <button type="button" className="btn-ghost text-xs" onClick={() => close(true)}>
            Skip
          </button>
          {step > 0 && (
            <button type="button" className="btn-ghost text-xs" onClick={() => setStep((s) => s - 1)}>
              Back
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button type="button" className="btn-primary text-xs" onClick={() => setStep((s) => s + 1)}>
              Next
            </button>
          ) : (
            <button type="button" className="btn-primary text-xs" onClick={() => close(true)}>
              Done
            </button>
          )}
          <button type="button" className="text-xs underline ml-auto" onClick={() => close(false)}>
            Exit
          </button>
        </div>
      </div>
    </div>
  )
}
