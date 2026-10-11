import { PageShell } from '../components/PageShell'
import { Gallery } from '../sections/Gallery'

/**
 * /gallery — the full gallery, with the category filters and the lightbox.
 *
 * The homepage shows six photographs and a link here. This page carries the
 * whole set and the filter row that makes it browsable, which is the reason the
 * homepage preview does not.
 */
export function GalleryPage() {
  return (
    <PageShell
      eyebrow="Gallery"
      title="The Hacienda in photographs"
      lead={<p>Every photograph below is of the property itself. Filter by what you want to see.</p>}
    >
      <Gallery />
    </PageShell>
  )
}