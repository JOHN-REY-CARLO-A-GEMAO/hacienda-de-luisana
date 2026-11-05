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
const cartoConfig = read('lib/core/config/carto_config.dart')
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

  it('keeps the key file out of the repository', () => {
    // `carto.json` is the alternative to a --dart-define on the command line, and
    // it is the form that keeps the key out of shell history. It must also keep
    // it out of git.
    const ignore = read('.gitignore')
    expect(ignore).toMatch(/^carto\.json$/m)
    expect(read('carto.json.example')).toContain('CARTO_KEY')
    // The example is a shape, never a value.
    expect(JSON.parse(read('carto.json.example')).CARTO_KEY).toBe('')
  })

  it('sets the key in exactly one file, and lets a build flag override it', () => {
    // One paste slot, so nobody has to hunt for it, and one override, so a build
    // can supply its own without editing code. The flag wins: a shared machine or
    // a CI build must never be stuck with whatever is pasted in the repo.
    expect(cartoConfig).toContain("const String kCartoKeyPasted = ''")
    expect(cartoConfig).toContain("String.fromEnvironment('CARTO_KEY')")
    expect(cartoConfig).toContain('kCartoKeyFromBuild.isNotEmpty ? kCartoKeyFromBuild : kCartoKeyPasted')

    // The tile layer reads it; it does not have its own copy.
    expect(tile).not.toContain('String.fromEnvironment')
    expect(tile).toContain('hasCartoKey')

    // The paste slot is empty in git. If this ever fails, a key was committed by
    // paste rather than supplied at build time — which is a decision to make on
    // purpose, not by accident, because this repository is public.
    const pasted = cartoConfig.match(/const String kCartoKeyPasted = '([^']*)'/)
    expect(pasted).not.toBeNull()
    expect(pasted?.[1]).toBe('')
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
