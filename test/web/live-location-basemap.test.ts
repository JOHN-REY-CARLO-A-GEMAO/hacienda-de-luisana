// ----------------------------------------------------------------------------
// The map's pictures come from a server the app is allowed to use.
//
// The live-location panel drew its basemap from `tile.openstreetmap.org` — the
// OpenStreetMap project's own tile server, run by volunteers on donations. Its
// usage policy names this exact case:
//
//   "Heavy use (e.g. distributing an app that uses tiles from
//    openstreetmap.org) is forbidden without prior permission."
//
// This app is distributed. The failure would not have been a warning; it would
// have been a 403 and a grey panel for every Admin at once, with nothing in the
// app to say why.
//
// The basemap is now CARTO's, served from `basemaps.cartocdn.com`: the same
// OpenStreetMap data, under terms meant for applications, free to five million
// tile requests a month with a key that costs nothing.
//
// This suite exists because the Flutter test suite cannot run here — there is no
// Flutter SDK in this environment — and the thing being protected is a one-line
// URL. A single line is exactly what gets reverted by someone "simplifying" the
// tile helper later.
// ----------------------------------------------------------------------------
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (relative: string) => readFileSync(join(__dirname, '../..', relative), 'utf8')

const tile = read('lib/views/inbox/osm_tile.dart')
const panel = read('lib/views/inbox/live_location_panel.dart')

describe('the basemap is served by someone who allows it', () => {
  it('never builds a tile URL against the OpenStreetMap project\u2019s own server', () => {
    // The exact host the policy forbids for a distributed app. It may still be
    // mentioned in a comment — that is the explanation of why it is gone — but
    // never inside a URL the code constructs.
    const urlConstruction = tile
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n')
    expect(urlConstruction).not.toContain("tile.openstreetmap.org/")
    expect(urlConstruction).not.toMatch(/['"]https?:\/\/tile\.openstreetmap\.org/)
  })

  it('serves tiles from CARTO, and defines that origin in exactly one place', () => {
    expect(tile).toContain('basemaps.cartocdn.com/rastertiles/voyager')
    // One constant, so a later move to another provider is one edit.
    expect(tile).toMatch(/const String _cartoTileOrigin\s*=/)
    const assignments = tile.match(/basemaps\.cartocdn\.com/g) ?? []
    expect(assignments.length).toBe(1)
  })

  it('takes the key from the build, not from the repository', () => {
    // A committed key is a key that leaks the moment the repo is public, and it
    // is not even a secret worth guarding — but a `const key = 'abc'` would be
    // copied into every fork. `String.fromEnvironment` means it arrives by
    // --dart-define and never appears in a diff.
    expect(tile).toContain("String.fromEnvironment('CARTO_KEY')")
    expect(tile).not.toMatch(/cartoKey\s*=\s*['"][^'"]+['"]/)
  })

  it('still draws a map when no key was supplied', () => {
    // A build without the key gets CARTO's watermarked tile, which is ugly but
    // readable. Refusing to draw anything would turn a licensing nicety into a
    // panel that shows a blank box on the owner's phone.
    expect(tile).toContain('hasCartoKey ?')
  })

  it('credits both licences, which both of them require', () => {
    expect(tile).toContain('© OpenStreetMap contributors · © CARTO')
    // Rendered as visible text under the map, not a tooltip and not a comment.
    expect(panel).toContain('osmTileAttribution')
    expect(panel).not.toContain("'© OpenStreetMap contributors'")
  })

  it('does not touch the links, which are fine as they are', () => {
    // Pressing a link to openstreetmap.org is a person opening a web page; it
    // asks the tile server for nothing. Only the embedded raster is the problem,
    // and this suite would rather record that than have someone "fix" it too.
    const reader = read('src/lib/liveLocationReader.ts')
    expect(reader).toContain('openstreetmap.org/directions')
  })
})
