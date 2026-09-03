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
      '/images/gmaps/img-04.jpg',
      '/images/gmaps/img-03.jpg',
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
// GALLERY (uses generated hero/property imagery in /public/images)
// -----------------------------------------------------------------------------
export const GALLERY: GalleryImage[] = [
  // Wide hero-style
  { id: 'g07', url: '/images/gmaps/img-07.jpg', category: 'Hacienda', caption: 'The Hacienda at dusk — main house, campfire, and camping units', aspect: 'wide' },
  { id: 'g13', url: '/images/gmaps/img-13.jpg', category: 'Hacienda', caption: 'Campfire in front of the main house at blue hour', aspect: 'tall' },
  { id: 'g10', url: '/images/gmaps/img-10.jpg', category: 'Hacienda', caption: 'Welcome — the HDL signage at the entrance', aspect: 'square' },

  // Main house
  { id: 'g01', url: '/images/gmaps/img-01.jpg', category: 'Main House', caption: 'Front facade of the main house at golden hour', aspect: 'tall' },
  { id: 'g14', url: '/images/gmaps/img-14.jpg', category: 'Main House', caption: 'The main house — private entrance and garden', aspect: 'square' },
  { id: 'g06', url: '/images/gmaps/img-06.jpg', category: 'Main House', caption: 'Side view of the main house with garden', aspect: 'tall' },
  { id: 'g03', url: '/images/gmaps/img-03.jpg', category: 'Main House', caption: 'Loft bedroom with wooden floors and countryside views', aspect: 'wide' },
  { id: 'g04', url: '/images/gmaps/img-04.jpg', category: 'Main House', caption: 'Dining area with warm pendant lights and open windows', aspect: 'tall' },
  { id: 'g08', url: '/images/gmaps/img-08.jpg', category: 'Main House', caption: 'The main house lit up at night', aspect: 'tall' },

  // Camping
  { id: 'g02', url: '/images/gmaps/img-02.jpg', category: 'Camping', caption: 'A-frame camping units under the trees', aspect: 'tall' },
  { id: 'g09', url: '/images/gmaps/img-09.jpg', category: 'Camping', caption: 'Two A-frame cabins with stepping-stone path', aspect: 'square' },
  { id: 'g12', url: '/images/gmaps/img-12.jpg', category: 'Camping', caption: 'Camping cabins glowing warm at nightfall', aspect: 'tall' },

  // Outdoors
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
    image: '/images/gmaps/img-07.jpg',
  },
  {
    id: 'gatherings',
    title: 'Small Gatherings',
    body: 'A peaceful setting for intimate celebrations and gatherings.',
    image: '/images/gmaps/img-04.jpg',
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
    image: '/images/gmaps/img-11.jpg',
  },
  {
    id: 'retreat',
    title: 'Quiet Retreat',
    body: 'A place to disconnect from noise and reconnect with yourself and others.',
    image: '/images/gmaps/img-13.jpg',
  },
]

// -----------------------------------------------------------------------------
// REVIEWS
// -----------------------------------------------------------------------------
// Owner: Add verified guest reviews here. Empty array shows the empty state.
export const REVIEWS: { name: string; rating: number; body: string; date: string }[] = []
