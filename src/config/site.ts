// -----------------------------------------------------------------------------
// Hacienda de LuisAna — Site Configuration
// -----------------------------------------------------------------------------
// This file is the single source of truth for editable business content.
// The Admin can update contact info, images, amenities, FAQs, house rules,
// fees and nearby attractions here without touching component code.
//
// Every guest-facing fact in this file is either (a) the Hacienda's own
// published statement or (b) attributed to the guest who said it. Nothing is
// a placeholder: a field the Hacienda has not confirmed is left out and the
// component renders without it, rather than shipping "Add X" to a visitor.
//
// Sources checked on 2026-09-26 (refresh the figures when you revisit them):
//   [A] The Hacienda's Airbnb listing — host-written description, house rules
//       and Airbnb's own rating summary. See LISTINGS.airbnb.
//   [B] The Hacienda's Agoda listing. See LISTINGS.agoda.
//   [C] The Hacienda's Facebook page — address and contact. See BUSINESS.
//   [D] Guest reviews published on [A] — attributed to the guest, never
//       presented as the Hacienda's promise.
//   [E] Public travel guides for the Sta. Cruz → Luisiana commute, several
//       agreeing. Used for GETTING_HERE only; no travel times or fares.
//
// Money: nightly rates, the Security deposit, the down-payment percentage and
// the cancellation policy are the Admin's Published rates (`site_config/rates`,
// see src/lib/booking/rates.ts). The website reads them live; the figures here
// are the Hacienda's publicly listed prices for display when nothing is
// published yet.
// -----------------------------------------------------------------------------

export type Amenity = {
  key: string
  label: string
}

/** One kind of bed in one room, as the Hacienda lists it. */
export type BedArrangement = {
  count: number
  type: string   // "double bed", "single bed", "sofa bed"
  where: string  // "Bedroom", "Living room"
}

export type SleepingArrangement = {
  bedrooms: number
  beds: BedArrangement[]
  /** Left out until the Hacienda confirms it — see the note on the Main House. */
  bathrooms?: number
  /** Where the figures come from, shown to the guest as a footnote. */
  source: string
}

export type Accommodation = {
  id: string
  name: string
  shortName: string
  description: string
  capacity: number
  capacityLabel: string
  availableUnits?: number
  /**
   * Per night, PHP — only when the Hacienda has published the figure itself
   * (its Airbnb listing text or its Published rates). Absent means the
   * Hacienda quotes on request; the page says so instead of inventing one.
   */
  price?: number
  priceLabel?: string      // e.g. "₱1,200 / unit / night"
  /** Where a listed price comes from, shown next to it. */
  priceSource?: string
  sleeping?: SleepingArrangement
  amenities: string[]      // keys into AMENITIES
  images: string[]         // paths in /public or full URLs
  active: boolean
  category: 'main-house' | 'camping'
}

export type NearbyAttraction = {
  id: string
  name: string
  description: string
  /** Town / province the attraction sits in — a verifiable fact, always shown. */
  area: string
  /** Optional: fill in only with a figure the Hacienda has measured itself. */
  distance?: string
  /** Optional: fill in only with a figure the Hacienda has timed itself. */
  travelTime?: string
  image: string
  mapsUrl?: string
}

export type Review = {
  name: string
  rating: number
  /** Verbatim — never edited or paraphrased. Long reviews are clamped in the UI, not cut. */
  body: string
  /** Month and year as the platform shows it, e.g. "August 2026". */
  date: string
  /** Where the review was published. */
  source: 'Airbnb' | 'Agoda' | 'Facebook' | 'Google'
}

export type HouseRule = {
  id: string
  title: string
  body: string
}

/** Something a guest reported in a public review — shown attributed, never as a rule. */
export type GuestNote = {
  id: string
  body: string
  /** First name + month/year of the review it comes from. */
  from: string
}

export type Fee = {
  id: string
  label: string
  /** PHP; omitted when the Hacienda has not published a figure. */
  amount?: number
  /** How the amount applies, when it is known — "per unit per night". */
  unit?: string
  note?: string
}

export type FAQ = {
  q: string
  a: string
}

export type GalleryImage = {
  id: string
  url: string
  category: 'Hacienda' | 'Main House' | 'Camping' | 'Outdoors' | 'Food & Gatherings' | 'Nearby Adventures'
  caption: string
  aspect?: 'tall' | 'wide' | 'square'
}

// -----------------------------------------------------------------------------
// BUSINESS
// -----------------------------------------------------------------------------
export const BUSINESS = {
  name: 'Hacienda de LuisAna',
  tagline: 'Munting mansyon ng Luisiana',
  positioning:
    'A peaceful private countryside escape in Luisiana, Laguna for families, friends, small gatherings, camping, and reconnecting with nature.',
  address: {
    street: 'Luisiana–Lucban Road, Brgy. San Isidro',
    city: 'Luisiana',
    region: 'Laguna',
    country: 'Philippines',
    formatted: 'Luisiana–Lucban Road, Brgy. San Isidro, Luisiana, Laguna, Philippines',
  },
  coordinates: {
    // Approximate; configurable.
    lat: 14.1754304,
    lng: 121.519389,
  },
  // Verified via public Facebook page listing.
  contact: {
    phone: '+63 925 850 7707',
    phoneDisplay: '(0925) 850 7707',
    email: 'haciendadeluisiana@gmail.com',
    facebook: 'https://www.facebook.com/haciendadeluisiana/',
    messenger: 'https://m.me/haciendadeluisiana',
    instagram: 'https://instagram.com/hacienda.de.luisiana',
    googleMaps:
      'https://www.google.com/maps/search/?api=1&query=14.1754304,121.519389',
    directions:
      'https://www.google.com/maps/dir/?api=1&destination=14.1754304,121.519389',
  },
  // House rules the Hacienda publishes on its Airbnb listing [A]:
  // "Check-in after 2:00 PM · Checkout before 12:00 PM · 10 guests maximum".
  policies: {
    checkIn: '2:00 PM',
    checkOut: '12:00 NN',
    maxGuests: 10,
    petFriendly: true,
    smokingAllowed: false,
  },
}

