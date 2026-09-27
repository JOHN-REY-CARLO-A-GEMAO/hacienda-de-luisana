// The guest-facing content in src/config/site.ts, held to its own rules:
// nothing a visitor reads is a placeholder, every figure names its source,
// and every review is a real one shown word for word. The rendering half
// mounts the homepage sections so the rule "a missing fact renders as
// nothing, never as 'Add X'" is seen, not assumed.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import {
  ACCOMMODATIONS,
  AIRBNB_RATING,
  BUSINESS,
  FAQS,
  FEES,
  GETTING_HERE,
  GUEST_NOTES,
  HOUSE_RULES,
  LISTINGS,
  NEARBY,
  OFFICIAL_CHANNELS,
  REVIEWS,
} from '../../src/config/site'
import { Accommodations, displayedRate } from '../../src/sections/Accommodations'
import { Rates } from '../../src/sections/Rates'
import { Reviews, monthYear } from '../../src/sections/Reviews'
import { Nearby } from '../../src/sections/Nearby'
import { GoodToKnow } from '../../src/sections/GoodToKnow'
import { Location } from '../../src/sections/Location'
import { Hero } from '../../src/sections/Hero'
import { OfficialChannelsNotice } from '../../src/components/OfficialChannelsNotice'
import type { PublishedRates } from '../../src/lib/booking'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** Text that must never reach a visitor. */
const PLACEHOLDER_PATTERNS = [
  /add distance/i,
  /add travel time/i,
  /placeholder/i,
  /please confirm with the hacienda/i,
  /\bTODO\b/,
  /\bTBD\b/,
  /lorem ipsum/i,
  /coming soon/i,
]

function expectNoPlaceholder(text: string, where: string) {
  for (const pattern of PLACEHOLDER_PATTERNS) {
    expect(text, `${where} contains placeholder text matching ${pattern}`).not.toMatch(pattern)
  }
}

