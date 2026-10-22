import { Container } from '../components/ui'
import { AMENITIES } from '../config/site'
import { SceneHeader } from '../components/Scene'
import { AMENITY_ICONS } from '../lib/icons'

export function Amenities() {
  return (
    <section id="amenities" className="section-roomy bg-cream-50">
      <Container width="wide">
        <SceneHeader
          index="05"
          eyebrow="Amenities"
          title={
            <>
              Everything You Need for a
              <br />
              <span className="italic font-normal">Comfortable Escape</span>
            </>
          }
        />

        <div className="mt-14 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-y-10 gap-x-4">
          {AMENITIES.map((a) => {
            const Icon = AMENITY_ICONS[a.key]
            return (
              <div key={a.key} className="reveal flex flex-col items-center text-center">
                <div className="w-14 h-14 rounded-2xl bg-forest-50 border border-forest-900/5 flex items-center justify-center text-forest-700 mb-3">
                  {Icon ? <Icon size={22} /> : null}
                </div>
                <div className="text-sm text-forest-800 leading-snug max-w-[10rem]">
                  {a.label}
                </div>
              </div>
            )
          })}
        </div>
      </Container>
    </section>
  )
}
