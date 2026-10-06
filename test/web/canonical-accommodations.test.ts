// One Accommodation identity, shared: the website's catalogue, the published
// rates document and the availability arithmetic must never drift apart.
//
// Three facts are easy to confuse and this suite exists because they were:
//   `available_units`     how many units the estate holds at once (A-House: 2)
//   `units_per_booking`  how many units one Booking takes (A-House: 1)
//   `max_guests`          how many guests fit in that unit (A-House: 3)
// The A-House is the only Accommodation that uses any of them, which is exactly
// why a copy of the numbers could live in three files and disagree with itself.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ACCOMMODATIONS } from '../../src/config/site'
import { OFFICIAL_ACCOMMODATION_RATES } from '../../src/config/officialBusiness'
import { unitsForAccommodation, validatePublishedRates } from '../../src/lib/booking'

/**
 * The canonical Accommodation set.
 *
 * `firestore.rules` holds the same list in `isCanonicalAccommodation()` and
 * refuses a rates document that names anything else, so this is a mirror of the
 * enforcement, not a second source of truth.
 */
const CANONICAL_IDS = ['main-house', 'annex', 'house-a-camping']

/** Included guest counts, as the Hacienda publishes them. */
const INCLUDED_GUESTS: Record<string, number> = {
  'main-house': 10,
  annex: 6,
  'house-a-camping': 3,
}

describe('the canonical Accommodation set', () => {
  it('is exactly three Accommodations, in both the catalogue and the rates document', () => {
    expect(ACCOMMODATIONS.map((a) => a.id).sort()).toEqual([...CANONICAL_IDS].sort())
    expect(Object.keys(OFFICIAL_ACCOMMODATION_RATES).sort()).toEqual([...CANONICAL_IDS].sort())
  })

  it('names each Accommodation once, the same way in the catalogue and the published rates', () => {
    for (const [id, rates] of Object.entries(OFFICIAL_ACCOMMODATION_RATES)) {
      const entry = ACCOMMODATIONS.find((a) => a.id === id)
      expect(entry, `${id} is missing from the catalogue`).toBeDefined()
      // `property_name` is what both apps and every Booking label read, so it has
      // to be the catalogue's name and not a third spelling of it.
      expect(rates.property_name, `${id} has no property_name`).toBe(entry!.name)
    }
  })

  it('publishes a guest-count schedule whose included occupancy matches the catalogue', () => {
    for (const [id, rates] of Object.entries(OFFICIAL_ACCOMMODATION_RATES)) {
      const pricing = rates.guest_pricing!
      for (const classification of ['weekday', 'weekend_holiday'] as const) {
        expect(pricing[classification].base_max_guests, `${id} ${classification}`).toBe(INCLUDED_GUESTS[id])
      }
    }
  })

  it('uses an excess rule only where there is no absolute cap', () => {
    for (const [id, rates] of Object.entries(OFFICIAL_ACCOMMODATION_RATES)) {
      const capped = id === 'house-a-camping'
      for (const classification of ['weekday', 'weekend_holiday'] as const) {
        const schedule = rates.guest_pricing![classification]
        // A cap that equals the included count leaves no guest an excess rule
        // could price, so publishing one would state an unreachable figure.
        expect('excess_per_guest' in schedule, `${id} ${classification}`).toBe(!capped)
        expect(schedule.max_guests !== undefined, `${id} ${classification}`).toBe(capped)
      }
    }
  })

  it('takes one A-House unit per Booking, from an inventory of two, for three guests', () => {
    const aHouse = OFFICIAL_ACCOMMODATION_RATES['house-a-camping']
    expect(aHouse.available_units).toBe(2)
    expect(aHouse.guest_pricing!.units_per_booking).toBe(1)
    expect(aHouse.guest_pricing!.weekday).toEqual({
      min_guests: 1, base_max_guests: 3, max_guests: 3, base_rate: 1000,
    })
    // The Main House and the Annex are one unit each.
    expect(OFFICIAL_ACCOMMODATION_RATES['main-house'].available_units).toBe(1)
    expect(OFFICIAL_ACCOMMODATION_RATES.annex.available_units).toBe(1)
  })

  it('is a document the Admin app could publish unchanged', () => {
    const document = {
      version: 'canonical-v1',
      effective_date: '2026-10-01',
      holiday_dates: [],
      accommodations: Object.fromEntries(
        Object.entries(OFFICIAL_ACCOMMODATION_RATES).map(([id, rates]) => [
          id, { ...rates, security_deposit: 0 },
        ]),
      ),
    }
    expect(validatePublishedRates(document, CANONICAL_IDS)).toEqual([])
  })
})

describe('availability reads the published inventory', () => {
  const published = {
    accommodations: { 'house-a-camping': { available_units: 2 } },
  }

  it('prefers the published unit count over the build-time catalogue', () => {
    expect(unitsForAccommodation('house-a-camping', ACCOMMODATIONS, published)).toBe(2)
    expect(unitsForAccommodation('main-house', ACCOMMODATIONS, published)).toBe(1)
  })

  it('falls back to the catalogue when the published figure is absent or nonsensical', () => {
    expect(unitsForAccommodation('house-a-camping', ACCOMMODATIONS, null)).toBe(2)
    expect(unitsForAccommodation('house-a-camping', ACCOMMODATIONS, {
      accommodations: { 'house-a-camping': { available_units: 0 } },
    })).toBe(2)
  })

  it('treats an unknown Accommodation as one unit rather than as free availability', () => {
    expect(unitsForAccommodation('nobody-published-this', ACCOMMODATIONS, published)).toBe(1)
  })
})

describe('retired Accommodation vocabulary', () => {
  const SRC_DIR = join(__dirname, '../../src')

  function websiteSources(): Array<{ file: string; text: string }> {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.tsx?$/.test(entry.name)) files.push(full)
      }
    }
    walk(SRC_DIR)
    return files.map((file) => ({ file: file.slice(SRC_DIR.length + 1), text: readFileSync(file, 'utf8') }))
  }

  // `Hacienda de LuisAna` is the estate's name and legitimately appears; what must
  // never appear is the estate name used as the name of an Accommodation, or the
  // invented rooms and figures that were once offered in its place.
  const retired: Array<[string, RegExp]> = [
    ['Villa LuisAna as an Accommodation', /Villa LuisAna/i],
    ['the retired casita-del-rio id', /casita-del-rio/i],
    ['Poolside Casita B', /Poolside Casita/i],
    ['a private pool amenity', /Private Pool/i],
    ['a mountain view amenity', /Mountain View/i],
    ['the invented ₱15,000/night room rate', /15000|15,000/],
  ]

  it.each(retired)('no longer appears anywhere in the website: %s', (_label, pattern) => {
    const hits = websiteSources().filter((file) => pattern.test(file.text)).map((file) => file.file)
    expect(hits).toEqual([])
  })
})