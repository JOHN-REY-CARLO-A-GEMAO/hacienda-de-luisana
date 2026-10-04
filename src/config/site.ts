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
// Money: standard-stay guest schedules, the Security deposit, the 50% down-
// payment percentage and cancellation policy are the Admin's Published rates
// (`site_config/rates`, see src/lib/booking/rates.ts). The website reads them
// live; static figures below are informational until the Admin publishes.
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
  /** Independent absolute guest cap only when separately documented (A-House: 3). */
  capacity?: number
  /** Included guest count or documented per-unit cap; never assume included = maximum. */
  capacityLabel: string
  availableUnits?: number
  /**
   * PHP per standard stay — only when the Hacienda has published the figure
   * itself or the Admin's Published rates. Absent means the Hacienda quotes
   * on request; the page says so instead of inventing one.
   */
  price?: number
  priceLabel?: string      // e.g. "₱1,200 / unit / night"
  /** Where a listed price comes from, shown next to it. */
  priceSource?: string
  sleeping?: SleepingArrangement
  amenities: string[]      // keys into AMENITIES
  images: string[]         // paths in /public or full URLs
  active: boolean
  category: 'main-house' | 'annex' | 'camping'
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
  // Standard stay and published house rules.
  policies: {
    checkIn: '2:00 PM',
    checkOut: '12:00 NN',
    standardStayHours: 22,
    mainHouseIncludedGuests: 10,
    annexIncludedGuests: 6,
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
  { key: 'workspace', label: 'Dedicated Workspace' },
  { key: 'patio', label: 'Patio / Balcony' },
  { key: 'rice-cooker', label: 'Rice Cooker' },
  { key: 'piano', label: 'Piano' },
  { key: 'butterfly-fridge', label: 'Butterfly Refrigerator' },
]

// -----------------------------------------------------------------------------
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
    capacityLabel: '10 guests included · additional guests use the published per-person rate',
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
      'ac', 'wifi', 'kitchen', 'fridge', 'butterfly-fridge', 'microwave',
      'kettle', 'rice-cooker', 'tv', 'piano', 'workspace', 'patio',
      'cooking', 'grill', 'campfire', 'garden', 'parking',
    ],
    images: [
      '/images/gmaps/img-01.jpg',
      '/images/gmaps/img-14.jpg',
      '/images/gmaps/img-04.jpg',
      '/images/gmaps/img-03.jpg',
      '/images/gmaps/img-08.jpg',
      '/images/gmaps/img-06.jpg',
    ],
    active: true,
    category: 'main-house',
  },
  {
    id: 'annex',
    name: 'HDL Annex',
    shortName: 'Annex',
    description: 'A separate Hacienda stay option with 6 guests included and a per-guest excess rate under the weekday/weekend-holiday schedule.',
    capacityLabel: '6 guests included · additional guests use the published per-person rate',
    priceLabel: 'From ₱4,000 / standard stay',
    priceSource: 'Official Hacienda rate card',
    amenities: [
      'wifi', 'parking', 'cooking', 'grill', 'campfire', 'workspace',
      'patio', 'ac', 'rice-cooker', 'tv', 'fridge', 'microwave', 'kettle',
    ],
    // Client materials supplied the Annex rate and capacity but no Annex-only
    // photograph. Use the Hacienda overview rather than mislabelling another room.
    images: ['/images/gmaps/img-07.jpg'],
    active: true,
    category: 'annex',
  },
  {
    id: 'house-a-camping',
    name: 'A-House',
    shortName: 'A-House',
    description:
      'An intimate A-frame countryside stay, priced at ₱1,000 per A-House for up to 3 guests.',
    capacity: 3,
    capacityLabel: 'Up to 3 guests per A-House',
    availableUnits: 2,
    price: 1000,
    priceLabel: '₱1,000 / A-House / standard stay',
    priceSource: 'Official Hacienda rate card',
    amenities: ['campfire', 'grill', 'garden', 'wifi', 'parking', 'pets'],
    images: [
      '/images/gmaps/camping_units_stepping_stones.jpg',
      '/images/gmaps/img-02.jpg',
      '/images/gmaps/camping_units_garden.jpg',
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
    a: `The Main House base rate includes ${BUSINESS.policies.mainHouseIncludedGuests} guests and the Annex base rate includes ${BUSINESS.policies.annexIncludedGuests}; additional guests are priced at ₱500 each under the published schedule. These included counts are not absolute caps. Each A-House is one unit for up to 3 guests; contact the Hacienda to discuss large groups or multiple units.`,
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
    a: 'Yes. There are 2 A-Houses, each priced at ₱1,000 per unit for up to 3 guests. One online booking holds one A-House; message the Hacienda if you need more than one unit.'
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
    a: 'Rates depend on the property, guest count, and the check-in night: Sunday through Thursday is weekday, Friday and Saturday are weekend, and any Admin-configured holiday uses the weekend/holiday rate. A Saturday stay checks out Sunday at noon. The Rates & Fees section shows the current schedule and optional charges.',
  },
  {
    q: 'How do I reserve?',
    a: 'Browse the rooms and book without creating an account. Fill in your stay and contact details, then upload a screenshot of your downpayment. The booking is submitted as Pending and is not confirmed until the Hacienda approves that screenshot — or rejected if they decline it. You can also book through our Airbnb or Agoda listings.',
  },
  {
    q: 'How do I get there?',
    a: 'The Hacienda is on the Luisiana–Lucban Road in Brgy. San Isidro, Luisiana. See Getting Here under Location for the landmark, the driving route and the commute via Sta. Cruz.',
  },
]