// -----------------------------------------------------------------------------
// OFFICIAL LISTINGS — the Hacienda's own pages on booking platforms
// -----------------------------------------------------------------------------
// Both URLs were opened and checked on 2026-09-26; each page is titled
// "Hacienda De LuisAna" and describes the Luisiana property. Guests who prefer
// to pay by card can book there; they are also the only third-party pages the
// Hacienda vouches for (see OFFICIAL_CHANNELS).
// -----------------------------------------------------------------------------
export const LISTINGS = {
  airbnb: {
    label: 'Airbnb',
    url: 'https://www.airbnb.com/rooms/1127261595245933990',
  },
  agoda: {
    label: 'Agoda',
    url: 'https://www.agoda.com/hacienda-de-luisana/hotel/luisiana-ph.html',
  },
} as const

// -----------------------------------------------------------------------------
// AIRBNB RATING — a snapshot, dated, so it is refreshed rather than trusted forever
// -----------------------------------------------------------------------------
// Read off the Hacienda's Airbnb listing [A] on `checkedOn`: "Rated 5.0 out of
// 5 · 9 reviews", "Guest favorite", "Hosted by Hacienda De LuisAna · Superhost
// · 2 years hosting". The category scores are Airbnb's own breakdown.
// The badge and the review summary render from this object; when the Admin
// re-checks the listing, update the figures and the date together.
// -----------------------------------------------------------------------------
export const AIRBNB_RATING = {
  rating: 5.0,
  reviewCount: 9,
  superhost: true,
  guestFavorite: true,
  categories: [
    { label: 'Cleanliness', score: 4.7 },
    { label: 'Accuracy', score: 4.9 },
    { label: 'Check-in', score: 4.9 },
    { label: 'Communication', score: 4.7 },
    { label: 'Location', score: 4.9 },
    { label: 'Value', score: 5.0 },
  ],
  checkedOn: '2026-09-26',
  url: LISTINGS.airbnb.url,
} as const

// -----------------------------------------------------------------------------
// OFFICIAL CHANNELS — the only places the Hacienda talks to guests or takes money
// -----------------------------------------------------------------------------
// Rendered on the booking page and in Contact. Everything listed here is
// already verified elsewhere in this file (BUSINESS.contact, LISTINGS).
// -----------------------------------------------------------------------------
export const OFFICIAL_CHANNELS = {
  headline: 'Official channels only',
  body:
    'Hacienda de LuisAna only communicates and accepts payments through the channels on this page: ' +
    'the phone number, email address and Facebook page below, the payment step of your booking on this website, ' +
    'and our listings on Airbnb and Agoda. We never ask for passwords, PINs or one-time codes. ' +
    'If someone else asks you to pay for a stay at the Hacienda, do not send anything — message us first.',
}

// -----------------------------------------------------------------------------
// STATS (Homepage Quick Experience Strip)
// -----------------------------------------------------------------------------
export const STATS = [
  { value: '10', label: 'Guests' },
  { value: '1', label: 'Private Main House' },
  { value: '2', label: 'Camping Units' },
  { value: 'Free', label: 'Wi-Fi & Parking' },
  { value: 'Pet', label: 'Friendly' },
]

// -----------------------------------------------------------------------------
// AMENITIES
// -----------------------------------------------------------------------------
export const AMENITIES: Amenity[] = [
  { key: 'wifi', label: 'Free Wi-Fi' },
  { key: 'parking', label: 'Free Parking' },
  { key: 'ac', label: 'Air Conditioning' },
  { key: 'kitchen', label: 'Kitchen' },
  { key: 'cooking', label: 'Cooking Facilities' },
  { key: 'fridge', label: 'Refrigerator' },
  { key: 'microwave', label: 'Microwave' },
  { key: 'kettle', label: 'Electric Kettle' },
  { key: 'tv', label: 'TV' },
  { key: 'outdoor-dining', label: 'Outdoor Dining' },
  { key: 'grill', label: 'Grill / Ihawan' },
  { key: 'campfire', label: 'Campfire Area' },
  { key: 'garden', label: 'Garden / Outdoor Space' },
  { key: 'pets', label: 'Pet Friendly' },
]

