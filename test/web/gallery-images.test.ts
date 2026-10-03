// Images are wired by hand here: a photo dropped into public/images/ that
// nothing references is invisible to a guest, and a path in the config with no
// file behind it renders as a blank tile. Both are one commit away from
// shipping, so both are checked here instead of in a review comment.
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'
import { ACCOMMODATIONS, EXPERIENCES, GALLERY, NEARBY } from '../../src/config/site'

const ROOT = join(__dirname, '..', '..')
const PUBLIC = join(ROOT, 'public')

/** Every public/images file, as the path a guest's browser asks for. */
function publicImagePaths(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) return publicImagePaths(abs)
    return /\.(jpe?g|png|webp|svg|avif)$/i.test(name)
      ? ['/' + relative(PUBLIC, abs).split(sep).join('/')]
      : []
  })
}

/** Every image path the config points at, local and remote alike. */
function referencedImages(): string[] {
  const urls: string[] = []
  for (const g of GALLERY) urls.push(g.url)
  for (const a of ACCOMMODATIONS) urls.push(...a.images)
  for (const e of EXPERIENCES) urls.push(e.image)
  for (const n of NEARBY) urls.push(n.image)
  return urls
}

describe('gallery imagery', () => {
  it('points only at files that exist', () => {
    const local = referencedImages().filter((u) => u.startsWith('/'))
    expect(local.length).toBeGreaterThan(0)
    for (const url of local) {
      expect(existsSync(join(PUBLIC, url.slice(1))), `${url} is referenced but not in public/`).toBe(true)
    }
  })

  it('leaves no image in public/images sitting unreferenced', () => {
    // index.html counts too: the brand roundel is a meta tag, not a config entry.
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8')
    const used = new Set(referencedImages())
    const orphans = publicImagePaths(join(PUBLIC, 'images')).filter(
      (p) => !used.has(p) && !html.includes(p),
    )
    expect(orphans, 'drop these into the config or delete them').toEqual([])
  })

  it('gives every gallery tile a unique id and a caption a guest can read', () => {
    const ids = GALLERY.map((g) => g.id)
    expect(new Set(ids).size, 'duplicate gallery ids').toBe(ids.length)
    for (const g of GALLERY) {
      expect(g.caption.trim().length, `${g.id} has no caption`).toBeGreaterThan(0)
      expect(g.url.trim().length, `${g.id} has no url`).toBeGreaterThan(0)
    }
  })
})
