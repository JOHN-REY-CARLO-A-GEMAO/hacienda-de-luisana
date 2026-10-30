import { Container } from '../components/ui'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FAQS } from '../config/site'
import { Chevron } from '../lib/icons'

/**
 * The question list on /faqs — the accordion only.
 *
 * It used to open with its own `SceneHeader` ("FAQs / Common Questions") under
 * the page's own header ("FAQs / Common questions"), so a Guest met the same
 * eyebrow and the same sentence twice before the first question. A page states
 * its heading once (`PageShell`), and the section it mounts starts with its
 * content.
 *
 * The first answer is open on arrival: a page of twelve closed rows tells a
 * visitor nothing about whether the answers are worth opening.
 */
export function FAQ() {
  const [open, setOpen] = useState<number | null>(0)

  return (
    <section id="faqs" className="bg-cream-50 dark:bg-forest-950 pt-10 pb-16 lg:pb-20">
      <Container width="narrow">
        <div className="divide-y divide-forest-900/10 dark:divide-cream-100/15 border-t border-b border-forest-900/10 dark:border-cream-100/15 reveal">
          {FAQS.map((f, i) => {
            const isOpen = open === i
            return (
              <div key={f.q}>
                <button
                  type="button"
                  id={`faq-question-${i}`}
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="w-full flex items-start justify-between gap-6 text-left py-6 group focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-600 dark:focus-visible:outline-brass-400"
                  aria-expanded={isOpen}
                  aria-controls={`faq-answer-${i}`}
                >
                  <span className="font-serif text-lg lg:text-xl text-forest-900 dark:text-cream-50 pr-2">
                    {f.q}
                  </span>
                  <Chevron
                    size={20}
                    aria-hidden="true"
                    className={`text-forest-600 dark:text-sage-400 mt-1 shrink-0 transition-transform ${
                      isOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>
                {/*
                  The closed answer is `invisible`, not just transparent: a
                  clipped row stays in the accessibility tree and a screen
                  reader reads twelve answers nobody asked for. `visibility`
                  still animates discretely, so the open/close transition is
                  unchanged.
                */}
                <div
                  id={`faq-answer-${i}`}
                  role="region"
                  aria-labelledby={`faq-question-${i}`}
                  className={`grid transition-[grid-template-rows,opacity,visibility] duration-500 ease-out-expo ${
                    isOpen ? 'visible grid-rows-[1fr] opacity-100 pb-6' : 'invisible grid-rows-[0fr] opacity-0'
                  }`}
                >
                  <div className="overflow-hidden">
                    <p className="text-forest-800/85 dark:text-cream-100/85 leading-relaxed max-w-3xl">{f.a}</p>
                    {f.link && (
                      <Link to={f.link.to} className="text-link mt-3 inline-block font-medium text-forest-800 dark:text-cream-100">
                        {f.link.label}
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </Container>
    </section>
  )
}
