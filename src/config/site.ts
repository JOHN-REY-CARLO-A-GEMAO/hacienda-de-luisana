// -----------------------------------------------------------------------------
// Hacienda de LuisAna — Site Configuration
// -----------------------------------------------------------------------------
// This file is the single source of truth for editable business content.
// Owners can update prices, contact info, images, amenities, FAQs, and nearby
// attractions here without touching component code.
//
// Fields marked with "PLACEHOLDER" should be verified and updated by the owner.
// -----------------------------------------------------------------------------

export type Amenity = {
  key: string
  label: string
}

export type Accommodation = {
  id: string
  name: string
  shortName: string
  description: string
  capacity: number
  capacityLabel: string
  availableUnits?: number
  price?: number           // per night, PHP
  priceLabel?: string      // e.g. "Starting from ₱1,200 / unit"
  priceIsPlaceholder: boolean
  amenities: string[]      // keys into AMENITIES
  images: string[]         // paths in /public or full URLs
  active: boolean
}

export type NearbyAttraction = {
  id: string
  name: string
  description: string
  distance: string   // "Add distance"
  travelTime: string // "Add travel time"
  image: string
  mapsUrl?: string
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
  // Editable placeholders — owner should confirm exact policies.
  policies: {
    checkIn: '2:00 PM',            // placeholder — owner editable
    checkOut: '12:00 NN',          // placeholder — owner editable
    checkInPlaceholder: true,
    checkOutPlaceholder: true,
    petFriendly: true,
    smokingAllowed: false,
  },
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
    priceIsPlaceholder: true,
    priceLabel: 'Contact us for current rates',
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
    price: 1200,
    priceLabel: 'Starting from ₱1,200 / unit',
    priceIsPlaceholder: true,
    amenities: ['campfire', 'grill', 'garden', 'wifi', 'parking', 'pets'],
    images: [
      '/images/gmaps/img-02.jpg',
      FB_CDN['fb-02'],
      '/images/gmaps/img-09.jpg',
      '/images/gmaps/img-12.jpg',
    ],
    active: true,
  },
]

// -----------------------------------------------------------------------------
// NEARBY ATTRACTIONS
// -----------------------------------------------------------------------------
export const NEARBY: NearbyAttraction[] = [
  {
    id: 'hulugan-falls',
    name: 'Hulugan Falls',
    description: 'One of Laguna\'s most breathtaking waterfalls — a lush, towering cascade tucked in Luisiana itself.',
    distance: 'Add distance',
    travelTime: 'Add travel time',
    image: '/images/nearby/hulugan.jpg',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Hulugan+Falls+Luisiana+Laguna',
  },
  {
    id: 'sumucab-twin-falls',
    name: 'Sumucab Twin Falls',
    description: 'Twin waterfalls hidden along a peaceful trail near Luisiana — perfect for a half-day hike.',
    distance: 'Add distance',
    travelTime: 'Add travel time',
    image: '/images/nearby/sumucab.jpg',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Sumucab+Twin+Falls+Luisiana',
  },
  {
    id: 'aliw-falls',
    name: 'Aliw Falls',
    description: 'A serene, wide-curtain waterfall with clear pools ideal for a quick dip and photos.',
    distance: 'Add distance',
    travelTime: 'Add travel time',
    image: '/images/nearby/aliw.jpg',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Aliw+Falls+Luisiana+Laguna',
  },
  {
    id: 'kamay-ni-hesus',
    name: 'Kamay ni Hesus',
    description: 'The famous pilgrim site in Lucban featuring a hilltop climb to a towering statue of the Ascending Christ.',
    distance: 'Add distance',
    travelTime: 'Add travel time',
    image: '/images/nearby/kamay.jpg',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Kamay+ni+Hesus+Lucban',
  },
  {
    id: 'caliraya-lake',
    name: 'Caliraya Lake',
    description: 'A tranquil man-made lake surrounded by pines — great for kayaking, fishing, and lakeside picnics.',
    distance: 'Add distance',
    travelTime: 'Add travel time',
    image: '/images/nearby/caliraya.jpg',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Caliraya+Lake+Laguna',
  },
  {
    id: 'cavinti-cave',
    name: 'Cavinti Underground Cave',
    description: 'An adventurous underground river-cave system for spelunking and rappelling enthusiasts.',
    distance: 'Add distance',
    travelTime: 'Add travel time',
    image: '/images/nearby/cavinti.jpg',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Cavinti+Underground+River+Cave',
  },
]

// -----------------------------------------------------------------------------
// FAQs
// -----------------------------------------------------------------------------
export const FAQS: FAQ[] = [
  {
    q: 'How many guests can stay?',
    a: 'The main house is designed for groups of up to approximately 10 guests. Confirm final capacity with the host before booking.',
  },
  { q: 'Are pets allowed?', a: 'Yes, pets are welcome, subject to the property\'s rules and applicable cleaning charges.' },
  { q: 'Is parking available?', a: 'Yes, free parking is available on-site.' },
  { q: 'Is Wi-Fi available?', a: 'Yes.' },
  { q: 'Can we cook?', a: 'Yes. Cooking facilities are available.' },
  {
    q: 'Can we have a small gathering?',
    a: 'The property is suitable for small gatherings, but guests should confirm event arrangements with the host beforehand.',
  },
  { q: 'Do you offer camping?', a: 'Yes. House A camping units are available subject to availability.' },
  {
    q: 'What time is check-in?',
    a: `Standard check-in is ${''}${BUSINESS.policies.checkIn}${BUSINESS.policies.checkInPlaceholder ? ' (please confirm with the host).' : '.'}`,
  },
  {
    q: 'What time is check-out?',
    a: `Standard check-out is ${''}${BUSINESS.policies.checkOut}${BUSINESS.policies.checkOutPlaceholder ? ' (please confirm with the host).' : '.'}`,
  },
  { q: 'How do I reserve?', a: 'Submit the booking inquiry form or contact Hacienda de LuisAna directly.' },
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
// REVIEWS
// -----------------------------------------------------------------------------
// Owner: Add verified guest reviews here. Empty array shows the empty state.
export const REVIEWS: { name: string; rating: number; body: string; date: string }[] = []