// -----------------------------------------------------------------------------
// FACEBOOK CDN IMAGE URLS (from official client Facebook photos)
// -----------------------------------------------------------------------------
// Source: https://www.facebook.com/haciendadeluisiana/photos
// These are hotlinked directly — visitor browsers load them from Facebook CDN.
// When URLs expire (token in `oe=...`), refresh from the Facebook page.
// See: /public/images/fb/README.md for full mapping and refresh instructions.
// -----------------------------------------------------------------------------
export const FB_CDN = {
  'fb-01': 'https://scontent.fmnl13-5.fna.fbcdn.net/v/t39.30808-6/787083560_1756248286510139_9003513602859904663_n.jpg?stp=cp6_dst-jpg_tt6&cstp=mx720x960&ctp=s720x960&_nc_cat=105&ccb=1-7&_nc_sid=833d8c&_nc_eui2=AeFcylekq2nyPe8p-bZze-otSVltRVYeh7tJWW1FVh6Hu5YRbZI3_QMRx8qBpFYHfYkyRbxb0KXtxEdXOM5xl2ua&_nc_ohc=_eqWiWnq2YkQ7kNvwH0shB6&_nc_oc=AdrJhKR5F8fqmVOnKwsjl3rDkgQBf6awchKeToAnMGLL5eaPfdrBvIFMiyUp2DjNPZw&_nc_zt=23&_nc_ht=scontent.fmnl13-5.fna&_nc_gid=D1rwFDxAaAEwXqLwe1So2A&_nc_ss=7b2a8&oh=00_AQJFBWqBje5UVGEw9UivSC9EB7NbKJnix8BK9GJO8r93ew&oe=6AA2EF7D',
  'fb-02': 'https://scontent.fmnl13-2.fna.fbcdn.net/v/t39.30808-6/784821378_1756248206510147_4908331255314011445_n.jpg?stp=cp6_dst-jpg_tt6&cstp=mx720x960&ctp=s720x960&_nc_cat=111&ccb=1-7&_nc_sid=833d8c&_nc_eui2=AeGyNBW_XNH9_B45FxNdeMmD0JaAbqOoNS3QloBuo6g1Lcz9NhNMMZxwKhyHgHIZLpPos0Abwm636vf25FyHP9z1&_nc_ohc=yXcPt63ifn0Q7kNvwHP27EP&_nc_oc=AdojP6i9h7VA2WAFdi_C7TLzozIjExoDaNiQt6RHm1aGb0cg5YIP2FQ8JD5vlhUqIP8&_nc_zt=23&_nc_ht=scontent.fmnl13-2.fna&_nc_gid=EbYbhFP549vSPGnOEnG-ZA&_nc_ss=7b2a8&oh=00_AQIpw0qGr-idhmbsLxoSG3q7KKIzvLyBpl5LRxnXRv_pAQ&oe=6AA2FF2B',
  'fb-03': 'https://scontent.fmnl13-2.fna.fbcdn.net/v/t39.30808-6/786520124_1756247993176835_6424925951785661436_n.jpg?stp=cp6_dst-jpg_tt6&cstp=mx720x960&ctp=s720x960&_nc_cat=111&ccb=1-7&_nc_sid=833d8c&_nc_eui2=AeHI8WG-z7aCdYWPGsbqguL95oDG5sNzgBnmgMbmw3OAGWUrizbo55aIhpN6ddd6A2LNnNFjRSC0-a-_K3jtTAkZ&_nc_ohc=7bqMyYUAiLAQ7kNvwHS-W1D&_nc_oc=AdqBONLDAqTnyr8lmIbjGG6ferD754Az1kPmXpV0U6bnLFRn0cyfSkpKeN86CwSBocM&_nc_zt=23&_nc_ht=scontent.fmnl13-2.fna&_nc_gid=IHZzdvBuuQCSQKGPyTx69g&_nc_ss=7b2a8&oh=00_AQKNt2ZX7vpjbY4KU1aM2FFH-jlnCSco0LBXoou3WNpTMg&oe=6AA30554',
  'fb-04': 'https://scontent.fmnl13-2.fna.fbcdn.net/v/t39.30808-6/786392812_1756247933176841_5786941906437746464_n.jpg?stp=cp6_dst-jpg_tt6&cstp=mx720x960&ctp=s720x960&_nc_cat=106&ccb=1-7&_nc_sid=833d8c&_nc_eui2=AeEfa9ACCk6MMxE2Cf4jJPjHJVJDoANw1bAlUkOgA3DVsALDUnjXBlc2qbzrBYCubCFiSej2O9ADSf6-CJI8rgqc&_nc_ohc=zjQELHVCm-sQ7kNvwFUu5JA&_nc_oc=AdpO7ndgJn9B5lJoTR5yanrMVgs_3A6gOr6cpx1aXr1EWt_nmaO1rh4mo733YCCtsfg&_nc_zt=23&_nc_ht=scontent.fmnl13-2.fna&_nc_gid=H3Q_9NIGuuWU7tYpEFLwtg&_nc_ss=7b2a8&oh=00_AQKgWgi-8eheYItlbtoebrhPg5IhVVz_j2r99AqzcVbdew&oe=6AA31191',
  'fb-05': 'https://scontent.fmnl13-1.fna.fbcdn.net/v/t39.30808-6/776453559_1745025087632459_1929950175208738272_n.jpg?stp=cp6_dst-jpg_tt6&cstp=mx720x960&ctp=s720x960&_nc_cat=100&ccb=1-7&_nc_sid=833d8c&_nc_eui2=AeFKCY7VsOPu_E8FuNXTIEoe_EU9ISSOc6v8RT0hJI5zq2thADNlTk-4TkAA5wcgRYFFZouSFVHocomVoPfji7x2&_nc_ohc=JLL9KiYCwMgQ7kNvwGVNlrH&_nc_oc=Adru47rwrG4FjDTFmdrBfvRJkw-Rxzl0x6I7wOdc7j0-tQS9pmYi4_YbGAfy9HM67lk&_nc_zt=23&_nc_ht=scontent.fmnl13-1.fna&_nc_gid=4fklMPlon8AEyhb5QlTmoA&_nc_ss=7b2a8&oh=00_AQL9QFgK0x58AOsi8w-9jGlxLtJVrLa0ybztNv7a5yeIaA&oe=6AA301A7',
  'fb-06': 'https://scontent.fmnl13-6.fna.fbcdn.net/v/t39.30808-6/774193415_1745025190965782_2552939446541801609_n.jpg?stp=cp6_dst-jpg_tt6&cstp=mx720x960&ctp=s720x960&_nc_cat=104&ccb=1-7&_nc_sid=833d8c&_nc_eui2=AeHXuOev29o_eOSkV9B-kvwhrNsvqWnpEsus2y-paekSy0bFQMMNgxrPcJTRQdp9JZv3337ynEzHRVZ8PjLxm44E&_nc_ohc=_NnkT1c1Yz0Q7kNvwGxf5cC&_nc_oc=AdpkSt8xtlpyH0zaNNpdwNGZ91QV0ulnnoezAxsuZYjfoAG0Ew0615_576HnOT98YTE&_nc_zt=23&_nc_ht=scontent.fmnl13-6.fna&_nc_gid=5HSYO5JaEDatdCaxB3G_KA&_nc_ss=7b2a8&oh=00_AQJGvSwcc91RGHSgJqvOk7tanPmWhK51OZWRoKUMOFh4ow&oe=6AA2FE68',
  'fb-07': 'https://scontent.fmnl13-2.fna.fbcdn.net/v/t39.30808-6/778568552_1745025164299118_864038632200873366_n.jpg?stp=cp6_dst-jpg_tt6&cstp=mx720x960&ctp=s720x960&_nc_cat=106&ccb=1-7&_nc_sid=833d8c&_nc_eui2=AeHC8amPfs7mOOtjJYUY6Ozvfm2JzQ1MKvN-bYnNDUwq89yUOUice6z8rhl0RMBqXoix-qmNJiXrtRr6F-cCeyVp&_nc_ohc=RxEOxtPYbHYQ7kNvwG9kcub&_nc_oc=Adqg5URVyZXb1tT4CpPDalCHLZ1A4gcpjMWvyPxd0laynVIACgD8LatTlezOAsrLmcM&_nc_zt=23&_nc_ht=scontent.fmnl13-2.fna&_nc_gid=AmQ_zfpHuD-ZTkZmZf_s7g&_nc_ss=7b2a8&oh=00_AQK0ODHEDuRGrnbcwIBJ6uyKmpvA7Q8G2S0RCrxQd37i3Q&oe=6AA30700',
  'fb-08': 'https://scontent.fmnl13-2.fna.fbcdn.net/v/t39.30808-6/774266193_1745025057632462_6998313209688464594_n.jpg?stp=cp6_dst-jpg_tt6&cstp=mx720x960&ctp=s720x960&_nc_cat=106&ccb=1-7&_nc_sid=833d8c&_nc_eui2=AeFbNcj1OYR7M4QQ_HKNcMYvOzWpkmfuG547NamSZ-4bno6ToXql0pUOrBuEeZC5dsZiVaArt25E5CYic2HlgSe6&_nc_ohc=6ZU7ptcKuqAQ7kNvwGFl9y6&_nc_oc=AdpNlrOsZRrzegGnGdJtXa2eLx7c8fbeff3NhDmdUKpVNnQ5E3vC9k_U7p40CEFwUXU&_nc_zt=23&_nc_ht=scontent.fmnl13-2.fna&_nc_gid=nvzQQ3de23k6Yu6T14cYUQ&_nc_ss=7b2a8&oh=00_AQKyYD7EKoQYBmS9xikV8N20YQrH7lByDV2_DlZ1pltdOA&oe=6AA31446',
} as const

