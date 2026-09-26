import { useState } from 'react'
import { SceneHeader } from '../components/Scene'
import { FAQS } from '../config/site'
import { Chevron } from '../lib/icons'

export function FAQ() {
  const [open, setOpen] = useState<number | null>(0)

  return (
    <section id="faqs" className="py-24 lg:py-36 bg-cream-50">
      <div className="mx-auto max-w-4xl px-5 lg:px-8">
        <SceneHeader index="—" eyebrow="FAQs" title="Common Questions">
          <p>
            A few answers to the most common questions. For anything else, message the Hacienda —
            we're happy to help.
          </p>
        </SceneHeader>

        <div className="mt-14 divide-y divide-forest-900/10 border-t border-b border-forest-900/10 reveal">
          {FAQS.map((f, i) => {
            const isOpen = open === i
            return (
              <div key={f.q}>
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="w-full flex items-start justify-between gap-6 text-left py-6 group"
                  aria-expanded={isOpen}
                >
                  <span className="font-serif text-lg lg:text-xl text-forest-900 pr-2">
                    {f.q}
                  </span>
                  <Chevron
                    size={20}
                    className={`text-forest-600 mt-1 shrink-0 transition-transform ${
                      isOpen ? 'rotate-180 text-forest-800' : ''
                    }`}
                  />
                </button>
                <div
                  className={`grid transition-all duration-500 ease-out-expo ${
                    isOpen ? 'grid-rows-[1fr] opacity-100 pb-6' : 'grid-rows-[0fr] opacity-0'
                  }`}
                >
                  <div className="overflow-hidden">
                    <p className="text-forest-800/85 leading-relaxed max-w-3xl">{f.a}</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
