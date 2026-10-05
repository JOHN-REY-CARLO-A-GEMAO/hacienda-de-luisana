import { PageShell } from '../components/PageShell'
import { Reviews } from '../sections/Reviews'

/**
 * /reviews — every review, and the Guest reviews written here.
 *
 * The homepage shows the rating and two reviews; this carries all of them, the
 * dated Airbnb category breakdown, and the `public_reviews` block — Guest
 * reviews written after a real stay, which the Admin reads before publishing.
 * Both voices stay in their own labelled blocks, as they did on the homepage.
 */
export function ReviewsPage() {
  return (
    <PageShell
      eyebrow="Guest Experiences"
      title="Reviews"
      lead={
        <p>
          Reviews published by guests on the Hacienda's own listing, shown word for word, alongside
          the reviews Guests write here after a real stay.
        </p>
      }
    >
      <Reviews />
    </PageShell>
  )
}