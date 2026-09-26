import { ArrowRight } from '../lib/icons'
import { ParallaxImage } from '../components/ParallaxImage'
import { SceneHeader } from '../components/Scene'
import { BUSINESS } from '../config/site'

/**
 * Scene 02 — "Your Private Escape". Three of the Hacienda's own photographs
 * stacked at different depths (each drifts at its own scroll speed) beside
 * the welcome copy. On phones the stack collapses to one large image plus a
 * small inset so nothing overlaps the text.
 */
export function Intro() {
  return (
    <section id="intro" className="relative py-24 lg:py-36 bg-cream-50 overflow-hidden">
      {/* Soft light wash behind the collage */}
      <div
        className="pointer-events-none absolute -top-40 -left-40 h-[520px] w-[520px] rounded-full opacity-60 blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(198,214,193,0.55), transparent 65%)' }}
        aria-hidden="true"
      />

      <div className="relative mx-auto max-w-7xl px-5 lg:px-8 grid lg:grid-cols-12 gap-14 lg:gap-16 items-center">
        {/* Layered collage */}
        <div className="lg:col-span-7 relative reveal">
          <ParallaxImage
            src="/images/gmaps/img-01.jpg"
            alt="The Main House at Hacienda de LuisAna in warm afternoon light"
            range={0.07}
            className="h-[420px] sm:h-[520px] lg:h-[640px] rounded-[32px] shadow-depth"
          >
            <div className="absolute inset-0 bg-gradient-to-t from-forest-950/35 via-transparent to-transparent pointer-events-none" />
            <div className="absolute left-5 bottom-5 text-cream-50">
              <div className="text-[10px] uppercase tracking-eyebrow text-cream-100/80">The Main House</div>
              <div className="font-serif text-2xl">{BUSINESS.address.city}, {BUSINESS.address.region}</div>
            </div>
          </ParallaxImage>

          {/* Mid layer — garden inset, closer to the viewer */}
          <ParallaxImage
            src="/images/gmaps/img-05.jpg"
            alt="Garden pathway and countryside view"
            range={0.12}
            className="absolute -bottom-8 right-0 sm:-right-8 h-36 w-36 sm:h-52 sm:w-52 lg:h-64 lg:w-64 rounded-[24px] shadow-float border-[5px] border-cream-50"
          />

          {/* Far layer — a quiet corner of the grounds, peeking from behind */}
          <ParallaxImage
            src="/images/gmaps/img-13.jpg"
            alt="Campfire in front of the main house at blue hour"
            range={0.04}
            className="hidden lg:block absolute -top-10 -left-10 h-44 w-36 rounded-[20px] shadow-card opacity-90 -z-0"
          />
        </div>

        <div className="lg:col-span-5 lg:pl-4">
          <SceneHeader
            index="02"
            eyebrow="Your Private Escape"
            title={
              <>
                A Little Place
                <br />
                to <span className="italic font-light">Slow Down</span>
              </>
            }
          />

          <div className="reveal mt-8 space-y-5 text-forest-800/85 leading-relaxed max-w-lg">
            <p>
              Hacienda de LuisAna is a peaceful private getaway in Luisiana, Laguna where guests
              can step away from the noise and spend quality time with the people who matter.
            </p>
            <p>
              Whether you&rsquo;re planning a family weekend, a small gathering, camping experience,
              team-building activity, or simply looking for a quiet place to reconnect with nature,
              the Hacienda is designed around comfort, privacy, and memorable experiences.
            </p>
          </div>

          <a href="#stay" className="btn-ghost mt-10 group reveal">
            Discover the Hacienda
            <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
          </a>
        </div>
      </div>
    </section>
  )
}