// -----------------------------------------------------------------------------
// GALLERY (real property imagery — Google Maps listing photos in public/images)
//
// Every entry must point at a file that exists under `public/`. A tile whose
// image fails to load falls back to a gradient placeholder showing only the
// caption (`SmartImage`), which reads as a broken card rather than a photo.
// The Facebook CDN shots that used to sit here were dropped for exactly that
// reason: they were hotlinks with expiring tokens, nothing backed them on
// disk, and all eight had expired. `test/web/gallery-images.test.ts` holds the
// line — it walks `public/` and fails on any referenced path that is missing.
// To add a photo: drop the file in `public/images/gmaps/`, add the entry, run
// the tests. See assets/images/gmaps/README.md.
// -----------------------------------------------------------------------------
export const GALLERY: GalleryImage[] = [
  // Hacienda — exterior / overview
  { id: 'g07', url: '/images/gmaps/img-07.jpg', category: 'Hacienda', caption: 'The Hacienda at dusk — main house, campfire, and camping units', aspect: 'wide' },
  { id: 'g13', url: '/images/gmaps/img-13.jpg', category: 'Hacienda', caption: 'Campfire in front of the main house at blue hour', aspect: 'tall' },
  { id: 'g10', url: '/images/gmaps/img-10.jpg', category: 'Hacienda', caption: 'Welcome — the HDL signage at the entrance', aspect: 'square' },
  { id: 'g17', url: '/images/gmaps/hdl_sign_wall.jpg', category: 'Hacienda', caption: 'The Hacienda’s own sign — “Munting Mansyon ng Luisiana”', aspect: 'tall' },

  // Main house — exterior
  { id: 'g01', url: '/images/gmaps/img-01.jpg', category: 'Main House', caption: 'Front facade of the main house at golden hour', aspect: 'tall' },
  { id: 'g14', url: '/images/gmaps/img-14.jpg', category: 'Main House', caption: 'The main house — private entrance and garden', aspect: 'square' },
  { id: 'g06', url: '/images/gmaps/img-06.jpg', category: 'Main House', caption: 'Side view of the main house with garden', aspect: 'tall' },
  { id: 'g08', url: '/images/gmaps/img-08.jpg', category: 'Main House', caption: 'The main house lit up at night', aspect: 'tall' },
  { id: 'g15', url: '/images/gmaps/main_house_facade.jpg', category: 'Main House', caption: 'Front of the main house — the HDL sign, bench and parasol', aspect: 'wide' },
  { id: 'g16', url: '/images/gmaps/main_house_night_lit.jpg', category: 'Main House', caption: 'The main house lit at night, above the carport', aspect: 'tall' },
  { id: 'g18', url: '/images/gmaps/entrance_porch_sign.jpg', category: 'Main House', caption: 'The entrance porch of the main house, framed by a Norfolk pine', aspect: 'tall' },

  // Main house — interior
  { id: 'g03', url: '/images/gmaps/img-03.jpg', category: 'Main House', caption: 'Loft bedroom with wooden floors and countryside views', aspect: 'wide' },
  { id: 'g04', url: '/images/gmaps/img-04.jpg', category: 'Main House', caption: 'Dining area with warm pendant lights and open windows', aspect: 'tall' },

  // Camping
  { id: 'g02', url: '/images/gmaps/img-02.jpg', category: 'Camping', caption: 'A-frame camping units under the trees', aspect: 'tall' },
  { id: 'g09', url: '/images/gmaps/img-09.jpg', category: 'Camping', caption: 'Two A-frame cabins with stepping-stone path', aspect: 'square' },
  { id: 'g12', url: '/images/gmaps/img-12.jpg', category: 'Camping', caption: 'Camping cabins glowing warm at nightfall', aspect: 'tall' },
  { id: 'g19', url: '/images/gmaps/camping_units_garden.jpg', category: 'Camping', caption: 'The two A-frame units seen through the garden blooms', aspect: 'tall' },
  { id: 'g20', url: '/images/gmaps/camping_units_stepping_stones.jpg', category: 'Camping', caption: 'A stepping-stone path laid to the door of each unit', aspect: 'wide' },

  // Outdoors
  { id: 'g05', url: '/images/gmaps/img-05.jpg', category: 'Outdoors', caption: 'Garden pathway with views toward the countryside', aspect: 'tall' },
  { id: 'g11', url: '/images/gmaps/img-11.jpg', category: 'Outdoors', caption: 'The Hacienda framed by lush foliage', aspect: 'square' },
]