// -----------------------------------------------------------------------------
// ACCOMMODATIONS
// -----------------------------------------------------------------------------
export const ACCOMMODATIONS: Accommodation[] = [
  {
    id: 'main-house',
    name: 'The Main House',
    shortName: 'Main House',
    description:
      'A private countryside home designed for groups and families looking for a comfortable place to stay together.',
    capacity: 10,
    capacityLabel: 'Up to 10 guests',
    // No nightly figure is published anywhere the website can cite (the Airbnb
    // price only appears once dates are chosen). The Published rates document
    // supplies it when the Admin publishes one; until then the page says
    // "quoted on request" — it does not guess.
    priceLabel: 'Quoted on request',
    // [A] "Where you'll sleep": Bedroom — 2 double beds, 6 single beds;
    // Living room — 1 sofa bed. "1 bedroom · 9 beds". The bathroom count is
    // deliberately absent: Airbnb lists 1 bath and Agoda lists 2 bathrooms,
    // so it waits for the Hacienda to confirm.
    sleeping: {
      bedrooms: 1,
      beds: [
        { count: 2, type: 'double beds', where: 'Bedroom' },
        { count: 6, type: 'single beds', where: 'Bedroom' },
        { count: 1, type: 'sofa bed', where: 'Living room' },
      ],
      source: "As listed on the Hacienda's Airbnb page",
    },
    amenities: [
      'ac', 'wifi', 'kitchen', 'fridge', 'microwave',
      'kettle', 'tv', 'garden', 'parking',
    ],
    images: [
      '/images/gmaps/img-01.jpg',
      '/images/gmaps/img-14.jpg',
      FB_CDN['fb-06'],
      '/images/gmaps/img-04.jpg',
      '/images/gmaps/img-03.jpg',
      FB_CDN['fb-05'],
      FB_CDN['fb-07'],
      '/images/gmaps/img-08.jpg',
      '/images/gmaps/img-06.jpg',
    ],
    active: true,
    category: 'main-house',
  },
  {
    id: 'house-a-camping',
    name: 'House A Camping Units',
    shortName: 'Camping Unit',
    description:
      'For guests who want a simpler and more intimate countryside camping experience.',
    capacity: 2,
    capacityLabel: 'Up to 2 guests per unit',
    availableUnits: 2,
    // [A] "A-Houses only (2 pax per unit) — 2 units available — ₱1,200/unit".
    // The Hacienda's own listed figure; the Published rates override it.
    price: 1200,
    priceLabel: '₱1,200 / unit / night',
    priceSource: "Listed by the Hacienda on Airbnb",
    amenities: ['campfire', 'grill', 'garden', 'wifi', 'parking', 'pets'],
    images: [
      '/images/gmaps/img-02.jpg',
      FB_CDN['fb-02'],
      '/images/gmaps/img-09.jpg',
      '/images/gmaps/img-12.jpg',
    ],
    active: true,
    category: 'camping',
  },
]

