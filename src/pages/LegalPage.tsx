import { Link } from 'react-router-dom'
import { TERMS } from '../lib/legal'

export function LegalPage() {
  return (
    <div className="pt-28 pb-24 bg-cream-50 min-h-screen">
      <div className="mx-auto max-w-3xl px-5">
        <div className="eyebrow">Policies</div>
        <h1 className="display text-4xl sm:text-5xl mt-3 text-forest-900">Terms and house rules</h1>
        <p className="mt-4 text-forest-800/80 text-sm leading-relaxed">
          Please read these before you book or pay. Acceptance is never assumed — you must tick the box on
          the booking and payment steps.
        </p>
        <div className="mt-10 space-y-8">
          {TERMS.map((section) => (
            <section key={section.id} id={section.id} className="bg-white rounded-[24px] border border-forest-900/5 shadow-card p-6 sm:p-8">
              <h2 className="font-serif text-2xl text-forest-900">{section.title}</h2>
              <ul className="mt-4 space-y-2 text-sm text-forest-800/85 leading-relaxed list-disc pl-5">
                {section.body.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="mt-8 text-sm">
          <Link to="/book" className="text-forest-800 underline underline-offset-4">
            Continue to booking
          </Link>
        </p>
      </div>
    </div>
  )
}
