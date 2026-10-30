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
      title="Location & arrival"
      darkMode
      lead={
        <p>
          Find the Hacienda along the Luisiana–Lucban Road in Brgy. San Isidro, Luisiana, Laguna.
          Explore the map, local landmarks and arrival routes below.
        </p>
      }
      cta={
        <div className="shrink-0">
          <a
            href={BUSINESS.contact.directions}
            target="_blank"
            rel="noreferrer"
            className="btn-primary"
          >
            Get Directions
          </a>
          <p className="mt-2 text-xs text-forest-700 dark:text-cream-100/75">Opens Google Maps in a new tab.</p>
        </div>
      }
    >
      <Location />
    </PageShell>
  )
}