// -----------------------------------------------------------------------------
// NEARBY ATTRACTIONS
// -----------------------------------------------------------------------------
// The Hacienda names these on its Airbnb listing [A] as places to explore.
// `area` is the town each sits in (public geography). `distance` and
// `travelTime` are optional and empty on purpose: the Hacienda has not
// measured them, and a guessed "45 min" is worse than none.
// -----------------------------------------------------------------------------
export const NEARBY: NearbyAttraction[] = [
  {
    id: 'hulugan-falls',
    name: 'Hulugan Falls',
    description: 'One of Laguna\'s most breathtaking waterfalls — a lush, towering cascade tucked in Luisiana itself.',
    area: 'Brgy. San Salvador, Luisiana, Laguna',
    image: '/images/nearby/hulugan.jpg',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Hulugan+Falls+Luisiana+Laguna',
  },
  {
    id: 'sumucab-twin-falls',
    name: 'Sumucab Twin Falls',
    description: 'Twin waterfalls hidden along a peaceful trail near Luisiana — perfect for a half-day hike.',
    area: 'Cavinti / Luisiana, Laguna',
    image: '/images/nearby/sumucab.jpg',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Sumucab+Twin+Falls+Luisiana',
  },
  {
    id: 'aliw-falls',
    name: 'Aliw Falls',
    description: 'A serene, wide-curtain waterfall with clear pools ideal for a quick dip and photos.',
    area: 'Luisiana, Laguna',
    image: '/images/nearby/aliw.jpg',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Aliw+Falls+Luisiana+Laguna',
  },
  {
    id: 'kamay-ni-hesus',
    name: 'Kamay ni Hesus',
    description: 'The famous pilgrim site in Lucban featuring a hilltop climb to a towering statue of the Ascending Christ.',
    area: 'Lucban, Quezon',
    image: '/images/nearby/kamay.jpg',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Kamay+ni+Hesus+Lucban',
  },
  {
    id: 'caliraya-lake',
    name: 'Caliraya Lake',
    description: 'A tranquil man-made lake surrounded by pines — great for kayaking, fishing, and lakeside picnics.',
    area: 'Lumban / Cavinti, Laguna',
    image: '/images/nearby/caliraya.jpg',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Caliraya+Lake+Laguna',
  },
  {
    id: 'cavinti-cave',
    name: 'Cavinti Underground Cave',
    description: 'An adventurous underground river-cave system for spelunking and rappelling enthusiasts.',
    area: 'Cavinti, Laguna',
    image: '/images/nearby/cavinti.jpg',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Cavinti+Underground+River+Cave',
  },
]