// -----------------------------------------------------------------------------
// EXPERIENCES
//
// Same rule as GALLERY: `image` must resolve to a file under `public/`. A card
// whose image fails renders as a gradient tile carrying nothing but its title,
// so a dead URL costs the card its photograph. These four were removed with the
// expired Facebook hotlinks they pointed at — Family Bonding, Small Gatherings,
// Nature Escape and Quiet Retreat. Re-add them once real photos exist for them.
// -----------------------------------------------------------------------------
export const EXPERIENCES = [
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
    body: `The standard 22-hour stay checks in at ${BUSINESS.policies.checkIn} and checks out by ${BUSINESS.policies.checkOut} for cleaning before the next guest. Late checkout is by request and approval, at ₱250 per hour after noon.`,
  },
  {
    id: 'capacity',
    title: 'Headcount and included occupancy',
    body: `The Main House base rate includes ${BUSINESS.policies.mainHouseIncludedGuests} guests and the Annex base rate includes ${BUSINESS.policies.annexIncludedGuests}; each additional guest is ₱500 under the published schedule. Those included counts are not stated as absolute caps. Each A-House is one unit for up to 3 guests; ask the Admin about large groups or multiple units.`,
  },
  {
    id: 'pets',
    title: 'Pets',
    body: 'Pets are welcome. The sanitation fee is ₱300 per pet and is not added unless a guest declares a pet.',
  },
  {
    id: 'claygo',
    title: 'Clean as you go',
    body: 'CLEAN AS YOU GO! Please observe the Hacienda house rules.',
  },
  {
    id: 'kitchen',
    title: 'Kitchen, ihawan and bonfire',
    body: 'Free use of the gas stove, kitchen utensils, BBQ grill and bonfire pit. An optional bonfire wood set is ₱150 and is not automatically added.',
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
// FEES — optional charges beyond the computed standard-stay total [A]
// -----------------------------------------------------------------------------
// Guest-count schedules, the Security deposit and the 50% down payment are NOT
// here: they are the Published rates (site_config/rates) and the Rates section
// reads them live. This block is for optional extras the Hacienda lists.
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
    'Dedicated workspace and patio / balcony',
    'Air conditioning',
    'Rice cooker',
    'Television and piano',
    'Butterfly refrigerator',
    'Microwave and electric kettle',
  ],
  /** Charged on top of the stay when they apply. */
  additional: [
    {
      id: 'pets',
      label: 'Pets',
      amount: 300,
      unit: 'per pet',
      note: '₱300 per pet for sanitation. Mention pets explicitly; this is not added automatically to ordinary stays.',
    },
    {
      id: 'bonfire-wood',
      label: 'Bonfire wood set',
      amount: 150,
      unit: 'per set',
      note: 'Optional; free use of the bonfire pit remains included.',
    },
    {
      id: 'late-checkout',
      label: 'Approved late checkout',
      amount: 250,
      unit: 'per hour after 12:00 noon',
      note: 'Applied only when requested and approved.',
    },
  ] as Fee[],
  /** Available on request; priced by the Hacienda when you ask. */
  optional: [
    {
      id: 'wedding-preparation',
      label: 'Wedding-preparation overnight package',
      amount: 8500,
      unit: 'overnight · up to 10 pax',
      note: 'Only for a booking explicitly identified as wedding preparation and confirmed by the Admin; never added to an ordinary stay.',
    },
    {
      id: 'special-event',
      label: 'Reunion, team building or shoot',
      note: 'Discuss the use case with the Admin. No arbitrary event charge is added automatically; the Admin confirms any agreed amount.',
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