/** Every string value inside a config object, flattened. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings)
  return []
}

const mounted: Root[] = []

function render(node: React.ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push(root)
  act(() => {
    root.render(<MemoryRouter>{node}</MemoryRouter>)
  })
  return {
    container,
    text: () => (container.textContent ?? '').replace(/\s+/g, ' '),
  }
}

afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
  window.localStorage.clear()
})

describe('site content carries no placeholders', () => {
  it('has none in any guest-facing config block', () => {
    const blocks = { ACCOMMODATIONS, BUSINESS, FAQS, FEES, GETTING_HERE, GUEST_NOTES, HOUSE_RULES, NEARBY, OFFICIAL_CHANNELS, REVIEWS }
    for (const [name, block] of Object.entries(blocks)) {
      for (const s of strings(block)) expectNoPlaceholder(s, name)
    }
  })

  it('names the town of every nearby attraction and leaves unmeasured distances out rather than filled in', () => {
    for (const n of NEARBY) {
      expect(n.area.trim().length, `${n.name} has no area`).toBeGreaterThan(0)
      // Optional, and only ever a real measurement — never a stand-in string.
      if (n.distance !== undefined) expect(n.distance).toMatch(/\d/)
      if (n.travelTime !== undefined) expect(n.travelTime).toMatch(/\d/)
    }
  })

  it('states check-in and check-out as facts', () => {
    const checkIn = FAQS.find((f) => /check-in/i.test(f.q))!
    const checkOut = FAQS.find((f) => /check-out/i.test(f.q))!
    expect(checkIn.a).toBe('Check-in is from 2:00 PM.')
    expect(checkOut.a).toBe('Check-out is by 12:00 NN.')
  })
})

describe('reviews and the Airbnb rating', () => {
  it('shows only real reviews: name, 1–5 stars, verbatim text, month and year, and the platform', () => {
    expect(REVIEWS.length).toBeGreaterThan(0)
    for (const r of REVIEWS) {
      expect(r.name.trim().length).toBeGreaterThan(0)
      expect(r.rating).toBeGreaterThanOrEqual(1)
      expect(r.rating).toBeLessThanOrEqual(5)
      expect(r.body.trim().length).toBeGreaterThan(0)
      expect(r.date).toMatch(/^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/)
      expect(r.source).toBe('Airbnb')
    }
  })

  it('never shows more reviews than the listing has, and dates the snapshot', () => {
    expect(REVIEWS.length).toBeLessThanOrEqual(AIRBNB_RATING.reviewCount)
    expect(AIRBNB_RATING.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(AIRBNB_RATING.rating).toBeGreaterThan(0)
    expect(AIRBNB_RATING.rating).toBeLessThanOrEqual(5)
    expect(AIRBNB_RATING.url).toBe(LISTINGS.airbnb.url)
    expect(monthYear('2026-09-26')).toBe('September 2026')
  })

  it('renders the rating badge and every review word for word', () => {
    const page = render(<Reviews />)
    expect(page.text()).toContain('5.0')
    expect(page.text()).toContain('9 reviews on Airbnb')
    expect(page.text()).toContain('Superhost')
    expect(page.text()).toContain('As of September 2026')
    for (const r of REVIEWS) {
      expect(page.text()).toContain(r.name)
      expect(page.text()).toContain(r.date)
      // The first paragraph of every review appears exactly as written.
      expect(page.text()).toContain(r.body.split('\n\n')[0].replace(/\s+/g, ' '))
    }
    expect(page.text()).not.toContain('Real guest reviews will appear here')
  })

  it('puts the dated rating badge in the hero, linking to the listing', () => {
    const page = render(<Hero />)
    const badge = [...page.container.querySelectorAll('a')].find((a) => a.href === LISTINGS.airbnb.url)
    expect(badge).toBeTruthy()
    expect(badge!.textContent).toContain('5.0')
    expect(badge!.textContent).toContain('Superhost')
  })
})

describe('official listings and channels', () => {
  it('links only the verified Airbnb and Agoda pages, over https', () => {
    expect(LISTINGS.airbnb.url).toBe('https://www.airbnb.com/rooms/1127261595245933990')
    expect(LISTINGS.agoda.url).toBe('https://www.agoda.com/hacienda-de-luisana/hotel/luisiana-ph.html')
  })

  it('shows the scam notice with the real contact details and both listings', () => {
    const page = render(<OfficialChannelsNotice />)
    expect(page.text()).toContain(OFFICIAL_CHANNELS.headline)
    expect(page.text()).toContain(BUSINESS.contact.phoneDisplay)
    expect(page.text()).toContain(BUSINESS.contact.email)
    const hrefs = [...page.container.querySelectorAll('a')].map((a) => a.href)
    expect(hrefs).toContain(LISTINGS.airbnb.url)
    expect(hrefs).toContain(LISTINGS.agoda.url)
    expect(hrefs).toContain(BUSINESS.contact.facebook)
  })
})

describe('rates, fees and sleeping arrangements', () => {
  const mainHouse = ACCOMMODATIONS.find((a) => a.id === 'main-house')!
  const camping = ACCOMMODATIONS.find((a) => a.id === 'house-a-camping')!

  it('only lists a price the Hacienda itself has published, and names where it came from', () => {
    for (const a of ACCOMMODATIONS) {
      if (a.price !== undefined) {
        expect(a.priceSource, `${a.name} lists a price without a source`).toBeTruthy()
      }
    }
    expect(camping.price).toBe(1200)
    expect(mainHouse.price).toBeUndefined()
  })

  it('quotes the Main House on request until the Admin publishes a rate, then shows the published figure', () => {
    expect(displayedRate(mainHouse, null).label).toBe('Quoted on request')
    expect(displayedRate(camping, null).label).toBe('₱1,200 / unit / night')

    const published: PublishedRates = {
      version: 'v-test',
      effective_date: '2026-09-01',
      accommodations: {
        'main-house': { nightly_rate: 7500, security_deposit: 1000, down_payment_percent: 50 },
        'house-a-camping': { nightly_rate: 1500, security_deposit: 0 },
      },
    }
    expect(displayedRate(mainHouse, published)).toMatchObject({ label: '₱7,500 / night', nightly: 7500 })
    expect(displayedRate(camping, published)).toMatchObject({ label: '₱1,500 / unit / night', nightly: 1500 })
    expect(displayedRate(mainHouse, published).source).toContain('v-test')
  })

  it('separates the pet fee from optional, unpriced extras', () => {
    const pets = FEES.additional.find((f) => f.id === 'pets')!
    expect(pets.amount).toBe(300)
    for (const f of FEES.optional) expect(f.amount).toBeUndefined()
    expect(FEES.included.length).toBeGreaterThan(0)
  })

  it('renders the Rates section without a deposit figure until one is published', () => {
    const page = render(<Rates />)
    expect(page.text()).toContain('Quoted on request')
    expect(page.text()).toContain('₱1,200 / unit / night')
    expect(page.text()).toContain('₱300')
    expect(page.text()).toContain('Ask for the current price')
    expect(page.text()).toContain('set in the Hacienda\'s published rates')
  })

  it('lists the Main House beds room by room and leaves the bathroom count out until it is confirmed', () => {
    const s = mainHouse.sleeping!
    expect(s.bedrooms).toBe(1)
    expect(s.beds.reduce((n, b) => n + b.count, 0)).toBe(9)
    expect(s.bathrooms).toBeUndefined()

    const page = render(<Accommodations />)
    expect(page.text()).toContain('Sleeping arrangements')
    expect(page.text()).toContain('1 bedroom · 9 beds')
    expect(page.text()).toContain('2 double beds')
    expect(page.text()).toContain('6 single beds')
    expect(page.text()).toContain('1 sofa bed')
    expect(page.text()).not.toMatch(/bathroom/i)
    expect(page.text()).not.toMatch(/placeholder rate/i)
  })
})

describe('house rules, guest notes and getting here', () => {
  it('keeps the Hacienda\'s rules and the guests\' accounts in separate, labelled voices', () => {
    const page = render(<GoodToKnow />)
    expect(page.text()).toContain('House rules')
    expect(page.text()).toContain('Check-in from 2:00 PM, check-out by 12:00 NN.')
    expect(page.text()).toContain('₱300')
    expect(page.text()).toContain('What recent guests mention')
    for (const note of GUEST_NOTES) expect(page.text()).toContain(note.from)
    expect(page.text()).toContain('in an Airbnb review')
  })

  it('gives the landmark and both routes without quoting a travel time', () => {
    const page = render(<Location />)
    expect(page.text()).toContain('Alicia’s Bibingkahan')
    expect(page.text()).toContain('Sta. Cruz')
    expect(page.text()).toContain('SLEX')
    // The existing map and directions button stay.
    expect(page.container.querySelector('iframe[title="Hacienda de LuisAna on Google Maps"]')).toBeTruthy()
    expect([...page.container.querySelectorAll('a')].some((a) => a.href === BUSINESS.contact.directions)).toBe(true)
    // No minutes or hours anywhere in the routes.
    for (const step of [...GETTING_HERE.byCar.steps, ...GETTING_HERE.byCommute.steps]) {
      expect(step).not.toMatch(/\b\d+\s*(min|mins|minutes|hr|hrs|hours)\b/i)
    }
  })

  it('renders nearby cards with the town and no distance stand-ins', () => {
    const page = render(<Nearby />)
    expect(page.text()).toContain('Lucban, Quezon')
    expect(page.text()).toContain('Cavinti, Laguna')
    expectNoPlaceholder(page.text(), 'Nearby section')
  })
})
