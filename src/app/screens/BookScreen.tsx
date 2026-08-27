import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ACCOMMODATIONS, BUSINESS } from '../../config/site'
import { cloudBookingsDB } from '../../lib/firestoreBookings'
import { isFirebaseConfigured } from '../../lib/firebase'
import { ArrowRight, Calendar, Messenger, Sparkle } from '../../lib/icons'
import { SmartImage } from '../../components/SmartImage'
import { Screen } from '../components/Screen'

type FormState = {
  check_in: string
  check_out: string
  guests: number
  accommodation: string
  name: string
  phone: string
  email: string
  special_requests: string
}

type Errors = Partial<Record<keyof FormState, string>>

const today = () => new Date().toISOString().slice(0, 10)

const OPTIONS = [
  ...ACCOMMODATIONS.filter((a) => a.active).map((a) => ({ id: a.id, label: a.name })),
  { id: 'other', label: 'Other / Ask us' },
]

export function BookScreen() {
  const [params] = useSearchParams()
  const initialAccommodation = params.get('accommodation') || ACCOMMODATIONS[0].id

  const [form, setForm] = useState<FormState>({
    check_in: '',
    check_out: '',
    guests: 2,
    accommodation: initialAccommodation,
    name: '',
    phone: '',
    email: '',
    special_requests: '',
  })
  const [errors, setErrors] = useState<Errors>({})
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [submittedRef, setSubmittedRef] = useState('')

  useEffect(() => {
    const next = params.get('accommodation')
    if (next) setForm((f) => ({ ...f, accommodation: next }))
  }, [params])

  const selectedAcc = useMemo(
    () => ACCOMMODATIONS.find((a) => a.id === form.accommodation),
    [form.accommodation],
  )

  const nights = useMemo(() => {
    if (!form.check_in || !form.check_out) return 0
    const a = new Date(form.check_in).getTime()
    const b = new Date(form.check_out).getTime()
    if (Number.isNaN(a) || Number.isNaN(b)) return 0
    return Math.max(0, Math.round((b - a) / (1000 * 60 * 60 * 24)))
  }, [form.check_in, form.check_out])

  const estimatedTotal = useMemo(() => {
    if (!selectedAcc?.price || !nights) return null
    return selectedAcc.price * nights
  }, [selectedAcc, nights])

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors((e) => ({ ...e, [k]: undefined }))
  }

  const validate = (): boolean => {
    const e: Errors = {}
    if (!form.check_in) e.check_in = 'Select check-in'
    if (!form.check_out) e.check_out = 'Select check-out'
    if (form.check_in && form.check_out && nights <= 0) e.check_out = 'Must be after check-in'
    if (!form.guests || form.guests < 1) e.guests = 'At least 1 guest'
    if (!form.accommodation) e.accommodation = 'Select a stay'
    if (!form.name.trim()) e.name = 'Enter your name'
    if (!form.phone.trim()) e.phone = 'Enter a mobile number'
    if (!form.email.trim()) e.email = 'Enter an email'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Enter a valid email'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const onSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!validate()) return
    setStatus('submitting')
    setErrorMsg('')
    try {
      const b = await cloudBookingsDB.add({
        guest_name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        check_in: form.check_in,
        check_out: form.check_out,
        guests: Number(form.guests),
        accommodation: form.accommodation,
        special_requests: form.special_requests.trim(),
      })
      setSubmittedRef(b.id.slice(0, 8).toUpperCase())
      setStatus('success')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to send request. Please try again.'
      setErrorMsg(message)
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <Screen>
        <div className="bg-white rounded-[24px] border border-forest-900/5 shadow-card p-6 text-center">
          <div className="mx-auto w-14 h-14 rounded-full bg-forest-100 text-forest-700 flex items-center justify-center">
            <Sparkle size={22} />
          </div>
          <div className="eyebrow mt-5">Request received</div>
          <h1 className="display text-3xl mt-2 text-forest-900">Thank you</h1>
          <p className="mt-3 text-sm text-forest-800/80 leading-relaxed">
            Hacienda de LuisAna will contact you to confirm availability. This is an inquiry — no
            payment yet.
          </p>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-forest-50 border border-forest-100 text-forest-800 px-3 py-1.5 text-xs">
            Reference <span className="font-mono font-semibold">{submittedRef}</span>
          </div>
          <div className="mt-6 flex flex-col gap-2">
            <a
              href={BUSINESS.contact.messenger}
              target="_blank"
              rel="noreferrer"
              className="btn-primary w-full"
            >
              Message the host <Messenger size={16} />
            </a>
            <Link to="/app" className="btn-ghost w-full">
              Back to home
            </Link>
          </div>
        </div>
      </Screen>
    )
  }

  return (
    <Screen>
      <div className="eyebrow">Book your stay</div>
      <h1 className="display text-[28px] text-forest-900 mt-1">Plan your dates</h1>
      <p className="mt-2 text-sm text-forest-800/80 leading-relaxed">
        Send an inquiry — the host confirms availability. No payment at this step.
      </p>

      {!isFirebaseConfigured ? (
        <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-800">
          Demo mode: request is saved on this device.
        </div>
      ) : null}

      <div className="mt-4 rounded-[22px] overflow-hidden bg-white border border-forest-900/5">
        <SmartImage
          src={selectedAcc?.images[0] || '/images/gmaps/img-07.jpg'}
          alt={selectedAcc?.name || 'Hacienda'}
          className="h-28 w-full object-cover"
        />
        <div className="p-4">
          <div className="text-[10px] uppercase tracking-eyebrow text-forest-600">Selected stay</div>
          <div className="font-serif text-xl text-forest-900">{selectedAcc?.name || 'Ask us'}</div>
        </div>
      </div>

      <form onSubmit={onSubmit} noValidate className="mt-4 space-y-4">
        {status === 'error' ? (
          <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {errorMsg}
          </div>
        ) : null}

        <Field label="Stay" error={errors.accommodation}>
          <select
            className="field appearance-none"
            value={form.accommodation}
            onChange={(e) => set('accommodation', e.target.value)}
          >
            {OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Check-in" error={errors.check_in}>
            <input
              type="date"
              className="field"
              min={today()}
              value={form.check_in}
              onChange={(e) => set('check_in', e.target.value)}
            />
          </Field>
          <Field label="Check-out" error={errors.check_out}>
            <input
              type="date"
              className="field"
              min={form.check_in || today()}
              value={form.check_out}
              onChange={(e) => set('check_out', e.target.value)}
            />
          </Field>
        </div>

        <Field label="Guests" error={errors.guests}>
          <input
            type="number"
            min={1}
            max={20}
            inputMode="numeric"
            className="field"
            value={form.guests}
            onChange={(e) => set('guests', Math.max(1, Number(e.target.value) || 1))}
          />
        </Field>

        <Field label="Your name" error={errors.name}>
          <input
            className="field"
            placeholder="Juan Dela Cruz"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            autoComplete="name"
          />
        </Field>
        <Field label="Mobile number" error={errors.phone}>
          <input
            className="field"
            placeholder="09XX XXX XXXX"
            inputMode="tel"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
            autoComplete="tel"
          />
        </Field>
        <Field label="Email" error={errors.email}>
          <input
            className="field"
            placeholder="you@email.com"
            type="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            autoComplete="email"
          />
        </Field>
        <Field label="Special requests">
          <textarea
            className="field min-h-[88px] resize-y"
            placeholder="Pets, late arrival, birthday…"
            value={form.special_requests}
            onChange={(e) => set('special_requests', e.target.value)}
          />
        </Field>

        <div className="rounded-2xl bg-white border border-forest-900/5 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="inline-flex items-center gap-1.5 text-forest-700">
              <Calendar size={14} /> Nights
            </span>
            <span className="font-medium text-forest-900">{nights || '—'}</span>
          </div>
          <div className="mt-3 pt-3 border-t border-forest-900/5 flex items-end justify-between">
            <div className="text-[10px] uppercase tracking-eyebrow text-forest-600">Estimated total</div>
            <div className="text-right">
              {estimatedTotal ? (
                <>
                  <div className="font-serif text-2xl text-forest-900">₱{estimatedTotal.toLocaleString()}</div>
                  <div className="text-[11px] text-forest-700/60">placeholder rate</div>
                </>
              ) : (
                <div className="text-sm text-forest-800/70">Confirmed with host</div>
              )}
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={status === 'submitting'}
          className="btn-primary w-full disabled:opacity-70"
        >
          {status === 'submitting' ? 'Sending…' : 'Send booking request'}
          {status !== 'submitting' ? <ArrowRight size={16} /> : null}
        </button>
        <p className="text-[11px] text-forest-700/60 leading-relaxed">
          The host will confirm dates and the final rate. Prefer to chat?{' '}
          <a href={BUSINESS.contact.messenger} target="_blank" rel="noreferrer" className="underline">
            Messenger
          </a>
          .
        </p>
      </form>
    </Screen>
  )
}

function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : null}
    </label>
  )
}