// -----------------------------------------------------------------------------
// FAQs
// -----------------------------------------------------------------------------
// Every answer states only what the Hacienda itself publishes [A] or what this
// website does. Money questions point at the Rates section, which reads the
// Published rates live.
// -----------------------------------------------------------------------------
export const FAQS: FAQ[] = [
  {
    q: 'How many guests can stay?',
    a: `The Main House takes up to ${BUSINESS.policies.maxGuests} guests. Each House A camping unit sleeps 2, and there are 2 units.`,
  },
  {
    q: 'Are pets allowed?',
    a: 'Yes. Pets are welcome for an additional ₱300 cleaning and sanitizing fee — see Rates & Fees. Mention your pet in the special requests when you book.',
  },
  { q: 'Is parking available?', a: 'Yes, free parking is available on-site.' },
  { q: 'Is Wi-Fi available?', a: 'Yes, Wi-Fi is free for guests.' },
  {
    q: 'Can we cook?',
    a: 'Yes. Use of the gas stove, kitchen utensils and the ihawan (grill) is free, and the Main House has a refrigerator, microwave and electric kettle.',
  },
  {
    q: 'Can we have a small gathering?',
    a: 'The Hacienda hosts family bonding, small events, church camping and team building. Tell us about your gathering in the special requests so the arrangements can be confirmed with you beforehand.',
  },
  {
    q: 'Do you offer camping?',
    a: 'Yes. There are 2 House A camping units, each for up to 2 guests. They can be booked on their own — choose the camping unit on the booking form or message us directly.',
  },
  {
    q: 'What time is check-in?',
    a: `Check-in is from ${BUSINESS.policies.checkIn}.`,
  },
  {
    q: 'What time is check-out?',
    a: `Check-out is by ${BUSINESS.policies.checkOut}.`,
  },
  {
    q: 'How much does it cost?',
    a: 'The House A camping units are listed at ₱1,200 per unit per night. The Main House is quoted on request; the Rates & Fees section shows the current published figures, the refundable security deposit and the payment plans, and the Hacienda confirms the final quote before anything is reserved.',
  },
  {
    q: 'How do I reserve?',
    a: 'Send a booking request from this website. The Hacienda reviews it, and your dates are held for 24 hours while it does. Once approved, you choose a payment plan and upload your payment proof; the stay is reserved when the payment is verified. You can also book through our Airbnb or Agoda listings.',
  },
  {
    q: 'How do I get there?',
    a: 'The Hacienda is on the Luisiana–Lucban Road in Brgy. San Isidro, Luisiana. See Getting Here under Location for the landmark, the driving route and the commute via Sta. Cruz.',
  },
]

// -----------------------------------------------------------------------------
// GALLERY (uses real property imagery — Google Maps listing + Facebook photos)
// -----------------------------------------------------------------------------
export const GALLERY: GalleryImage[] = [
  // Hacienda — exterior / overview
  { id: 'g07', url: '/images/gmaps/img-07.jpg', category: 'Hacienda', caption: 'The Hacienda at dusk — main house, campfire, and camping units', aspect: 'wide' },
  { id: 'g13', url: '/images/gmaps/img-13.jpg', category: 'Hacienda', caption: 'Campfire in front of the main house at blue hour', aspect: 'tall' },
  { id: 'g10', url: '/images/gmaps/img-10.jpg', category: 'Hacienda', caption: 'Welcome — the HDL signage at the entrance', aspect: 'square' },
  { id: 'fb08', url: FB_CDN['fb-08'], category: 'Hacienda', caption: 'Hacienda de LuisAna — main gate and welcome sign', aspect: 'square' },

  // Main house — exterior
  { id: 'g01', url: '/images/gmaps/img-01.jpg', category: 'Main House', caption: 'Front facade of the main house at golden hour', aspect: 'tall' },
  { id: 'g14', url: '/images/gmaps/img-14.jpg', category: 'Main House', caption: 'The main house — private entrance and garden', aspect: 'square' },
  { id: 'g06', url: '/images/gmaps/img-06.jpg', category: 'Main House', caption: 'Side view of the main house with garden', aspect: 'tall' },
  { id: 'g08', url: '/images/gmaps/img-08.jpg', category: 'Main House', caption: 'The main house lit up at night', aspect: 'tall' },

  // Main house — interior (Facebook photos)
  { id: 'fb05', url: FB_CDN['fb-05'], category: 'Main House', caption: 'Cozy living room with big-screen TV', aspect: 'wide' },
  { id: 'fb06', url: FB_CDN['fb-06'], category: 'Main House', caption: 'Dining area with fresh flowers and garden view', aspect: 'tall' },
  { id: 'fb07', url: FB_CDN['fb-07'], category: 'Main House', caption: 'Wooden piano and staircase leading to the loft', aspect: 'tall' },
  { id: 'g03', url: '/images/gmaps/img-03.jpg', category: 'Main House', caption: 'Loft bedroom with wooden floors and countryside views', aspect: 'wide' },
  { id: 'g04', url: '/images/gmaps/img-04.jpg', category: 'Main House', caption: 'Dining area with warm pendant lights and open windows', aspect: 'tall' },

  // Camping
  { id: 'g02', url: '/images/gmaps/img-02.jpg', category: 'Camping', caption: 'A-frame camping units under the trees', aspect: 'tall' },
  { id: 'g09', url: '/images/gmaps/img-09.jpg', category: 'Camping', caption: 'Two A-frame cabins with stepping-stone path', aspect: 'square' },
  { id: 'g12', url: '/images/gmaps/img-12.jpg', category: 'Camping', caption: 'Camping cabins glowing warm at nightfall', aspect: 'tall' },
  { id: 'fb02', url: FB_CDN['fb-02'], category: 'Camping', caption: 'Foggy afternoon — A-frame cabins peeking through the mist', aspect: 'tall' },

  // Outdoors (Facebook foggy shots + Google Maps garden)
  { id: 'fb01', url: FB_CDN['fb-01'], category: 'Outdoors', caption: 'Misty morning — pine trees and stone pathway through the garden', aspect: 'tall' },
  { id: 'fb03', url: FB_CDN['fb-03'], category: 'Outdoors', caption: 'The white fence fading into the fog', aspect: 'wide' },
  { id: 'fb04', url: FB_CDN['fb-04'], category: 'Outdoors', caption: 'Norfolk pines and red ti plants on a foggy day', aspect: 'tall' },
  { id: 'g05', url: '/images/gmaps/img-05.jpg', category: 'Outdoors', caption: 'Garden pathway with views toward the countryside', aspect: 'tall' },
  { id: 'g11', url: '/images/gmaps/img-11.jpg', category: 'Outdoors', caption: 'The Hacienda framed by lush foliage', aspect: 'square' },
]

