import { PageShell } from '../components/PageShell'
import { Experience } from '../sections/Experience'
import { Nearby } from '../sections/Nearby'

/**
 * /experience — what the stay is like, and what is around it.
 *
 * The on-property moments and the nearby attractions belong together: both
 * answer "what do we actually do there", and splitting them across two pages
 * would make each one a single short band. Neither is a decision a guest makes
 * on the homepage — they are already on their way to asking "is this for us?"
 * when they look for them.
 */
export function ExperiencePage() {
  return (
    <PageShell
      eyebrow="Experience"
      title="More than a place to stay"
      lead={
        <p>
          Long meals, quiet mornings, and the kind of conversation that only happens away from the
          city — plus the waterfalls, caves, heritage towns and lakes of the Luisiana countryside,
          all within reach.
        </p>
      }
    >
      <Experience />
      <Nearby />
    </PageShell>
  )
}