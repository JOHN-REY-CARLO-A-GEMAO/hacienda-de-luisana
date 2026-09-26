import { EXPERIENCES } from '../config/site'
import { ParallaxImage } from '../components/ParallaxImage'
import { SceneHeader } from '../components/Scene'

/**
 * Scene 04 — "The Experience". Dark panel with the Hacienda's own moments;
 * each card's photo drifts on scroll and lifts slightly on hover (desktop).
 */
export function Experience() {
  return (
    <section id="experience" className="py-24 lg:py-36 bg-forest-950 text-cream-100 relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.07] pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(circle at 25% 20%, #c6d6c1 0px, transparent 50%), radial-gradient(circle at 80% 70%, #d0b46e 0px, transparent 60%)',
        }}
        aria-hidden="true"
      />
      {/* Distant tree-line silhouette for horizon depth */}
      <svg
        className="pointer-events-none absolute inset-x-0 bottom-0 w-full h-40 text-forest-900/70"
        viewBox="0 0 1440 160"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          fill="currentColor"
          d="M0 160V96c40-8 70-30 110-30s60 22 100 22 70-44 120-44 60 30 110 30 80-58 130-58 60 40 110 40 60-26 110-26 70 36 120 36 70-50 120-50 60 34 110 34 60-14 110-14 60 24 80 24v96H0Z"
        />
      </svg>

      <div className="relative mx-auto max-w-7xl px-5 lg:px-8">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8">
          <SceneHeader
            index="04"
            eyebrow="The Experience"
            tone="dark"
            title={
              <>
                More Than Just a
                <br />
                <span className="italic font-light">Place to Stay</span>
              </>
            }
          />
          <p className="reveal max-w-md text-cream-100/70 leading-relaxed lg:pb-2">
            The Hacienda is a backdrop for the moments you'll remember — long meals, quiet mornings,
            and the kind of laughter that only happens away from the city.
          </p>
        </div>

        <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {EXPERIENCES.map((e, i) => (
            <article
              key={e.id}
              className={`reveal group relative ${i % 3 === 1 ? 'lg:mt-10' : ''}`}
              style={{ transitionDelay: `${i * 40}ms` }}
            >
              <ParallaxImage
                src={e.image}
                alt={e.title}
                range={0.06}
                className="aspect-[4/5] rounded-[24px] bg-forest-800 shadow-depth transition-transform duration-700 ease-out-expo lg:group-hover:-translate-y-2"
              >
                <div className="absolute inset-0 bg-gradient-to-t from-forest-950 via-forest-950/35 to-transparent pointer-events-none" />
                <div className="absolute inset-x-0 bottom-0 p-6 lg:p-7">
                  <h3 className="font-serif text-2xl lg:text-3xl text-cream-50">{e.title}</h3>
                  <p className="mt-2 text-cream-100/85 text-sm leading-relaxed max-w-xs">{e.body}</p>
                </div>
              </ParallaxImage>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