// -----------------------------------------------------------------------------
// EXPERIENCES
// -----------------------------------------------------------------------------
export const EXPERIENCES = [
  {
    id: 'family',
    title: 'Family Bonding',
    body: 'Spend uninterrupted time together away from the city.',
    image: FB_CDN['fb-05'],
  },
  {
    id: 'gatherings',
    title: 'Small Gatherings',
    body: 'A peaceful setting for intimate celebrations and gatherings.',
    image: FB_CDN['fb-06'],
  },
  {
    id: 'camping',
    title: 'Camping',
    body: 'Experience the outdoors without completely giving up comfort.',
    image: '/images/gmaps/img-02.jpg',
  },
  {
    id: 'team-building',
    title: 'Team Building',
    body: 'A relaxed countryside environment for small team activities.',
    image: '/images/gmaps/img-05.jpg',
  },
  {
    id: 'nature',
    title: 'Nature Escape',
    body: 'Slow down, breathe fresh air, and explore the surrounding Laguna countryside.',
    image: FB_CDN['fb-01'],
  },
  {
    id: 'retreat',
    title: 'Quiet Retreat',
    body: 'A place to disconnect from noise and reconnect with yourself and others.',
    image: FB_CDN['fb-03'],
  },
]

// -----------------------------------------------------------------------------
// REVIEWS — verbatim, from the Hacienda's Airbnb listing [A], read 2026-09-26
// -----------------------------------------------------------------------------
// Rules for this list:
//   - Copy the text exactly as published. Do not trim, fix spelling or
//     paraphrase — a long review is clamped by the UI with "Read more".
//   - First name as the platform shows it, month and year, the platform.
//   - Add reviews only from the listing itself; never write one.
// Airbnb showed 6 of the 9 reviews on the listing page; the other 3 sit behind
// "Show all 9 reviews" and can be added the same way.
// -----------------------------------------------------------------------------
export const REVIEWS: Review[] = [
  {
    name: 'Rachel Dominique',
    rating: 5,
    date: 'August 2026',
    source: 'Airbnb',
    body:
      'If you’re looking for a peaceful, quiet, and refreshing place to relax and spend quality time w family/friends, this is a great place to stay. The property has a huge garden where kids can safely run around and enjoy the open space.\n\n' +
      'We also appreciated the privacy. The owner mentioned that when the main house is booked, they don’t rent out the A-houses to other guests, and vice versa.\n\n' +
      'The road leading to the property is a narrow, single-lane road, but we were able to manage it even with three full-sized SUVs. All three vehicles also fit in the parking area. The owner’s family was very helpful in guiding us and helping us park our cars properly.\n\n' +
      'Drinking water is available from the owner for an additional fee if you don’t bring your own. You can also request a bonfire, which was a nice option for spending time outdoors in the evening.\n\n' +
      'One thing to keep in mind is that the house is about a 1–2 minute walk from the parking area so you need to carry your belongings a short distance.',
  },
  {
    name: 'Angel',
    rating: 5,
    date: 'July 2026',
    source: 'Airbnb',
    body:
      'Great place! Super clean and it smells really nice when we arrived. The caretaker and owner were very friendly and they even gave us free suman. Our dog also had so much fun running around their garden. We also had a great time star gazing at night while having a bonfire. 10/10 will definitely come back here.',
  },
  {
    name: 'Gela',
    rating: 5,
    date: 'May 2026',
    source: 'Airbnb',
    body:
      'Had a wonderful stay! The place was very clean, cozy, and truly felt like home. Everything was well-prepared and comfortable, which made our stay relaxing and enjoyable. Highly recommend, and would definitely stay here again!',
  },
  {
    name: 'Sandro',
    rating: 5,
    date: 'May 2026',
    source: 'Airbnb',
    body:
      "it's a great place to relax in. the environment is peaceful. the place itself has an amazing aesthetic without sacrificing elegance. 6stars if I'm not limited by the app.",
  },
  {
    name: 'Jof',
    rating: 5,
    date: 'June 2026',
    source: 'Airbnb',
    body: 'The owner is friendly and the place is nice.',
  },
  {
    name: 'Roserine',
    rating: 5,
    date: 'March 2026',
    source: 'Airbnb',
    body: 'Very nice cozy home',
  },
]

