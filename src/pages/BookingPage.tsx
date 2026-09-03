import { useEffect, useMemo, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { ACCOMMODATIONS, BUSINESS } from '../config/site'
import { cloudBookingsDB } from '../lib/firestoreBookings'
import { isFirebaseConfigured } from '../lib/firebase'
import { Calendar, Users, Bed, ArrowRight, Sparkle, MapPin, Phone } from '../lib/icons'
import { SmartImage } from '../components/SmartImage'

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
  { id: 'other', label: 'Other / Ask Us' },
]

export function BookingPage() {
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
  const [errorMsg, setErrorMsg] = useState<string>('')
  const [submittedRef, setSubmittedRef] = useState<string>('')

  useEffect(() => {
    if (status === 'success') window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [status])

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
    if (!form.check_in) e.check_in = 'Select a check-in date'
    if (!form.check_out) e.check_out = 'Select a check-out date'
    if (form.check_in && form.check_out && nights <= 0) e.check_out = 'Check-out must be after check-in'
    if (!form.guests || form.guests < 1) e.guests = 'At least 1 guest'
    if (!form.accommodation) e.accommodation = 'Select an accommodation'
    if (!form.name.trim()) e.name = 'Please enter your name'
    if (!form.phone.trim()) e.phone = 'Please enter a mobile number'
    if (!form.email.trim()) e.email = 'Please enter an email'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'That doesn\'t look like a valid email'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const onSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!validate()) return
    setStatus('submitting')
    setErrorMsg('')
    try {
      // Use cloud-aware service: Firestore if configured, else localStorage
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
      // Small UX delay
      await new Promise((r) => setTimeout(r, 400))
      setSubmittedRef(b.id.slice(0, 8).toUpperCase())
      setStatus('success')
    } catch (err: any) {
      console.error('[Booking] failed', err)
      setErrorMsg(err?.message || 'Failed to send request. Please try again.')
      setStatus('error')
    }
  }

  if (status === 'success') {
    return <SuccessScreen reference={submittedRef} isCloud={cloudBookingsDB.isCloud} onNew={() => {
      setStatus('idle')
      setSubmittedRef('')
      setForm((f) => ({ ...f, name: '', phone: '', email: '', special_requests: '' }))
    }} />
  }

  return (
    <div className="pt-28 pb-24 bg-cream-50 min-h-screen">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="max-w-2xl">
          <div className="eyebrow">Book Your Stay</div>
          <h1 className="display text-4xl sm:text-5xl lg:text-6xl mt-4 text-forest-900">
            Plan Your Stay
          </h1>
          <p className="mt-5 text-forest-800/80 leading-relaxed">
            Send us a booking request and Hacienda de LuisAna will get back to you to confirm
            availability and finalize your reservation. This is a booking inquiry — not an
            instant-confirmation engine.
          </p>
          {!isFirebaseConfigured && (
            <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800">
              <strong>Demo mode:</strong> Firebase not configured — your request will be stored locally in this browser.
              Owner can see it at <Link to="/admin" className="underline">/admin</Link> on this device.
            </div>
          )}
          {cloudBookingsDB.isCloud && (
            <div className="mt-4 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-xs text-emerald-800">
              ✓ Secured by Firebase — your request will be saved to the cloud and the owner will be notified.
            </div>
          )}
        </div>

        <div className="mt-12 grid lg:grid-cols-3 gap-8 lg:gap-10">
          <form
            onSubmit={onSubmit}
            noValidate
            className="lg:col-span-2 bg-white rounded-[28px] border border-forest-900/5 shadow-card p-6 sm:p-8 lg:p-10 space-y-8"
          >
            {status === 'error' && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                {errorMsg}
              </div>
            )}

            <div>
              <h2 className="font-serif text-2xl text-forest-900">Stay Details</h2>
              <div className="mt-6 grid sm:grid-cols-2 gap-5">
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
                <Field label="Number of guests" error={errors.guests}>
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
                <Field label="Accommodation" error={errors.accommodation}>
                  <select
                    className="field appearance-none pr-10"
                    value={form.accommodation}
                    onChange={(e) => set('accommodation', e.target.value)}
                  >
                    {OPTIONS.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>

            <div className="pt-2 border-t border-forest-900/5">
              <h2 className="font-serif text-2xl text-forest-900 mt-6">Your Details</h2>
              <div className="mt-6 grid sm:grid-cols-2 gap-5">
                <Field label="Name" error={errors.name} className="sm:col-span-2">
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
                <Field label="Special requests" className="sm:col-span-2">
                  <textarea
                    className="field min-h-[110px] resize-y"
                    placeholder="Bringing pets, celebrating a birthday, need extra bedding, arriving late…"
                    value={form.special_requests}
                    onChange={(e) => set('special_requests', e.target.value)}
                  />
                </Field>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={status === 'submitting'}
                className="btn-primary w-full sm:w-auto disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {status === 'submitting' ? 'Sending…' : 'Send Booking Request'}
                {status !== 'submitting' && <ArrowRight size={16} />}
              </button>
              <p className="text-xs text-forest-700/60 mt-4 max-w-md">
                By sending a request you agree to be contacted by the host to confirm availability
                and finalize your stay. No payment is taken at this step.
              </p>
            </div>
          </form>

          <aside className="lg:sticky lg:top-28 self-start">
            <div className="rounded-[28px] overflow-hidden border border-forest-900/5 shadow-card bg-white">
              <div className="relative">
                <SmartImage
                  src={selectedAcc?.images[0] || '/images/gmaps/img-07.jpg'}
                  alt={selectedAcc?.name || 'Hacienda'}
                  className="w-full h-40 object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-forest-950/60 to-transparent" />
                <div className="absolute bottom-3 left-4 text-cream-50">
                  <div className="text-[10px] uppercase tracking-eyebrow opacity-80">Selected</div>
                  <div className="font-serif text-lg">{selectedAcc?.name || 'Ask Us'}</div>
                </div>
              </div>
              <div className="p-6 space-y-4">
                <SummaryRow icon={Calendar} label="Check-in" value={form.check_in || '—'} />
                <SummaryRow icon={Calendar} label="Check-out" value={form.check_out || '—'} />
                <SummaryRow icon={Users} label="Guests" value={String(form.guests)} />
                <SummaryRow icon={Bed} label="Accommodation" value={OPTIONS.find(o => o.id === form.accommodation)?.label || '—'} />

                <div className="pt-4 border-t border-forest-900/10">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] uppercase tracking-eyebrow text-forest-600">Estimated Total</div>
                    <div className="text-right">
                      {estimatedTotal ? (
                        <>
                          <div className="font-serif text-2xl text-forest-900">₱{estimatedTotal.toLocaleString()}</div>
                          <div className="text-[11px] text-forest-700/60">{nights} night{nights > 1 ? 's' : ''} · placeholder rate</div>
                        </>
                      ) : (
                        <div className="text-sm text-forest-800/70">Confirmed with host</div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl bg-cream-100/70 p-4 text-xs text-forest-700 leading-relaxed">
                  <Sparkle size={14} className="inline mr-1 -mt-1 text-forest-600" />
                  Prices shown are editable placeholders. The host will confirm the final rate before
                  your reservation is finalized.
                </div>
              </div>
            </div>

            <div className="mt-6 bg-forest-900 text-cream-100 rounded-[28px] p-6">
              <div className="eyebrow text-cream-100/60">Prefer to Chat?</div>
              <div className="mt-3 space-y-3 text-sm">
                <a href={`tel:${BUSINESS.contact.phone.replace(/\s+/g,'')}`} className="flex items-center gap-3 hover:underline">
                  <Phone size={16} /> {BUSINESS.contact.phoneDisplay}
                </a>
                <a href={BUSINESS.contact.directions} target="_blank" rel="noreferrer" className="flex items-center gap-3 hover:underline">
                  <MapPin size={16} /> Get directions
                </a>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}

function Field({
  label, error, className = '', children,
}: {
  label: string
  error?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {error && <span className="mt-1.5 block text-xs text-red-600">{error}</span>}
    </label>
  )
}

function SummaryRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="inline-flex items-center gap-2 text-forest-700">
        <Icon size={15} className="text-forest-600" /> {label}
      </span>
      <span className="text-forest-900 font-medium text-right">{value}</span>
    </div>
  )
}

