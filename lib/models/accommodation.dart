class Accommodation {
  final String id;
  final String title;
  final String category; // 'Main House', 'Camping Units'
  final int capacity;
  final double pricePerNight;
  final double rating;
  final List<String> heroImages;
  final List<String> amenities;
  final String description;

  Accommodation({
    required this.id,
    required this.title,
    required this.category,
    required this.capacity,
    required this.pricePerNight,
    required this.rating,
    required this.heroImages,
    required this.amenities,
    required this.description,
  });
}

final List<Accommodation> accommodationsList = [
  Accommodation(
    id: 'main-house',
    title: 'Main House Villa',
    category: 'Main House',
    capacity: 12,
    pricePerNight: 8500.0,
    rating: 4.9,
    heroImages: [
      'assets/images/gmaps/img-03.jpg',
      'assets/images/gmaps/img-02.jpg',
      'assets/images/gmaps/img-04.jpg',
      'assets/images/gmaps/img-09.jpg',
      'assets/images/gmaps/img-01.jpg',
    ],
    amenities: [
      '12 Max Guests',
      'Infinity Pool Overlooking Mountains',
      'High-Speed Wi-Fi',
      'Full Gourmet Kitchen',
      'Outdoor Dining Deck & Barbecue',
      'Air-Conditioned Suites',
      'Smart Lock Keyless Entry',
      'Panoramic Rainforest Views',
    ],
    description:
        'Experience slow living in our flagship Quiet Luxury Main House Villa. Nestled amidst the high altitude flora of Luisiana, Laguna, offering private accommodations for up to 12 guests with panoramic mountain views and private infinity pool.',
  ),
  Accommodation(
    id: 'camping-a',
    title: 'Camping A - Forest Deck',
    category: 'Camping Units',
    capacity: 4,
    pricePerNight: 1800.0,
    rating: 4.8,
    heroImages: [
      'assets/images/gmaps/img-05.jpg',
      'assets/images/gmaps/img-06.jpg',
      'assets/images/gmaps/img-08.jpg',
    ],
    amenities: [
      '4 Max Guests',
      'Elevated Teak Deck',
      'Canvas Safari Glamping Tent',
      'Shared Luxury Bathroom',
      'Private Campfire Pit',
      'Forest Canopy View',
      'Solar Power Stations',
    ],
    description:
        'Immerse yourself in nature on our elevated Forest Deck. Designed for 4 guests seeking high-altitude fresh air, starry night skies, and gentle rainforest rustles.',
  ),
  Accommodation(
    id: 'camping-b',
    title: 'Camping B - Riverside',
    category: 'Camping Units',
    capacity: 4,
    pricePerNight: 1500.0,
    rating: 4.9,
    heroImages: [
      'assets/images/gmaps/img-07.jpg',
      'assets/images/gmaps/img-08.jpg',
      'assets/images/gmaps/img-01.jpg',
    ],
    amenities: [
      '4 Max Guests',
      'Direct River Stream Access',
      'Waterfront Wooden Platform',
      'Glamping Gear Included',
      'Outdoor Barbecue Grill',
      'Natural River Soundscape',
    ],
    description:
        'Steps away from the cold natural waters of Luisiana river. Riverside camping setup combining untouched wilderness with quiet luxury comforts for up to 4 guests.',
  ),
];

class NearbySpot {
  final String id;
  final String name;
  final String location;
  final String description;
  final String imageUrl;
  final String mapUrl;

  NearbySpot({
    required this.id,
    required this.name,
    required this.location,
    required this.description,
    required this.imageUrl,
    required this.mapUrl,
  });
}

final List<NearbySpot> nearbyList = [
  NearbySpot(
    id: 'hulugan-falls',
    name: 'Hulugan Falls',
    location: 'Luisiana, Laguna',
    description:
        'A magnificent 70-meter cascading waterfall surrounded by pristine jungle foliage, famous for double rainbows in the mist.',
    imageUrl: 'assets/images/gmaps/hulugan_falls.jpg',
    mapUrl: 'https://maps.google.com/?q=Hulugan+Falls+Luisiana+Laguna',
  ),
  NearbySpot(
    id: 'aliw-falls',
    name: 'Aliw Falls',
    location: 'Luisiana, Laguna',
    description:
        'A wide, multi-tiered cascading waterfall with broad rock terraces perfect for refreshing cold swims.',
    imageUrl: 'assets/images/gmaps/aliw_falls.jpg',
    mapUrl: 'https://maps.google.com/?q=Aliw+Falls+Luisiana+Laguna',
  ),
  NearbySpot(
    id: 'caliraya-lake',
    name: 'Caliraya Lake',
    location: 'Cavinti / Lumban, Laguna',
    description:
        'A tranquil man-made lake located high in the mountains, popular for windsurfing, kayaking, and sunset viewing.',
    imageUrl: 'assets/images/gmaps/caliraya_lake.jpg',
    mapUrl: 'https://maps.google.com/?q=Caliraya+Lake+Laguna',
  ),
  NearbySpot(
    id: 'kamay-ni-hesus',
    name: 'Kamay ni Hesus',
    location: 'Lucban, Quezon',
    description:
        'A famous spiritual retreat and pilgrimage site featuring a 50-foot statue of Jesus Christ atop a lush green hill.',
    imageUrl: 'assets/images/gmaps/kamay_ni_hesus.jpg',
    mapUrl: 'https://maps.google.com/?q=Kamay+ni+Hesus+Lucban+Quezon',
  ),
];
