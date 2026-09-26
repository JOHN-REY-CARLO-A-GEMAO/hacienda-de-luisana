import { Hero } from '../sections/Hero'
import { Intro } from '../sections/Intro'
import { Stats } from '../sections/Stats'
import { Accommodations } from '../sections/Accommodations'
import { Rates } from '../sections/Rates'
import { Amenities } from '../sections/Amenities'
import { Experience } from '../sections/Experience'
import { Nearby } from '../sections/Nearby'
import { Gallery } from '../sections/Gallery'
import { Location } from '../sections/Location'
import { GoodToKnow } from '../sections/GoodToKnow'
import { FAQ } from '../sections/FAQ'
import { Reviews } from '../sections/Reviews'
import { Contact } from '../sections/Contact'

export function Home() {
  return (
    <>
      <Hero />
      <Intro />
      <Stats />
      <Accommodations />
      <Rates />
      <Amenities />
      <Experience />
      <Nearby />
      <Gallery />
      <Reviews />
      <Location />
      <GoodToKnow />
      <FAQ />
      <Contact />
    </>
  )
}
