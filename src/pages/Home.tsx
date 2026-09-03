import { Hero } from '../sections/Hero'
import { Intro } from '../sections/Intro'
import { Stats } from '../sections/Stats'
import { Accommodations } from '../sections/Accommodations'
import { Amenities } from '../sections/Amenities'
import { Experience } from '../sections/Experience'
import { Nearby } from '../sections/Nearby'
import { Gallery } from '../sections/Gallery'
import { Location } from '../sections/Location'
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
      <Amenities />
      <Experience />
      <Nearby />
      <Gallery />
      <Reviews />
      <Location />
      <FAQ />
      <Contact />
    </>
  )
}