// -----------------------------------------------------------------------------
// HOUSE RULES — the Hacienda's own published terms of a stay [A]
// -----------------------------------------------------------------------------
// Only statements the Hacienda itself makes on its listing belong here. What
// guests report about the place lives in GUEST_NOTES, attributed.
// -----------------------------------------------------------------------------
export const HOUSE_RULES: HouseRule[] = [
  {
    id: 'times',
    title: 'Check-in and check-out',
    body: `Check-in from ${BUSINESS.policies.checkIn}, check-out by ${BUSINESS.policies.checkOut}.`,
  },
  {
    id: 'capacity',
    title: 'Headcount',
    body: `The Main House is for a maximum of ${BUSINESS.policies.maxGuests} guests. Each House A camping unit is for 2 guests, and there are 2 units.`,
  },
  {
    id: 'pets',
    title: 'Pets',
    body: 'Pets are allowed for an additional ₱300 cleaning and sanitizing fee.',
  },
  {
    id: 'claygo',
    title: 'Clean as you go',
    body: 'Please clean as you go — the Hacienda’s own request to every guest.',
  },
  {
    id: 'kitchen',
    title: 'Kitchen, ihawan and bonfire',
    body: 'Free use of the gas stove, kitchen utensils, the ihawan (grill) and the bonfire pit.',
  },
  {
    id: 'parking',
    title: 'Parking',
    body: 'Free parking on the property.',
  },
]

// -----------------------------------------------------------------------------
// GUEST NOTES — practical things guests said in public reviews [D]
// -----------------------------------------------------------------------------
// These are useful before a trip but they are a guest's account, not the
// Hacienda's promise, and the UI labels them that way. When the Hacienda
// confirms one, move it up into HOUSE_RULES.
// -----------------------------------------------------------------------------
export const GUEST_NOTES: GuestNote[] = [
  {
    id: 'road',
    body: 'The road leading to the property is a narrow, single-lane road — one group managed it with three full-sized SUVs, and all three fit in the parking area.',
    from: 'Rachel Dominique, August 2026',
  },
  {
    id: 'walk',
    body: 'The house is about a 1–2 minute walk from the parking area, so you carry your things a short distance.',
    from: 'Rachel Dominique, August 2026',
  },
  {
    id: 'water',
    body: 'Drinking water is available from the owner for an additional fee if you don’t bring your own.',
    from: 'Rachel Dominique, August 2026',
  },
  {
    id: 'bonfire',
    body: 'You can request a bonfire for the evening.',
    from: 'Rachel Dominique, August 2026 · Angel, July 2026',
  },
  {
    id: 'exclusive',
    body: 'The owner told guests that when the Main House is booked, the A-houses are not rented out to other guests, and vice versa.',
    from: 'Rachel Dominique, August 2026',
  },
]

// -----------------------------------------------------------------------------
// FEES — what the Hacienda publishes beyond the nightly rate [A]
// -----------------------------------------------------------------------------
// Nightly rates, the Security deposit and the down-payment percentage are NOT
// here: they are the Published rates (site_config/rates) and the Rates section
// reads them live. This block is for the fixed extras the Hacienda lists.
// An item without `amount` is one the Hacienda offers but has not priced
// publicly; the UI says "ask for the current price" for it.
// -----------------------------------------------------------------------------
export const FEES = {
  /** Included in every stay at no extra charge — from the listing's own checklist. */
  included: [
    'Free Wi-Fi',
    'Free parking',
    'Free use of gas and stove',
    'Free use of the ihawan (grill)',
    'Free use of the bonfire pit',
    'Kitchen utensils',
    'Air-conditioning, TV, refrigerator, microwave and electric kettle (Main House)',
  ],
  /** Charged on top of the stay when they apply. */
  additional: [
    {
      id: 'pets',
      label: 'Pets',
      amount: 300,
      note: 'Cleaning and sanitizing fee. Ask whether it applies per pet or per stay when you book.',
    },
  ] as Fee[],
  /** Available on request; priced by the Hacienda when you ask. */
  optional: [
    {
      id: 'water',
      label: 'Drinking water',
      note: 'Available from the Hacienda if you don’t bring your own (as guests report) — ask for the current price.',
    },
  ] as Fee[],
}

// -----------------------------------------------------------------------------
// GETTING HERE — landmark and routes, without invented travel times
// -----------------------------------------------------------------------------
// Landmark: the Hacienda's own "neighborhood highlights" on Airbnb [A].
// Routes: the standard approach every public Luisiana guide describes [E];
// the Hacienda's road is the Luisiana–Lucban Road (its own address [C]).
// Travel times and fares are left out on purpose — they change, and the
// Hacienda has not published any.
// -----------------------------------------------------------------------------
export const GETTING_HERE = {
  landmark: {
    title: 'Look for the landmark',
    body:
      'The Hacienda’s private road is in front of Alicia’s Bibingkahan and near an auto shop, off the Luisiana–Lucban Road in Brgy. San Isidro. There are stores along the main road.',
  },
  byCar: {
    title: 'By car from Metro Manila',
    steps: [
      'Take SLEX and exit at Calamba.',
      'Follow the national highway through Los Baños, Bay, Pila, Sta. Cruz and Pagsanjan.',
      'Turn onto the Cavinti–Luisiana Road, continue into Luisiana, then follow the Luisiana–Lucban Road to Brgy. San Isidro.',
      'Use the Get Directions button for turn-by-turn navigation to the pin.',
    ],
  },
  byCommute: {
    title: 'By public transport',
    steps: [
      'Take a bus bound for Sta. Cruz, Laguna (terminals in Cubao, Buendia/Taft and Alabang).',
      'At Sta. Cruz town proper, ride a jeepney bound for Luisiana or Lucban — the terminal is behind Jollibee Sta. Cruz.',
      'Tell the driver you are getting off at Brgy. San Isidro, Luisiana, near Alicia’s Bibingkahan.',
      'If you are unsure of the stop, message the Hacienda before you set off.',
    ],
  },
}
