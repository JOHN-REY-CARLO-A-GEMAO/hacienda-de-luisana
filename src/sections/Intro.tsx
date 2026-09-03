import { SmartImage } from '../components/SmartImage'
import { ArrowRight } from '../lib/icons'

export function Intro() {
  return (
    <section id="intro" className="py-24 lg:py-36 bg-cream-50">
      <div className="mx-auto max-w-7xl px-5 lg:px-8 grid lg:grid-cols-2 gap-14 lg:gap-24 items-center">
        <div className="relative reveal">
          <div className="relative overflow-hidden rounded-[28px] shadow-card">
            <SmartImage
              src="/images/gmaps/img-01.jpg"
              alt="The Main House at Hacienda de LuisAna in warm afternoon light"
              className="w-full h-[520px] object-cover"
              aspect="4 / 5"
            />
          </div>
          <div className="hidden lg:block absolute -bottom-8 -right-8 h-40 w-40 rounded-[24px] overflow-hidden shadow-card border-4 border-cream-50">
            <SmartImage
              src="/images/gmaps/img-05.jpg"
              alt="Garden pathway and countryside view"
              className="w-full h-full object-cover"
            />
          </div>
        </div>

        <div className="reveal">
          <div className="eyebrow">Welcome to Hacienda de LuisAna</div>
          <h2 className="display text-4xl sm:text-5xl lg:text-6xl mt-4 text-forest-900">
            A Little Place
            <br />
            to <span className="italic font-light">Slow Down</span>
          </h2>

          <div className="mt-8 space-y-5 text-forest-800/85 leading-relaxed max-w-lg">
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

          <a href="#stay" className="btn-ghost mt-10 group">
            Discover the Hacienda
            <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
          </a>
        </div>
      </div>
    </section>
  )
}
