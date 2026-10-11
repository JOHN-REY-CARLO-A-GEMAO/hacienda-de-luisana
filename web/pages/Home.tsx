import { Hero } from '../sections/Hero'
import { Intro } from '../sections/Intro'
import { Stats } from '../sections/Stats'
import { StayPreview } from '../sections/StayPreview'
import { RatesPreview } from '../sections/RatesPreview'
import { Experience } from '../sections/Experience'
import { GalleryPreview } from '../sections/GalleryPreview'
import { ReviewsPreview } from '../sections/ReviewsPreview'
import { LocationPreview } from '../sections/LocationPreview'
import { BookingCta } from '../sections/BookingCta'

/**
 * The homepage, in the order a first-time visitor needs it: what this is, what
 * it looks like, what you can book, what it costs, why people come, whether it
 * is real, where it is, and how to book.
 *
 * Every section here is a *preview* that names the next question and hands it
 * to a route. The detail behind each one lives on /stay, /rates, /gallery,
 * /experience, /location, /reviews, /faqs, /house-rules and /contact, so the
 * answers are still one click away — they are simply not in the way between a
 * visitor and the booking form any more.
 *
 * Four of these blocks are mounted unchanged from the scenes the homepage used
 * to carry (`Hero`, `Intro`, `Stats`, `Experience`): they were already short,
 * and already earning their place.
 */
export function Home() {
  return (
    <>
      <Hero />
      <Intro />
      <Stats />
      <StayPreview />
      <RatesPreview />
      <Experience />
      <GalleryPreview />
      <ReviewsPreview />
      <LocationPreview />
      <BookingCta />
    </>
  )
}