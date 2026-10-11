import { PageShell } from '../components/PageShell'
import { Location } from '../sections/Location'
import { BUSINESS } from '../config/site'

/**
 * /location — the map, the address, and how to arrive.
 *
 * The homepage preview gives the address and a directions button; this is the
 * page a guest opens in the week before a stay, when the last stretch of road
 * is what they actually want to know.
 *
 * The `Location` section keeps its own `id="getting-here"` anchor, so any link
 * that pointed straight at the arrival instructions still resolves.
 */
export function LocationPage() {
  return (
    <PageShell
      eyebrow="Location"
      title="Getting to the Hacienda"
      lead={
        <p>
          Luisiana–Lucban Road, Brgy. San Isidro, Luisiana, Laguna — with the landmarks and both
          standard routes below, and no travel time quoted, because the Hacienda has not measured one.
        </p>
      }
      cta={
        <a
          href={BUSINESS.contact.directions}
          target="_blank"
          rel="noreferrer"
          className="btn-primary shrink-0"
        >
          Get Directions
        </a>
      }
    >
      <Location />
    </PageShell>
  )
}