function SuccessScreen({ reference, onNew, isCloud }: { reference: string; onNew: () => void; isCloud: boolean }) {
  return (
    <div className="pt-28 pb-24 bg-cream-50 min-h-screen">
      <div className="mx-auto max-w-3xl px-5 lg:px-8">
        <div className="bg-white rounded-[28px] border border-forest-900/5 shadow-card p-8 sm:p-12 text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-forest-100 text-forest-700 flex items-center justify-center">
            <Sparkle size={26} />
          </div>
          <div className="eyebrow mt-6">Request Received</div>
          <h1 className="display text-4xl sm:text-5xl mt-3 text-forest-900">Thank you!</h1>
          <p className="mt-5 text-forest-800/80 leading-relaxed max-w-lg mx-auto">
            Your booking request has been received. Hacienda de LuisAna will contact you to
            confirm availability and finalize your reservation.
          </p>
          <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-forest-50 border border-forest-100 text-forest-800 px-4 py-2 text-xs">
            Reference: <span className="font-mono font-semibold">{reference}</span>
          </div>
          {isCloud && (
            <div className="mt-3 text-xs text-forest-600">Saved securely to Firebase Firestore</div>
          )}

          <div className="mt-10 flex flex-wrap gap-3 justify-center">
            <Link to="/" className="btn-ghost">Back to Home</Link>
            <a href={BUSINESS.contact.messenger} target="_blank" rel="noreferrer" className="btn-primary">
              Message the Host <ArrowRight size={16} />
            </a>
            <button onClick={onNew} className="btn bg-transparent text-forest-800 underline underline-offset-4">
              Send another request
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
