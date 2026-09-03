import { EXPERIENCES } from '../config/site'
import { SmartImage } from '../components/SmartImage'

export function Experience() {
  return (
    <section id="experience" className="py-24 lg:py-36 bg-forest-950 text-cream-100 relative overflow-hidden">
      <div className="absolute inset-0 opacity-[0.05] pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(circle at 25% 20%, #c6d6c1 0px, transparent 50%), radial-gradient(circle at 80% 70%, #d0b46e 0px, transparent 60%)',
        }}
      />
      <div className="relative mx-auto max-w-7xl px-5 lg:px-8">
        <div className="max-w-2xl reveal">
          <div className="eyebrow text-cream-100/60">Experiences</div>
          <h2 className="display text-4xl sm:text-5xl lg:text-6xl mt-4 text-cream-50">
            More Than Just a
            <br />
            <span className="italic font-light">Place to Stay</span>
          </h2>
          <p className="mt-6 text-cream-100/70 leading-relaxed">
            The Hacienda is a backdrop for the moments you'll remember — long meals, quiet mornings,
            and the kind of laughter that only happens away from the city.
          </p>
        </div>

        <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {EXPERIENCES.map((e, i) => (
            <article
              key={e.id}
              className="reveal group relative overflow-hidden rounded-[24px] aspect-[4/5] bg-forest-800"
              style={{ transitionDelay: `${i * 40}ms` }}
            >
              <SmartImage
                src={e.image}
                alt={e.title}
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-[1400ms] ease-out-expo group-hover:scale-[1.06]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-forest-950 via-forest-950/40 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-6 lg:p-7">
                <h3 className="font-serif text-2xl lg:text-3xl text-cream-50">{e.title}</h3>
                <p className="mt-2 text-cream-100/85 text-sm leading-relaxed max-w-xs">{e.body}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
